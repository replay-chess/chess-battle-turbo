// An in-memory AnalysisStore + LegendCompareStore for the pipeline unit tests (phase-03 plan §12.1 `pipeline`,
// `resume`, `failure`). It shares the jobs with a FakeQueue, so its writes obey the same rules as the SQL store:
// every write checks the lock guard first (throwing SQLSTATE 22012 when the job is no longer ours, which the runner
// reads as "lost"), `finish`/`skip` mark the job DONE in the same step, a checkpoint returns the job's priority, and a
// failed ANALYZE_GAME marks the game FAILED with `failedAtPly` (FakeQueue.gameOnFail). Each method counts one round
// trip, like the SQL store's single statement or batch.
import type { Row, Statement } from "../db/client";
import type { AnalysisStore, LegendCompareStore } from "../pipeline/store";
import type {
  CheckpointWrite,
  FinalWrite,
  GameMember,
  GoneWrite,
  LegendCompareLoad,
  LegendSource,
  LoadedGame,
  MemberWrite,
  OpeningRow,
  SkipWrite,
  StoredAnalysis,
  StoredComparison,
} from "../pipeline/types";
import type { FakeQueue } from "./fake-queue";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface MemGameInit {
  id: string;
  ref: string;
  moves: string[];
  members: GameMember[];
  status?: string;
  mode?: string | null;
  startingFen?: string;
  startPly?: number;
  completedAtMs?: number | null;
  ecoCode?: string | null;
  analysisStatus?: string;
  analysis?: StoredAnalysis | null;
  legend?: LegendSource | null;
  comparisons?: StoredComparison[];
}

export interface MemFinal {
  lines: FinalWrite["lines"];
  accuracy: FinalWrite["accuracy"];
  counts: FinalWrite["counts"];
  middlegamePly: number | null;
  endgamePly: number | null;
  depthP50: number | null;
  readyMs: number | null;
}

export interface MemGame {
  init: MemGameInit;
  analysisStatus: string;
  ecoCode: string | null;
  openingName: string | null;
  analysis: StoredAnalysis | null;
  final: MemFinal | null;
  failedAtPly: number | null;
  reviews: Map<string, { content: MemberWrite["content"]; textStatus: string }>;
  players: Map<string, Omit<MemberWrite, "content" | "color">>;
  comparisons: Map<string, StoredComparison>;
  gamesVersionBumps: number;
}

export type MemWrite =
  | { kind: "checkpoint"; gameId: string; gradedPlies: number; evals: number[]; judgements: number[] }
  | { kind: "finish"; gameId: string; statements: number; extensions: number }
  | { kind: "skip"; gameId: string; reason: string }
  | { kind: "gone"; gameId: string }
  | { kind: "legend"; gameId: string; userId: string };

export class MemoryAnalysisStore implements AnalysisStore, LegendCompareStore {
  readonly games = new Map<string, MemGame>();
  readonly writes: MemWrite[] = [];
  trips = 0;
  openingRows: OpeningRow[] = [];
  openingLoads = 0;
  /** The next N writes throw a transient network error (the client's retry is not modelled here). */
  failWrites = 0;
  /** What each final-batch extension statement returns here (SQL is not run in memory); default no rows. */
  extensionRows: (s: Statement) => Row[] = () => [];

  constructor(
    private readonly queue: FakeQueue,
    private readonly now: () => number,
  ) {
    queue.gameOnFail = (gameId) => {
      const g = this.games.get(gameId);
      if (!g) return null;
      if (["QUEUED", "RUNNING", "FAILED"].includes(g.analysisStatus)) g.analysisStatus = "FAILED";
      const graded = g.analysis?.gradedPlies ?? 0;
      if (g.analysis) g.failedAtPly = graded;
      g.gamesVersionBumps++;
      return {
        ref: g.init.ref,
        plyCount: g.init.moves.length,
        gradedPlies: graded,
        members: g.init.members.map((m) => m.userRef),
      };
    };
  }

  add(init: MemGameInit): MemGame {
    const g: MemGame = {
      init,
      analysisStatus: init.analysisStatus ?? "QUEUED",
      ecoCode: init.ecoCode ?? null,
      openingName: null,
      analysis: init.analysis ? structuredClone(init.analysis) : null,
      final: null,
      failedAtPly: null,
      reviews: new Map(),
      players: new Map(),
      comparisons: new Map((init.comparisons ?? []).map((c) => [c.userId, structuredClone(c)])),
      gamesVersionBumps: 0,
    };
    this.games.set(init.id, g);
    return g;
  }

  private held(jobId: string, me: string) {
    const job = this.queue.jobs.find((j) => j.id === jobId);
    if (!job || job.lockedBy !== me || job.status !== "RUNNING") {
      throw Object.assign(new Error("division by zero"), { code: "22012" });
    }
    return job;
  }

