// The persistence adapter of the socket server (phase-02 plan 7.6 "Outbox per game", 6.6, 6.7, B4): the
// `LivePersistence` port over `@repo/db/live` plus the ndjson journal.
//
// - One outbox per game holds what the DB has not seen (plies, phase and clock changes). It flushes when
//   CHECKPOINT_PLIES plies are queued, CHECKPOINT_MAX_AGE_MS after the first unflushed change, at once on a freeze
//   (drain), and on finish/abort (the finish CTE carries every unflushed ply). One write in flight per game, so the
//   writes of one process never reorder; the full move list is sent each time (an idempotent overwrite).
// - Every statement has an 8 s budget (the role's statement_timeout is 5 s). A transient error (Neon suspend, 6.7)
//   is retried once at once after a single-flight pool reset and counted as `ws.persist.reconnect`; after that the
//   backoff 1, 2, 4 … 60 s ±20 % applies and the failure counts as `ws.persist.fail{op,code}`.
// - A finish or abort is retried with the same backoff until it commits (or the process drains: the journal's
//   `end` line lets the next process finish it). After a finish commits, the opportunistic stale sweep runs (≤ 1 per
//   10 min, Neon is awake then). No timer runs while nothing is dirty, so an idle server never queries Neon (7.7).
// - The journal gets every transition line, a `flushed` line after each commit, and is fsynced before a drain flush.
import {
  abortGame,
  checkpointGame,
  createPoolReset,
  createRematch,
  dbErrorCode,
  finishAnalysisOf,
  finishGame,
  loadLiveGame,
  loadRestoreCandidates,
  prewarm,
  staleSweep,
  withTransientRetry,
  type LiveGameRecord,
  type SqlClient,
  type StaleSweepResult,
} from "@repo/db/live";
import { buildPgn, type AbortedBy, type GameResult, type Side } from "@repo/game-core";
import type { EndCommitted } from "../analysis/afterEnd";
import type { Timing } from "../config/timing";
import type { LiveSession } from "../game/LiveSession";
import type { LivePersistence, Logger, Metrics, OutboxStats, RematchOutcome } from "../ports";
import type { Journal } from "./journal";

type Db = SqlClient & { $disconnect(): Promise<void> };

export const STATEMENT_BUDGET_MS = 8_000;
/** The stale sweep is one SELECT plus one statement per stale game (≤ 50): a budget for the whole pass. */
export const SWEEP_BUDGET_MS = 60_000;
export const BACKOFF_MAX_MS = 60_000;
/** The opportunistic stale sweep runs at most this often (plan 6.6.8). */
export const STALE_SWEEP_EVERY_MS = 10 * 60 * 1000;
/** Checkpoints in parallel during a drain flush (plan 7.6 "Drain"). */
export const DRAIN_FLUSH_CONCURRENCY = 8;
/**
 * First-join loads in flight at once: the replay_realtime pool (`connection_limit=3`). A burst of first joins (a
 * deploy restore, the dev-box ramp start) queues HERE, and each load's 8 s budget starts when it gets a slot, instead
 * of every load waiting inside Prisma's pool with its budget running out (FIX-A, WP-I §4.9: 'internal' acks).
 */
export const LOAD_CONCURRENCY = 3;

/** A FIFO limiter: at most `max` of the returned function's tasks run at once. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        task().then(resolve, reject).finally(release);
      };
      if (active < max) start();
      else waiting.push(start);
    });
}

interface Outbox {
  /** Plies (relative to the start FEN) the DB acknowledged. */
  flushedPlies: number;
  /** First change the DB has not seen (null = clean). */
  dirtySince: number | null;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  /** The finish or abort was handed over: no more checkpoints. */
  closed: boolean;
  /** Finish/abort not committed yet (counts in depth/oldest). */
  ending: { since: number } | null;
}

