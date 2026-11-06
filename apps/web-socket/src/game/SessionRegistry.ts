// Live sessions in memory (phase-02 plan 7.6 "Eviction", 9.2 "Reads", socket F-09, F-19).
// - The first `game:join` of a game without a session loads it with ONE statement (`loadLiveGame`); concurrent joins
//   share that load. A reconnect to an existing session makes no query.
// - A row with progress (study, first move, playing, or plies) and no session is restored by replay, frozen until
//   both players are back or RESUME_MAX_WAIT_MS (plan 7.6 step 3–5). A finished row becomes an `ended` session, so
//   late joins and the rematch window work the same as for a game that ended in this process.
// - Eviction (memory only, every 60 s, never a DB query): ended sessions POST_GAME_RETENTION_MS after the end (not
//   while a rematch offer is open), ended sessions with no player socket at once, waiting sessions with no player
//   socket for WAITING_RETENTION_MS. An ended session whose finish has not committed yet is never evicted. The DB
//   row stays; legacy expiry still applies.
// The boot restore (src/persist/restore.ts: journal + restore list) adds sessions with `adopt()`; while it runs,
// `open()` waits behind the restore gate, so an early reconnect never builds a session from the DB row alone while
// the journal holds newer plies.
import type { LiveGameRecord } from "@repo/db/live";
import {
  createGame,
  endMethodFromDb,
  restoreGame,
  sideToMove,
  splitMoves,
  winnerFromOutcome,
  type CreateGameInput,
  type DbEndMethod,
  type Phase,
  type RestoreProgress,
  type Seat,
  type ServerGame,
  type Side,
  type SocketErrorCode,
  tcLabel,
} from "@repo/game-core";
import { LIVE_LIST_MAX } from "@repo/contracts/socket/limits";
import type { LiveGameCard, LiveTimeClass } from "@repo/contracts/socket/game";
import { LiveSession, type SessionDeps, type SessionIds } from "./LiveSession";

const PHASE_FROM_DB: Record<string, Phase> = {
  WAITING: "waiting",
  STUDY: "study",
  FIRST_MOVE: "first_move",
  PLAYING: "playing",
  ENDED: "ended",
};

const EMPTY_SEAT: Seat = { ref: null, name: "", avatarUrl: null, rating: null };

function seatOf(p: LiveGameRecord["white"], snapshotName: string | null, snapshotRating: number | null): Seat {
  if (!p) return { ...EMPTY_SEAT, name: snapshotName ?? "", rating: snapshotRating };
  return { ref: p.ref, name: p.name, avatarUrl: p.avatarUrl, rating: p.rating };
}

export function seatsOf(r: LiveGameRecord): { seats: ServerGame["seats"]; userIds: SessionIds["userIds"] } {
  return {
    seats: { w: seatOf(r.white, r.whiteName, r.whiteRating), b: seatOf(r.black, r.blackName, r.blackRating) },
    userIds: { w: r.white?.userId ?? null, b: r.black?.userId ?? null },
  };
}

export type BuildResult =
  | { ok: true; state: ServerGame; ids: SessionIds; restored: boolean }
  | { ok: false; code: SocketErrorCode; reason: string };

/** The game-core create input of a DB row (plain data; no I/O). Exported for WP-D part 2's boot restore. */
export function createInputOf(r: LiveGameRecord, rematchOfRef: string | null = null): CreateGameInput | null {
  const mode = r.mode ?? "FRIEND"; // rows the backfill never reached read as friend games (game-core snapshotOf)
  if (mode !== "FRIEND" && mode !== "ONLINE" && mode !== "TOURNAMENT") return null; // bot games never use the socket
  const timed = r.timeClass !== "UNTIMED" && r.initialTimeSeconds > 0;
  const meta = r.meta;
  const prefixSan = meta?.prefixSan ?? [];
  const startPly = r.startPly;
  const { seats } = seatsOf(r);
  return {
    ref: r.ref,
    mode,
    rated: r.rated,
    tc: timed ? { initialMs: r.initialTimeSeconds * 1000, incrementMs: r.incrementSeconds * 1000 } : null,
    startFen: r.startingFen,
    studySeconds: r.studySeconds,
    startKind: r.chessPositionId != null ? "position" : r.openingId != null ? "opening" : "initial",
    headerLeft: meta?.header ?? "",
    position: meta?.position ? { ...meta.position, sideToMove: sideToMove(r.startingFen) } : null,
    prefix: {
      sans: prefixSan.join(" "),
      startMoveNo: meta?.prefixStartMoveNo ?? 1,
      startsBlack: prefixSan.length > 0 && (startPly - prefixSan.length) % 2 === 1,
    },
    seats,
    rematchOf: rematchOfRef ?? r.rematchOfRef ?? null,
    createdAt: r.createdAt.getTime(),
  };
}

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

