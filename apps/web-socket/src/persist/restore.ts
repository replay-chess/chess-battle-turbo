// Restore at boot (phase-02 plan 7.6 "Restore at boot", socket §18.4, T19/T20):
//   1. read every journal file and load every candidate in ONE statement (`loadRestoreCandidates`: the journal refs
//      plus the restore list of 6.6.8). One load per candidate opened a new pooled connection per parallel load: on
//      the dev box (Mumbai → Neon us-east-1) one live game took 5.6–6.9 s to restore, while every reconnecting join
//      waited behind the gate. If that statement fails, each game is loaded on its own (and deferred on failure);
//   2. per game take the longer move list (the journal wins ties) and push the plies the DB lacks with one checkpoint;
//   3. `new Chess(startFen)` and replay every ply (threefold history intact; never load a FEN). An illegal ply →
//      the game is aborted with `meta.abortedBy = "stale"`, Sentry error, `ws.restore{result:"corrupt"}`;
//   4. phase, deadlines, draw offer and clocks are restored FROZEN with every player offline;
//   5. the session resumes when both players attach, or RESUME_MAX_WAIT_MS after boot (a deadline that passed during
//      the downtime is extended by it: game-core shifts every deadline by the frozen time);
//   6. the caller marks the server restored (`/ready` 200) and runs the boot stale sweep once.
// A journal whose `open.v` is newer than this build is skipped (the DB row is used; `journal_newer`), so rolling the
// image back across a journal format change is safe. A journal that ended a game the DB still shows IN_PROGRESS (the
// process died before the finish committed) finishes it now with the journal's result. A game whose DB load fails
// here (Neon unreachable at boot) is deferred: its first join that reaches the DB runs the same restore, so the
// journal-only plies are never dropped (FIX-A).
import { abortGame, loadRestoreCandidates, RESTORE_WINDOW_MS, type LiveGameRecord, type SqlClient } from "@repo/db/live";
import {
  foldJournal,
  progressFromJournal,
  restoreGame,
  splitMoves,
  type AbortedBy,
  type FoldedJournal,
  type GameResult,
  type ServerGame,
} from "@repo/game-core";
import type { Timing } from "../config/timing";
import type { SessionIds } from "../game/LiveSession";
import { buildServerGame, createInputOf, seatsOf, type SessionRegistry } from "../game/SessionRegistry";
import type { LogFields, Logger, Metrics } from "../ports";
import type { Journal, JournalFile } from "./journal";
import type { OutboxPersistence } from "./outbox";

export interface RestoreDeps {
  db: SqlClient;
  journal: Journal | null;
  registry: SessionRegistry;
  persistence: OutboxPersistence;
  timing: Timing;
  now(): number;
  log: Logger;
  metrics: Metrics;
  /** A Sentry warning without an exception (`journal_newer`). */
  warn?(message: string, fields?: LogFields): void;
  /** Parallel restores (only the fallback path loads one game per statement). */
  concurrency?: number;
  /** Restore window of the candidates statement (default RESTORE_WINDOW_MS). */
  windowMs?: number;
}

export interface RestoreReport {
  journalFiles: number;
  candidates: number;
  /** Sessions now in memory, frozen until both players attach. */
  restored: string[];
  /** Of those, restored from the journal (the rest from the DB row alone). */
  fromJournal: string[];
  /** Journal plies the DB lacked, written with one checkpoint. */
  pushed: string[];
  corrupt: string[];
  /** Games the journal had ended but the DB had not: finished/aborted now. */
  finishedFromJournal: string[];
  journalNewer: string[];
  /** Games whose DB load failed: restored from their journal on the first join that reaches the DB. */
  deferred: string[];
  /** Journal files of games the DB had already ended: kept only until their retention (from the file's last write). */
  endedInDb: number;
  /** Time reading the journal and in the candidates statement (the rest is replay, pushes and cleanup). */
  journalMs: number;
  dbMs: number;
  ms: number;
}

const startsWith = (long: readonly string[], prefix: readonly string[]) => prefix.every((m, i) => long[i] === m);

function idsOf(r: LiveGameRecord): SessionIds {
  return {
    dbId: r.id,
    userIds: seatsOf(r).userIds,
    tournament: r.tournament ? { ref: r.tournament.ref, name: r.tournament.name } : null,
  };
}