export interface OutboxDeps {
  db: Db;
  journal: Journal | null;
  timing: Pick<Timing, "checkpointPlies" | "checkpointMaxAgeMs">;
  now(): number;
  log: Logger;
  metrics: Metrics;
  /** PGN `Site` origin (WEB_APP_URL). */
  siteOrigin?: string;
  /** Refs held in memory (never swept). */
  liveRefs(): string[];
  statementBudgetMs?: number;
  backoffMaxMs?: number;
  /** First backoff step (tests shorten it). */
  backoffBaseMs?: number;
  staleSweepEveryMs?: number;
  /** First-join loads in flight at once (default LOAD_CONCURRENCY, the pool size). */
  loadConcurrency?: number;
  /**
   * P3: called once a finish or abort statement of a session settled as committed (live end, retried end, boot
   * restore), with what the finish's jobs fragment did. The worker kick and the user-room emits hang here
   * (src/analysis/afterEnd.ts). Must not throw.
   */
  onEndCommitted?(session: LiveSession, end: EndCommitted): void;
  /** P3: the stale sweep abandoned games (their finish enqueued analysis jobs): wake the worker. */
  onSweepFinished?(abandoned: readonly string[]): void;
}

export interface OutboxPersistence extends LivePersistence {
  flushAll(): Promise<void>;
  stats(): OutboxStats;
  /** Writes the session's state now (restore: the plies the journal has and the DB lacks, in one checkpoint). */
  writeNow(session: LiveSession): Promise<boolean>;
  /**
   * The boot restore's one statement (`loadRestoreCandidates`), on the same path as a session load: a load slot, the
   * statement budget and one retry on a fresh connection after a transient error (a Neon cold start or suspend).
   */
  restoreCandidates(journalRefs: readonly string[], windowMs: number): Promise<LiveGameRecord[]>;
  /** The stale sweep (boot, and after a finish ≤ 1 per 10 min). Null when skipped by the cadence. */
  staleSweep(force?: boolean): Promise<StaleSweepResult | null>;
  /** Stops retry loops and timers (shutdown). */
  stop(): void;
}

function jitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

class BudgetExceeded extends Error {
  constructor(op: string, ms: number) {
    super(`${op} exceeded its ${ms} ms budget`);
    this.name = "BudgetExceeded";
  }
}