/**
 * Builds the in-memory game of a DB row:
 * - WAITING_FOR_OPPONENT, or IN_PROGRESS with no progress → a fresh `waiting` game;
 * - IN_PROGRESS with progress → restored by replay, frozen until both players attach (or the resume wait);
 * - COMPLETED / ABORTED → an `ended` game with the stored result;
 * - CANCELLED / EXPIRED, bot games → refused.
 */
export function buildServerGame(
  r: LiveGameRecord,
  now: number,
  resumeMaxWaitMs: number,
  rematchOfRef: string | null = null,
): BuildResult {
  const input = createInputOf(r, rematchOfRef);
  if (!input) return { ok: false, code: "forbidden", reason: "not_live_mode" };
  const { userIds } = seatsOf(r);
  const ids: SessionIds = {
    dbId: r.id,
    userIds,
    tournament: r.tournament ? { ref: r.tournament.ref, name: r.tournament.name } : null,
  };
  const moves = splitMoves(r.moves);
  const initialMs = input.tc?.initialMs ?? 0;
  const clocks = {
    w: r.whiteTimeMs ?? initialMs,
    b: r.blackTimeMs ?? initialMs,
  };

  if (r.status === "CANCELLED" || r.status === "EXPIRED") return { ok: false, code: "not_found", reason: "closed" };

  if (r.status === "COMPLETED" || r.status === "ABORTED") {
    const method = endMethodFromDb(r.endMethod as DbEndMethod | null) ?? (r.status === "ABORTED" ? "aborted" : null);
    if (!method) return { ok: false, code: "not_found", reason: "no_end_method" };
    const endedAt = ms(r.completedAt) ?? ms(r.lastMoveAt) ?? now;
    const progress: RestoreProgress = {
      moves,
      clocksMs: r.moveClocksMs,
      phase: "ended",
      phaseEndsAt: null,
      clocks: { ...clocks, run: null },
      savedAt: endedAt,
      startedAt: ms(r.startedAt),
    };
    const restored = restoreGame(input, progress, now, resumeMaxWaitMs);
    const base = restored.ok ? restored.state : createGame(input, now);
    const abortedBy = method === "aborted" ? (r.meta?.abortedBy ?? null) : null;
    const state: ServerGame = {
      ...base,
      phase: "ended",
      frozen: null,
      clocks: { ...clocks, run: null, at: endedAt },
      abortedBy,
      result: {
        winner: winnerFromOutcome(r.outcome),
        method,
        ply: base.startPly + base.moves.length,
        endedAt,
        ...(abortedBy ? { abortedBy } : {}),
      },
      stats: {
        drawOffers: r.meta?.drawOffers ?? { w: 0, b: 0 },
        premoves: r.meta?.premoves ?? { w: 0, b: 0 },
      },
    };
    return { ok: true, state, ids, restored: false };
  }

  const phase = r.phase ? (PHASE_FROM_DB[r.phase] ?? "waiting") : "waiting";
  const hasProgress = moves.length > 0 || phase === "study" || phase === "first_move" || phase === "playing";
  if (r.status === "WAITING_FOR_OPPONENT" || !hasProgress) {
    return { ok: true, state: createGame(input, now), ids, restored: false };
  }

  // A live game whose session is gone (process restart without a journal): replay from the start FEN, frozen.
  const savedAt = ms(r.lastMoveAt) ?? ms(r.startedAt) ?? now;
  const first = sideToMove(r.startingFen);
  const toMove: Side = moves.length % 2 === 0 ? first : first === "w" ? "b" : "w";
  const run: Side | null = phase === "playing" && input.tc ? (r.clockRunning ?? toMove) : null;
  const progress: RestoreProgress = {
    moves,
    clocksMs: r.moveClocksMs,
    phase: phase === "ended" ? "playing" : phase,
    phaseEndsAt: ms(r.phaseEndsAt),
    clocks: { ...clocks, run },
    drawOffer: null,
    savedAt,
    startedAt: ms(r.startedAt),
  };
  const restored = restoreGame(input, progress, now, resumeMaxWaitMs);
  if (!restored.ok) return { ok: false, code: "internal", reason: `corrupt_at_${restored.index}` };
  return { ok: true, state: restored.state, ids, restored: true };
}