type Built =
  | { kind: "live"; state: ServerGame; fromJournal: boolean; push: boolean }
  | { kind: "ended"; state: ServerGame; result: GameResult; abortedBy: AbortedBy | null }
  | { kind: "corrupt"; index: number; source: "journal" | "db" }
  | { kind: "skip" };

/** Builds the restored state of one IN_PROGRESS row (+ its journal). Pure apart from `now`. */
export function buildRestored(record: LiveGameRecord, folded: FoldedJournal | null, now: number, timing: Timing): Built {
  const input = createInputOf(record);
  if (!input) return { kind: "skip" };
  const dbMoves = splitMoves(record.moves);
  const journalUsable = !!folded?.open && folded.moves.length >= dbMoves.length;
  if (!folded || !journalUsable) {
    const built = buildServerGame(record, now, timing.machine.resumeMaxWaitMs);
    if (!built.ok) {
      const index = Number(/corrupt_at_(\d+)/.exec(built.reason)?.[1] ?? -1);
      return built.code === "internal" ? { kind: "corrupt", index, source: "db" } : { kind: "skip" };
    }
    if (!built.restored) return { kind: "skip" }; // no progress yet: loaded lazily on the first join
    return { kind: "live", state: built.state, fromJournal: false, push: false };
  }
  const initialMs = input.tc?.initialMs ?? 0;
  const progress = progressFromJournal(folded, initialMs);
  if (folded.end) {
    // Ended in the journal, not in the DB: rebuild the final position and finish it now.
    const r = restoreGame(input, { ...progress, phase: "ended" }, now, timing.machine.resumeMaxWaitMs);
    if (!r.ok) return { kind: "corrupt", index: r.index, source: "journal" };
    const end = folded.end;
    const abortedBy = end.method === "aborted" ? ((end.by as AbortedBy | undefined) ?? "stale") : null;
    const result: GameResult = {
      winner: end.winner,
      method: end.method,
      ply: r.state.startPly + r.state.moves.length,
      endedAt: end.at,
      ...(abortedBy ? { abortedBy } : {}),
    };
    const state: ServerGame = {
      ...r.state,
      phase: "ended",
      frozen: null,
      clocks: { ...r.state.clocks, run: null, at: end.at },
      result,
      abortedBy,
    };
    return { kind: "ended", state, result, abortedBy };
  }
  const r = restoreGame(input, progress, now, timing.machine.resumeMaxWaitMs);
  if (!r.ok) return { kind: "corrupt", index: r.index, source: "journal" };
  return { kind: "live", state: r.state, fromJournal: true, push: folded.moves.length > dbMoves.length };
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function restoreAtBoot(deps: RestoreDeps): Promise<RestoreReport> {
  const { db, journal, registry, persistence, timing, now, log, metrics } = deps;
  const started = now();
  const report: RestoreReport = {
    journalFiles: 0,
    candidates: 0,
    restored: [],
    fromJournal: [],
    pushed: [],
    corrupt: [],
    finishedFromJournal: [],
    journalNewer: [],
    deferred: [],
    endedInDb: 0,
    journalMs: 0,
    dbMs: 0,
    ms: 0,
  };

  const files = new Map<string, JournalFile>();
  for (const f of journal ? await journal.readAll() : []) files.set(f.ref, f);
  report.journalFiles = files.size;
  report.journalMs = now() - started;

  let records: Map<string, LiveGameRecord> | null = null;
  const dbStarted = now();
  try {
    const rows = await loadRestoreCandidates(db, [...files.keys()], deps.windowMs ?? RESTORE_WINDOW_MS);
    records = new Map(rows.map((r) => [r.ref, r]));
  } catch (error) {
    // Without it the journal files still restore their games: their rows are loaded one by one below (and a game
    // whose load fails too is deferred to its first join).
    log.error("restore candidates failed", { op: "restore" }, error);
  }
  report.dbMs = now() - dbStarted;
  const refs = [...new Set([...(records?.keys() ?? []), ...files.keys()])];
  report.candidates = refs.length;

  /** Restores one IN_PROGRESS row with its journal (if any). Returns the session it adopted, if any. */
  async function restoreOne(ref: string, record: LiveGameRecord, file: JournalFile | null): Promise<void> {
    const folded = file?.readable ? foldJournal(file.lines) : null;
    if (folded && folded.moves.length > 0 && !startsWith(folded.moves, splitMoves(record.moves))) {
      metrics.count("ws.persist.conflict");
      log.warn("journal and DB move lists diverge; the longer one wins", { game: ref });
    }
    const built = buildRestored(record, folded, now(), timing);
    switch (built.kind) {
      case "skip":
        return;
      case "corrupt": {
        report.corrupt.push(ref);
        metrics.count("ws.restore", { result: "corrupt" });
        log.error("restore replay failed: aborting the game", { game: ref, ply: built.index, reason: built.source });
        await abortGame(db, { gameId: record.id, abortedBy: "stale", endedAt: new Date(now()) }).catch((error: unknown) =>
          log.error("abort of a corrupt game failed", { game: ref }, error),
        );
        return;
      }
      case "ended": {
        if (file) journal?.continueFile(ref);
        const session = registry.adopt(built.state, idsOf(record));
        const out = await session.trackEnding(
          built.result.method === "aborted"
            ? persistence.abort(session, built.result, built.abortedBy ?? "stale")
            : persistence.finish(session, built.result),
        );
        if (out.committed) report.finishedFromJournal.push(ref);
        metrics.count("ws.restore", { result: "finished" });
        return;
      }
      case "live": {
        if (built.fromJournal) journal?.continueFile(ref);
        const session = registry.adopt(built.state, idsOf(record));
        // Arm the resume deadline (RESUME_MAX_WAIT_MS) through the reducer's timer bookkeeping.
        session.dispatch({ type: "timer" });
        report.restored.push(ref);
        if (built.fromJournal) report.fromJournal.push(ref);
        metrics.count("ws.restore", { result: built.fromJournal ? "journal" : "db" });
        if (built.push && (await persistence.writeNow(session))) report.pushed.push(ref);
        return;
      }
    }
  }

  await mapLimit(refs, deps.concurrency ?? 4, async (ref) => {
    const file = files.get(ref) ?? null;
    try {
      if (file && !file.readable) {
        report.journalNewer.push(ref);
        metrics.count("ws.restore", { result: "journal_newer" });
        deps.warn?.("journal format newer than this build; restoring from the DB row", { game: ref, reason: "journal_newer" });
        log.warn("journal skipped (newer format)", { game: ref, v: file.version ?? -1 });
      }
      const record = records ? (records.get(ref) ?? null) : await persistence.load(ref);
      if (!record) return;
      if (record.status !== "IN_PROGRESS") {
        // Already ended (or never started) in the DB. The file is kept for its retention after the end, counted from
        // its last write (≈ the end), not from this boot: re-marking it "committed now" on every boot kept the files
        // of finished games as restore candidates across restarts (dev box: one more candidate per restart).
        report.endedInDb++;
        if (file) journal?.committed(ref, Math.min(now(), file.mtimeMs));
        return;
      }
      await restoreOne(ref, record, file);
    } catch (error) {
      metrics.count("ws.restore", { result: "error" });
      log.error("restore failed", { game: ref }, error);
      if (file?.readable && !registry.get(ref)) {
        // The DB was unreachable for this game (FIX-A): its journal may hold plies the row lacks. The first join that
        // reaches the DB runs this same restore instead of building the session from the row alone.
        report.deferred.push(ref);
        registry.deferRestore(ref, async (record) => {
          if (record.status !== "IN_PROGRESS") {
            journal?.committed(ref, now());
            return null;
          }
          await restoreOne(ref, record, file);
          const session = registry.get(ref);
          return session ? { ok: true, session } : null;
        });
      }
    }
  });

  if (journal) {
    const live = new Set<string>([...[...registry.all()].map((s) => s.ref), ...registry.deferredRefs()]);
    await journal.cleanup(live).catch((error: unknown) => log.warn("journal cleanup failed", { err: String(error) }));
  }
  report.ms = now() - started;
  log.info("restore finished", {
    candidates: report.candidates,
    restored: report.restored.length,
    fromJournal: report.fromJournal.length,
    pushed: report.pushed.length,
    corrupt: report.corrupt.length,
    finished: report.finishedFromJournal.length,
    endedInDb: report.endedInDb,
    deferred: report.deferred.length,
    journalMs: report.journalMs,
    dbMs: report.dbMs,
    ms: report.ms,
  });
  return report;
}