export function createOutboxPersistence(deps: OutboxDeps): OutboxPersistence {
  const { db, journal, timing, now, log, metrics } = deps;
  const budgetMs = deps.statementBudgetMs ?? STATEMENT_BUDGET_MS;
  const backoffMax = deps.backoffMaxMs ?? BACKOFF_MAX_MS;
  const backoffBase = deps.backoffBaseMs ?? 1_000;
  const sweepEvery = deps.staleSweepEveryMs ?? STALE_SWEEP_EVERY_MS;
  const reset = createPoolReset(db);
  const loadSlot = createLimiter(Math.max(1, deps.loadConcurrency ?? LOAD_CONCURRENCY));
  const outboxes = new Map<string, Outbox>();
  const sessions = new Map<string, LiveSession>();
  let dbOkAt: number | null = null;
  let lastFailAt: number | null = null;
  let lastSweepAt = Number.NEGATIVE_INFINITY;
  let sweeping: Promise<StaleSweepResult | null> | null = null;
  let stopped = false;

  const backoff = (failures: number) => jitter(Math.min(backoffMax, backoffBase * 2 ** Math.max(0, failures - 1)));
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref?.();
    });

  /** One statement with the 8 s budget, the transient retry and the metrics. */
  const run = <T>(op: string, fn: () => PromiseLike<T>, limitMs = budgetMs): Promise<T> => {
    const started = now();
    const attempt = () =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new BudgetExceeded(op, limitMs)), limitMs);
        t.unref?.();
        Promise.resolve(fn()).then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e: unknown) => {
            clearTimeout(t);
            reject(e);
          },
        );
      });
    return withTransientRetry(attempt, {
      reset,
      onTransient: () => metrics.count("ws.persist.reconnect", { op }),
    }).then(
      (value) => {
        metrics.sample("ws.persist.ms", now() - started, { op });
        return value;
      },
      (error: unknown) => {
        lastFailAt = now();
        const code = error instanceof BudgetExceeded ? "budget" : (dbErrorCode(error) ?? "unknown");
        metrics.count("ws.persist.fail", { op, code });
        throw error;
      },
    );
  };

  const wrote = () => {
    dbOkAt = now();
  };

  const outboxOf = (ref: string): Outbox => {
    let o = outboxes.get(ref);
    if (!o) {
      o = { flushedPlies: 0, dirtySince: null, inFlight: null, timer: null, failures: 0, closed: false, ending: null };
      outboxes.set(ref, o);
    }
    return o;
  };

  const timeMs = (session: LiveSession) => {
    const s = session.state;
    return {
      whiteTimeMs: s.tc ? Math.max(0, Math.round(s.clocks.w)) : null,
      blackTimeMs: s.tc ? Math.max(0, Math.round(s.clocks.b)) : null,
    };
  };

  function checkpointInput(session: LiveSession, at: number) {
    const s = session.state;
    const phaseEndsAt = s.study?.endsAt ?? s.firstMove?.deadlineAt ?? null;
    return {
      gameId: session.ids.dbId!,
      moves: s.moves.join(" "),
      clocksMs: s.clocksMs,
      plyCount: s.moves.length,
      fen: s.fen,
      ...timeMs(session),
      clockRunning: s.frozen ? null : s.clocks.run,
      phase: s.phase,
      phaseEndsAt: phaseEndsAt === null ? null : new Date(phaseEndsAt),
      lastMoveAt: new Date(s.clocks.run && !s.frozen ? s.clocks.at : at),
    };
  }

  function writeCheckpoint(session: LiveSession, o: Outbox): void {
    if (o.closed || o.inFlight || stopped || session.ids.dbId === null) return;
    if (o.timer) clearTimeout(o.timer);
    o.timer = null;
    const at = now();
    const input = checkpointInput(session, at);
    const plies = input.plyCount;
    const since = o.dirtySince;
    o.dirtySince = null;
    o.inFlight = run("checkpoint", () => checkpointGame(db, input))
      .then(
        () => {
          wrote();
          o.flushedPlies = Math.max(o.flushedPlies, plies);
          o.failures = 0;
          journal?.flushed(session.ref, plies);
        },
        (error: unknown) => {
          o.failures++;
          // Keep the age of the oldest unflushed change (it drives /ready's 60 s rule).
          o.dirtySince = Math.min(o.dirtySince ?? at, since ?? at);
          const wait = backoff(o.failures);
          log.warn("checkpoint failed; retrying", { game: session.ref, ply: plies, waitMs: wait, err: String(error) });
          if (!o.closed && !stopped) {
            o.timer = setTimeout(() => {
              o.timer = null;
              writeCheckpoint(session, o);
            }, wait);
            o.timer.unref?.();
          }
        },
      )
      .finally(() => {
        o.inFlight = null;
        // Changes that arrived while this write was in flight.
        if (!o.closed && !stopped && o.dirtySince !== null && !o.timer) schedule(session, o);
      });
  }

  function schedule(session: LiveSession, o: Outbox): void {
    const unflushed = session.state.moves.length - o.flushedPlies;
    if (unflushed >= timing.checkpointPlies) return writeCheckpoint(session, o);
    if (o.timer || o.inFlight) return;
    const due = (o.dirtySince ?? now()) + timing.checkpointMaxAgeMs - now();
    o.timer = setTimeout(() => {
      o.timer = null;
      writeCheckpoint(session, o);
    }, Math.max(0, due));
    o.timer.unref?.();
  }

  function close(ref: string): Outbox {
    const o = outboxOf(ref);
    o.closed = true;
    o.ending ??= { since: o.dirtySince ?? now() };
    if (o.timer) clearTimeout(o.timer);
    o.timer = null;
    return o;
  }

  /** Retries `fn` with the outbox backoff until it succeeds or the process stops. */
  async function untilCommitted<T>(op: string, ref: string, fn: () => Promise<T>): Promise<T | null> {
    for (let failures = 1; ; failures++) {
      try {
        const out = await fn();
        wrote();
        return out;
      } catch (error) {
        if (stopped) {
          log.error(`${op} not committed before shutdown (the journal keeps the end)`, { game: ref, op }, error);
          return null;
        }
        const wait = backoff(failures);
        log.warn(`${op} failed; retrying`, { game: ref, op, waitMs: wait, err: String(error) });
        await sleep(wait);
      }
    }
  }

  function pgnOf(session: LiveSession, result: GameResult): string {
    const s = session.state;
    return buildPgn({
      ref: s.ref,
      mode: s.mode,
      date: s.startedAt ?? s.createdAt,
      white: s.seats.w.name,
      black: s.seats.b.name,
      startFen: s.startFen,
      moves: s.moves,
      clocksMs: s.clocksMs,
      result: { winner: result.winner, method: result.method },
      tc: s.tc,
      ...(deps.siteOrigin ? { siteOrigin: deps.siteOrigin } : {}),
    });
  }

  async function sweep(force = false): Promise<StaleSweepResult | null> {
    if (stopped) return null;
    if (sweeping) return sweeping;
    if (!force && now() - lastSweepAt < sweepEvery) return null;
    lastSweepAt = now();
    sweeping = run("sweep", () => staleSweep(db, { liveRefs: deps.liveRefs() }), SWEEP_BUDGET_MS)
      .then(
        (r) => {
          wrote();
          if (r.aborted.length || r.abandoned.length) {
            metrics.count("ws.sweep.aborted", {}, r.aborted.length);
            metrics.count("ws.sweep.abandoned", {}, r.abandoned.length);
            log.info("stale sweep", { aborted: r.aborted.length, abandoned: r.abandoned.length });
          }
          if (r.abandoned.length) deps.onSweepFinished?.(r.abandoned);
          return r;
        },
        (error: unknown) => {
          log.warn("stale sweep failed", { err: String(error) });
          return null;
        },
      )
      .finally(() => {
        sweeping = null;
      });
    return sweeping;
  }

  const endCommitted = (session: LiveSession, end: EndCommitted) => {
    try {
      deps.onEndCommitted?.(session, end);
    } catch (error) {
      log.error("onEndCommitted failed", { game: session.ref }, error);
    }
  };

  const finishCommitted = (session: LiveSession, plies: number) => {
    const o = outboxOf(session.ref);
    o.ending = null;
    o.flushedPlies = plies;
    o.dirtySince = null;
    journal?.flushed(session.ref, plies);
    journal?.committed(session.ref, now());
    void sweep();
  };

  const persistence: OutboxPersistence = {
    load: (ref) => loadSlot(() => run("load", () => loadLiveGame(db, ref))),

    restoreCandidates: (journalRefs, windowMs) =>
      loadSlot(() => run("restore", () => loadRestoreCandidates(db, journalRefs, windowMs))),

    journal(session, line) {
      journal?.append(session, line);
    },

    checkpoint(session, reason) {
      if (stopped) return;
      sessions.set(session.ref, session);
      const o = outboxOf(session.ref);
      if (o.closed) return;
      o.dirtySince ??= now();
      if (reason === "freeze") return writeCheckpoint(session, o);
      schedule(session, o);
    },

    async finish(session, result: GameResult) {
      sessions.set(session.ref, session);
      const o = close(session.ref);
      await o.inFlight;
      if (session.ids.dbId === null || result.method === "aborted") {
        o.ending = null;
        return { committed: false };
      }
      const s = session.state;
      const dbId = session.ids.dbId;
      const method = result.method;
      const pgn = pgnOf(session, result);
      const out = await untilCommitted("finish", session.ref, () =>
        run("finish", () =>
          finishGame(db, {
            gameId: dbId,
            moves: s.moves.join(" "),
            clocksMs: s.clocksMs,
            plyCount: s.moves.length,
            fen: s.fen,
            ...timeMs(session),
            method,
            winner: result.winner,
            pgn,
            endedAt: new Date(result.endedAt),
            metaPatch: { drawOffers: s.stats.drawOffers, premoves: s.stats.premoves },
            display: {
              whiteName: s.seats.w.name || null,
              blackName: s.seats.b.name || null,
              whiteRating: s.seats.w.rating,
              blackRating: s.seats.b.rating,
            },
          }),
        ),
      );
      if (!out) return { committed: false };
      if (out.conflict) {
        metrics.count("ws.persist.conflict");
        log.warn("finish conflict: the stored end differs (the DB wins)", { game: session.ref });
      }
      finishCommitted(session, s.moves.length);
      const committed = out.finished || !out.conflict;
      const analysis = finishAnalysisOf(out, s.moves.length);
      if (committed) endCommitted(session, { kind: "finish", analysis });
      return { committed, analysis };
    },

    async abort(session, result: GameResult, abortedBy: AbortedBy) {
      sessions.set(session.ref, session);
      const o = close(session.ref);
      await o.inFlight;
      if (session.ids.dbId === null) {
        o.ending = null;
        return { committed: false };
      }
      const s = session.state;
      const dbId = session.ids.dbId;
      const out = await untilCommitted("abort", session.ref, () =>
        run("abort", () =>
          abortGame(db, {
            gameId: dbId,
            abortedBy,
            endedAt: new Date(result.endedAt),
            moves: s.moves.join(" "),
            clocksMs: s.clocksMs,
            plyCount: s.moves.length,
            fen: s.fen,
            ...timeMs(session),
          }),
        ),
      );
      if (!out) return { committed: false };
      finishCommitted(session, s.moves.length);
      const committed = out.aborted || out.storedStatus === "ABORTED";
      if (committed) endCommitted(session, { kind: "abort" });
      return { committed };
    },

    async createRematch(session, offeredBy: Side, acceptedBy: Side): Promise<RematchOutcome> {
      const ended = await session.whenEnded();
      if (!ended?.committed) return { ok: false, code: "internal" };
      const { dbId, userIds } = session.ids;
      const offererId = userIds[offeredBy];
      const accepterId = userIds[acceptedBy];
      if (dbId === null || offererId === null || accepterId === null) return { ok: false, code: "internal" };
      const child = await run("rematch", () => createRematch(db, { parentId: dbId, offererId, accepterId }));
      wrote();
      if (!child) return { ok: false, code: "not_allowed" };
      return { ok: true, newRef: child.ref };
    },

    prewarm() {
      void prewarm(db).then(wrote, () => undefined);
    },

    forget(ref) {
      const o = outboxes.get(ref);
      void journal?.release(ref);
      if (o && !o.inFlight && o.dirtySince === null && !o.ending) {
        if (o.timer) clearTimeout(o.timer);
        outboxes.delete(ref);
        sessions.delete(ref);
      }
    },

    async writeNow(session) {
      sessions.set(session.ref, session);
      const o = outboxOf(session.ref);
      if (o.closed || session.ids.dbId === null) return false;
      await o.inFlight;
      o.dirtySince ??= now();
      writeCheckpoint(session, o);
      await o.inFlight;
      return o.dirtySince === null;
    },

    async flushAll() {
      await journal?.sync();
      const dirty: [LiveSession, Outbox][] = [];
      for (const [ref, o] of outboxes) {
        const session = sessions.get(ref);
        if (session && !o.closed && o.dirtySince !== null) dirty.push([session, o]);
      }
      // ≤ 8 checkpoints in parallel (plan 7.6 "Drain").
      for (let i = 0; i < dirty.length; i += DRAIN_FLUSH_CONCURRENCY) {
        const batch = dirty.slice(i, i + DRAIN_FLUSH_CONCURRENCY);
        await Promise.allSettled(
          batch.map(async ([session, o]) => {
            await o.inFlight;
            if (o.dirtySince !== null) writeCheckpoint(session, o);
            await o.inFlight;
          }),
        );
      }
      const inFlight = [...outboxes.values()].map((o) => o.inFlight).filter((p): p is Promise<void> => p !== null);
      await Promise.allSettled(inFlight);
      await journal?.sync();
    },

    stats(): OutboxStats {
      const t = now();
      let depth = 0;
      let oldest = 0;
      for (const o of outboxes.values()) {
        const since = o.ending?.since ?? o.dirtySince;
        if (since === null) continue;
        depth++;
        oldest = Math.max(oldest, t - since);
      }
      return { depth, oldestMs: oldest, dbOkAt, lastFailAt };
    },

    staleSweep: (force = false) => sweep(force),

    stop() {
      stopped = true;
      for (const o of outboxes.values()) {
        if (o.timer) clearTimeout(o.timer);
        o.timer = null;
      }
    },
  };
  return persistence;
}