  private pendingDelete: string | null = null;

  /** deleteGameOnNextWrite: the row goes now, and the write fails like Postgres's FK check (23503). */
  private foreignKey(gameId: string): void {
    if (this.pendingDelete !== gameId) return;
    this.pendingDelete = null;
    this.games.delete(gameId);
    throw Object.assign(new Error('insert or update on table "game_analyses" violates foreign key constraint "game_analyses_gameId_fkey"'), {
      code: "23503",
    });
  }

  private trip(): void {
    this.trips++;
    if (this.failWrites > 0) {
      this.failWrites--;
      throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
    }
  }

  async load(gameId: string, jobId: string): Promise<LoadedGame | null> {
    this.trips++;
    const g = this.games.get(gameId);
    if (!g) return null;
    const status = g.init.status ?? "COMPLETED";
    if (status === "COMPLETED" && ["NONE", "QUEUED", "FAILED"].includes(g.analysisStatus)) g.analysisStatus = "RUNNING";
    const job = this.queue.jobs.find((j) => j.id === jobId);
    return structuredClone({
      id: g.init.id,
      ref: g.init.ref,
      status,
      mode: g.init.mode ?? "BOT",
      startingFen: g.init.startingFen ?? INITIAL_FEN,
      startPly: g.init.startPly ?? 0,
      moves: g.init.moves,
      plyCount: g.init.moves.length,
      completedAtMs: g.init.completedAtMs ?? null,
      ecoCode: g.ecoCode,
      openingName: g.openingName,
      members: g.init.members,
      analysis: g.analysis,
      legend: g.init.legend ?? null,
      comparisons: [...g.comparisons.values()],
      jobLastError: job?.lastError ?? null,
    });
  }

  async checkpoint(w: CheckpointWrite): Promise<number> {
    this.trip();
    this.foreignKey(w.gameId);
    const job = this.held(w.jobId, w.me);
    const g = this.games.get(w.gameId)!;
    g.analysis = {
      version: w.identity.version,
      engine: w.identity.engine,
      nodesPass1: w.identity.nodesPass1,
      nodesPass2: w.identity.nodesPass2,
      totalPlies: w.identity.totalPlies,
      gradedPlies: w.gradedPlies,
      evals: [...w.arrays.evals],
      second: [...w.arrays.second],
      best: [...w.arrays.best],
      judgements: [...w.arrays.judgements],
      lines: null,
      completed: false,
      depthP50: null,
    };
    g.final = null;
    g.failedAtPly = null;
    for (const c of w.newComparisons) {
      if (!g.comparisons.has(c.userId))
        g.comparisons.set(c.userId, { userId: c.userId, status: "FACTS_READY", facts: structuredClone(c.facts) });
    }
    job.heartbeatAtMs = this.now();
    this.writes.push({
      kind: "checkpoint",
      gameId: w.gameId,
      gradedPlies: w.gradedPlies,
      evals: [...w.arrays.evals],
      judgements: [...w.arrays.judgements],
    });
    return job.priority;
  }

  async finish(w: FinalWrite): Promise<Row[][] | null> {
    this.trip();
    this.foreignKey(w.gameId);
    const job = this.held(w.jobId, w.me);
    const g = this.games.get(w.gameId)!;
    g.analysis = {
      version: w.identity.version,
      engine: w.identity.engine,
      nodesPass1: w.identity.nodesPass1,
      nodesPass2: w.identity.nodesPass2,
      totalPlies: w.identity.totalPlies,
      gradedPlies: w.identity.totalPlies,
      evals: [...w.arrays.evals],
      second: [...w.arrays.second],
      best: [...w.arrays.best],
      judgements: [...w.arrays.judgements],
      lines: structuredClone(w.lines),
      completed: true,
      depthP50: w.depthP50,
    };
    g.failedAtPly = null;
    const completedAt = g.init.completedAtMs ?? null;
    g.final = {
      lines: structuredClone(w.lines),
      accuracy: w.accuracy,
      counts: w.counts,
      middlegamePly: w.middlegamePly,
      endgamePly: w.endgamePly,
      depthP50: w.depthP50,
      readyMs: w.measureReady && completedAt !== null ? Math.max(0, this.now() - completedAt) : null,
    };
    g.analysisStatus = "DONE";
    if (g.ecoCode === null && w.opening) {
      g.ecoCode = w.opening.eco;
      g.openingName = w.opening.name;
    }
    for (const m of w.members) {
      g.reviews.set(m.color, { content: structuredClone(m.content), textStatus: "TEMPLATE" });
      g.players.set(m.color, {
        accuracy: m.accuracy,
        headline: m.headline,
        momentsCount: m.momentsCount,
        counts: [...m.counts],
        phaseAccuracy: [...m.phaseAccuracy],
      });
    }
    g.gamesVersionBumps++;
    for (const c of w.comparisons) {
      const existing = g.comparisons.get(c.userId);
      if (!existing) {
        g.comparisons.set(c.userId, {
          userId: c.userId,
          status: c.ready ? "READY" : "FACTS_READY",
          facts: structuredClone(c.facts),
        });
      } else if (c.ready && (existing.status === "FACTS_READY" || existing.status === "FAILED")) {
        existing.facts = { ...(existing.facts as object), evalAtDivergence: c.facts.evalAtDivergence };
        existing.status = "READY";
      }
    }
    Object.assign(job, { status: "DONE", result: structuredClone(w.result), finishedAtMs: this.now() });
    // guard + analyses + games + reviews + players + users + [comparisons] + extensions + done
    const statements = 7 + (w.comparisons.length ? 1 : 0) + w.extensions.length;
    this.writes.push({ kind: "finish", gameId: w.gameId, statements, extensions: w.extensions.length });
    return w.extensions.map((x) => this.extensionRows(x));
  }