export interface RegistryDeps extends SessionDeps {
  /** Notified when a session leaves memory (socket index cleanup). */
  onEvict?(ref: string): void;
}

export type OpenResult = { ok: true; session: LiveSession } | { ok: false; code: SocketErrorCode };

export class SessionRegistry {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly loading = new Map<string, Promise<OpenResult>>();
  /** child ref → parent ref for rematches made by this process (GameState.rematchOf; the row has only the id). */
  private readonly rematchParents = new Map<string, string>();
  private sweepHandle: ReturnType<typeof setInterval> | null = null;
  /** No new sessions during a drain (plan 7.4.4 `game:join` → `draining`). */
  draining = false;
  /** Pending boot restore: `open()` waits for it (see the header). */
  private gate: Promise<unknown> | null = null;
  /**
   * Games whose DB load failed during the boot restore while a journal file held their plies (FIX-A): the first
   * successful load hands the row to this handler (the restore's own build: the longer move list wins) instead of
   * building the session from the row alone, which would rewrite the journal from the shorter state.
   */
  private readonly deferred = new Map<string, (record: LiveGameRecord) => Promise<OpenResult | null>>();

  private readonly sessionDeps: SessionDeps;

  constructor(private readonly deps: RegistryDeps) {
    this.sessionDeps = {
      ...deps,
      onRematchCreated: (session, newRef) => {
        this.noteRematch(newRef, session.ref);
        deps.onRematchCreated?.(session, newRef);
      },
    };
  }

  get(ref: string): LiveSession | undefined {
    return this.sessions.get(ref);
  }