  async skip(w: SkipWrite): Promise<void> {
    this.trip();
    const job = this.held(w.jobId, w.me);
    const g = this.games.get(w.gameId)!;
    if (g.analysisStatus !== "SKIPPED") {
      g.analysisStatus = "SKIPPED";
      g.gamesVersionBumps++;
    }
    Object.assign(job, { status: "DONE", result: { skipped: w.reason }, finishedAtMs: this.now() });
    this.writes.push({ kind: "skip", gameId: w.gameId, reason: w.reason });
  }

  async gone(w: GoneWrite): Promise<boolean> {
    this.trip();
    if (this.games.has(w.gameId)) return false;
    const job = this.held(w.jobId, w.me);
    Object.assign(job, { status: "DONE", result: { skipped: "game_gone" }, finishedAtMs: this.now() });
    this.writes.push({ kind: "gone", gameId: w.gameId });
    return true;
  }

  /** Test hook: the game is deleted (an import purge) the next time the pipeline writes; that write fails with 23503. */
  deleteGameOnNextWrite(gameId: string): void {
    this.pendingDelete = gameId;
  }

  async openings(): Promise<OpeningRow[]> {
    this.trips++;
    this.openingLoads++;
    return this.openingRows;
  }

  async queuedFor(userRefs: readonly string[]): Promise<Map<string, number>> {
    this.trips++;
    const out = new Map<string, number>();
    for (const job of this.queue.jobs) {
      if (job.kind !== "ANALYZE_GAME" || job.status !== "QUEUED") continue;
      const g = this.games.get(String(job.payload.gameId));
      for (const m of g?.init.members ?? []) {
        if (userRefs.includes(m.userRef)) out.set(m.userRef, (out.get(m.userRef) ?? 0) + 1);
      }
    }
    return out;
  }

  async loadComparison(gameId: string, userId: string): Promise<LegendCompareLoad | null> {
    this.trips++;
    const g = this.games.get(gameId);
    if (!g) return null;
    const m = g.init.members.find((x) => x.userId === userId);
    return structuredClone({
      gameId,
      ref: g.init.ref,
      status: g.init.status ?? "COMPLETED",
      startingFen: g.init.startingFen ?? INITIAL_FEN,
      moves: g.init.moves,
      member: m ? { color: m.color, userRef: m.userRef } : null,
      comparison: g.comparisons.get(userId) ?? null,
    });
  }

  async completeComparison(input: {
    jobId: string;
    me: string;
    gameId: string;
    userId: string;
    evalAtDivergence: { userWin: number; legendWin: number } | null;
  }): Promise<void> {
    this.trip();
    const job = this.held(input.jobId, input.me);
    const c = this.games.get(input.gameId)?.comparisons.get(input.userId);
    if (c && (c.status === "FACTS_READY" || c.status === "FAILED")) {
      if (input.evalAtDivergence) c.facts = { ...(c.facts as object), evalAtDivergence: input.evalAtDivergence };
      c.status = "READY";
    }
    Object.assign(job, {
      status: "DONE",
      result: { evals: input.evalAtDivergence !== null },
      finishedAtMs: this.now(),
    });
    this.writes.push({ kind: "legend", gameId: input.gameId, userId: input.userId });
  }

  async failComparison(input: { gameId: string; userId: string; error: string }): Promise<void> {
    this.trips++;
    const c = this.games.get(input.gameId)?.comparisons.get(input.userId);
    if (c && c.status === "FACTS_READY") c.status = "FAILED";
  }
}