  all(): IterableIterator<LiveSession> {
    return this.sessions.values();
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Holds every `open()` until `until` settles (the boot restore). */
  setGate(until: Promise<unknown>): void {
    const gate = until.then(
      () => undefined,
      () => undefined,
    );
    this.gate = gate;
    void gate.then(() => {
      if (this.gate === gate) this.gate = null;
    });
  }

  /** The session of `ref`, loading it from the DB once (concurrent callers share the load). */
  open(ref: string): Promise<OpenResult> {
    if (this.gate) return this.gate.then(() => this.open(ref));
    const existing = this.sessions.get(ref);
    if (existing) return Promise.resolve({ ok: true, session: existing });
    if (this.draining) return Promise.resolve({ ok: false, code: "draining" });
    const pending = this.loading.get(ref);
    if (pending) return pending;
    const load = this.load(ref).finally(() => this.loading.delete(ref));
    this.loading.set(ref, load);
    return load;
  }

  /** See `deferred`. The handler runs once, on the first load of `ref` that reaches the DB. */
  deferRestore(ref: string, handler: (record: LiveGameRecord) => Promise<OpenResult | null>): void {
    this.deferred.set(ref, handler);
  }

  /** Refs whose restore waits for the DB (journal cleanup keeps their files). */
  deferredRefs(): string[] {
    return [...this.deferred.keys()];
  }

  private async load(ref: string): Promise<OpenResult> {
    const record = await this.deps.persistence.load(ref);
    const again = this.sessions.get(ref);
    if (again) return { ok: true, session: again };
    if (!record) {
      this.deferred.delete(ref);
      return { ok: false, code: "not_found" };
    }
    const deferred = this.deferred.get(ref);
    if (deferred) {
      this.deferred.delete(ref);
      const restored = await deferred(record);
      if (restored) return restored;
      const adopted = this.sessions.get(ref);
      if (adopted) return { ok: true, session: adopted };
    }
    const built = buildServerGame(record, this.deps.now(), this.deps.timing.machine.resumeMaxWaitMs, this.rematchParents.get(ref) ?? null);
    if (!built.ok) {
      if (built.code === "internal") {
        this.deps.metrics.count("ws.restore", { result: "corrupt" });
        this.deps.log.error("restore from the DB row failed", { game: ref, reason: built.reason });
      }
      return { ok: false, code: built.code };
    }
    if (built.restored) this.deps.metrics.count("ws.restore", { result: "db" });
    const session = this.adopt(built.state, built.ids);
    return { ok: true, session };
  }

  /** Puts a built game in memory (also used by the boot restore). */
  adopt(state: ServerGame, ids: SessionIds): LiveSession {
    const existing = this.sessions.get(state.ref);
    if (existing) return existing;
    const session = new LiveSession(state, ids, this.sessionDeps);
    if (this.draining) session.dispatch({ type: "freeze", reason: "drain" });
    this.sessions.set(state.ref, session);
    return session;
  }

  /**
   * A user who is not seated asks to join a `waiting` game with an empty seat: the friend may have joined through
   * the web (`POST /api/chess/join`) after this session was loaded. Re-reads the row (one query) and adopts its
   * seats. Returns the user's side, or null.
   */
  async refreshSeats(session: LiveSession, userRef: string): Promise<Side | null> {
    const side = session.sideOf(userRef);
    if (side) return side;
    const s = session.state;
    if (s.phase !== "waiting" || (s.seats.w.ref && s.seats.b.ref)) return null;
    const record = await this.deps.persistence.load(session.ref);
    if (!record || session.isDestroyed) return null;
    const { seats, userIds } = seatsOf(record);
    if (session.state.phase === "waiting") session.updateSeats(seats, userIds);
    return session.sideOf(userRef);
  }

  /** Remembers the parent of a rematch created by this process. */
  noteRematch(childRef: string, parentRef: string): void {
    this.rematchParents.set(childRef, parentRef);
  }

  evict(ref: string): void {
    const session = this.sessions.get(ref);
    if (!session) return;
    this.sessions.delete(ref);
    this.rematchParents.delete(ref);
    session.destroy();
    this.deps.persistence.forget?.(ref);
    this.deps.onEvict?.(ref);
  }

  /** One eviction pass (memory only). */
  sweep(now = this.deps.now()): number {
    const { postGameRetentionMs, waitingRetentionMs } = this.deps.timing;
    let evicted = 0;
    for (const session of [...this.sessions.values()]) {
      const s = session.state;
      const anyPlayer = session.hasPlayerSockets();
      let drop = false;
      if (s.phase === "ended") {
        const rematchOpen = s.rematch !== null;
        // Never while the finish is still being written: the row is still IN_PROGRESS, so a later join would
        // rebuild a live game from it and the new session's journal would overwrite the `end` line (FIX-A).
        drop =
          !rematchOpen &&
          !session.endPending &&
          (!anyPlayer || now - (session.endedAt ?? now) >= postGameRetentionMs);
      } else if (s.phase === "waiting") {
        drop = !anyPlayer && now - session.lastActivityAt >= waitingRetentionMs;
      }
      if (drop) {
        this.evict(session.ref);
        evicted++;
      }
    }
    return evicted;
  }

  start(): void {
    if (this.sweepHandle) return;
    this.sweepHandle = setInterval(() => this.sweep(), this.deps.timing.evictEveryMs);
    this.sweepHandle.unref?.();
  }

  stop(): void {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    this.sweepHandle = null;
  }

  /** `live:list` (plan 7.4.4): watchable games in `playing`, by average rating then spectators, ≤ 20, from memory. */
  liveCards(timeClass?: LiveTimeClass): LiveGameCard[] {
    const cards: (LiveGameCard & { avg: number })[] = [];
    for (const session of this.sessions.values()) {
      const s = session.state;
      if (s.phase !== "playing" || s.frozen) continue;
      const pool = s.timeClass === "classical" ? "rapid" : s.timeClass;
      if (timeClass && pool !== timeClass) continue;
      const tc = s.tc ? { initialSeconds: s.tc.initialMs / 1000, incrementSeconds: s.tc.incrementMs / 1000 } : null;
      const wr = s.seats.w.rating;
      const br = s.seats.b.rating;
      const rated = [wr, br].filter((x): x is number => x !== null);
      cards.push({
        ref: s.ref,
        mode: s.mode,
        timeClass: s.timeClass,
        tcLabel: tcLabel(tc).slice(0, 12),
        white: { name: s.seats.w.name.slice(0, 40), rating: wr },
        black: { name: s.seats.b.name.slice(0, 40), rating: br },
        ply: s.startPly + s.moves.length,
        spectators: session.spectators.count,
        startedAt: s.startedAt ?? s.createdAt,
        avg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0,
      });
    }
    cards.sort((a, b) => b.avg - a.avg || b.spectators - a.spectators);
    return cards.slice(0, LIVE_LIST_MAX).map((card) => {
      const { avg, ...wire } = card;
      void avg;
      return wire;
    });
  }

  /** Every session (drain, shutdown). */
  destroyAll(): void {
    this.stop();
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
  }
}
