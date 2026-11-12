// ANALYZE_GAME (phase-03 plan §8.12 "Run ANALYZE_GAME", §8.14, §10; task C5).
//
//   load (1 statement; games → RUNNING) → guards (SKIPPED) → replay → resume point / regrade path → band
//   → pass 1 (cache → engine, MultiPV 2, every position; a checkpoint every 10 plies; progress frames)
//   → classify → `analysis:writing` → pass 2 (≤ 6 positions at 1M nodes MultiPV 3, ≤ 60 s: the key-moment and
//   brilliant candidates before and after the ply, and the legend divergence) → grade + moments + texts (CA)
//   → the final batch (one request) → events (per game for band ≥ 80 or watched, else `analysis:batch`)
//   → telemetry (`analysis_started` / `analysis_ready`, Sentry spans and metrics).
//
// Pass 2 overwrites the arrays at the positions it searched (`evals`, `second`, `best`), so the stored arrays are
// exactly what the grade was computed from and an engine-free regrade (§8.14) reproduces it (WP-A's contract).
//
// Failures throw: a JobError with its contract code, EngineFailed (`engine_failed`), anything else `internal`; the
// runner writes the back-off, marks the game FAILED and emits `analysis:failed`. SIGTERM stops at the next position:
// the progress since the last checkpoint is checkpointed, then JobAborted releases the job without counting the
// attempt. A job lost to the reaper writes nothing more.
//
// Test faults (§7.9, §12.3; dev/test only): `fail_at_ply:n` fails the attempt when n plies are graded,
// `stall_at_ply:n` stops heart-beating there and holds the job past the reaper's limit before failing it
// `worker_stalled`, `engine_crash:n` kills the engine before the next n searches, `pause_at:<phase>:<ms>` waits at
// the start of `pass1`, `writing` (pass 2) or `write` (the final batch).
import { gradeAnalysis, type AnalysisMember, type AnalysisResult } from "@repo/chess-analysis/analysis";
import { classifyGame, gradeCodes } from "@repo/chess-analysis/classify";
import { decodeMove, type Color } from "@repo/chess-analysis/codec";
import { acceptMoves, pass2Candidates } from "@repo/chess-analysis/moments";
import { regradeAnalysis } from "@repo/chess-analysis/regrade";
import { replayUci, type Replay } from "@repo/chess-analysis/replay";
import type { LineFacts } from "@repo/chess-analysis/review";
import { analysisEngine, ENGINE_PROFILE, GRADING_VERSION, profileOf } from "@repo/chess-analysis/version";
import { checkpointSpacing, isCheckpointPly } from "@repo/contracts/http/plain";
import { ANALYSIS_MIN_PLIES, bandOf, streamsProgress } from "@repo/contracts/internal/jobs";
import type { AnalysisFailureCode } from "@repo/contracts/http/review";
import { analysisDoneDedupeKey } from "@repo/contracts/socket/analysis";
import { buildReviewContent, LinesV1 } from "@repo/db/json";
import type { Fault } from "../config/faults";
import { REAP_STALE_SEC } from "../queue/outcome";
import { buildEvent } from "../socket/events";
import { JobAborted, JobError, type JobContext, type JobHandler } from "../jobs/types";
import type { ProductEvents } from "../obs/posthog";
import type { FailureHookInput } from "../jobs/types";
import type { BatchAccumulator } from "./batch-events";
import { extensionStatements, FINAL_BATCH_EXTENSIONS, type FinalBatchExtension } from "./final-batch";
import { divergenceOf, evalAtDivergence, legendPosition, memberFacts, type MemberFacts } from "./legend";
import { openingOf, type OpeningBook, type OpeningIndex } from "./openings";
import { fromInitialPosition, planPositions, type PositionPlan } from "./positions";
import { ProgressStream } from "./progress";
import { medianDepth, Searcher, type PositionEval } from "./search";
import type { AnalysisStore } from "./store";
import type { AnalysisArrays, AnalysisIdentity, ComparisonWrite, GameMember, LoadedGame, MemberWrite } from "./types";

/**
 * Checkpoints (§8.12 step 5, P3-D6): every 10 graded plies, spread out on games over 70 plies so a game writes at
 * most 6 (the §9.1 budget of ≤ 10 statements: claim, load, ≤ 6 checkpoints, final, drain end). The spacing is a
 * shared contract (`checkpointSpacing`): the live client uses it to know when A1 can hold newer plies.
 */
export { checkpointSpacing, isCheckpointPly };
/** `stall_at_ply`: hold the job this long without a heartbeat (past the reaper's 3 minutes) before failing it. */
export const STALL_HOLD_MS = (REAP_STALE_SEC + 30) * 1000;
/** Reasons whose run measures `readyMs` / `ms_from_game_end` (regrades, backfills and smoke runs are excluded). */
const MEASURED_REASONS = new Set(["live_end", "bot_end", "opened"]);
const MAX_MS = 86_400_000;
const FAILURE_CODES: readonly AnalysisFailureCode[] = ["engine_failed", "worker_stalled", "timeout", "internal"];

export interface AnalyzeDeps {
  store: AnalysisStore;
  book: OpeningBook;
  batch: BatchAccumulator;
  events: ProductEvents;
  extensions?: readonly FinalBatchExtension[];
}

type Ctx = JobContext<"ANALYZE_GAME">;

/** Why a loaded game is not analysed (§8.12 step 1), or null. */
export function skipReasonOf(game: LoadedGame): string | null {
  if (game.status !== "COMPLETED") return `status_${game.status.toLowerCase()}`;
  if (game.moves.length === 0) return "no_moves";
  if (game.moves.length < ANALYSIS_MIN_PLIES || game.plyCount < ANALYSIS_MIN_PLIES) return "too_short";
  return null;
}

function memberResult(m: GameMember): AnalysisMember["result"] {
  return m.result === "WIN" ? "win" : m.result === "LOSS" ? "loss" : m.result === "DRAW" ? "draw" : null;
}

const clampMs = (ms: number) => Math.max(0, Math.min(MAX_MS, Math.round(ms)));

function emptyArrays(): AnalysisArrays {
  return { evals: [], second: [], best: [], judgements: [] };
}

function copyArrays(a: AnalysisArrays): AnalysisArrays {
  return { evals: [...a.evals], second: [...a.second], best: [...a.best], judgements: [...a.judgements] };
}

/**
 * The stored partial analysis this run continues from (§8.12 step 3): same engine build and profile, same grading
 * version, same game length, arrays of the checkpoint's shape. Anything else starts over from ply 0.
 */
export function resumeFrom(
  game: LoadedGame,
  engineId: string,
  totalPlies: number,
): { graded: number; arrays: AnalysisArrays } {
  const a = game.analysis;
  if (!a || a.completed || a.engine !== engineId || a.version !== GRADING_VERSION || a.totalPlies !== totalPlies) {
    return { graded: 0, arrays: emptyArrays() };
  }
  const r = a.gradedPlies;
  const fits =
    r > 0 &&
    r <= totalPlies &&
    a.evals.length >= r + 1 &&
    a.second.length >= r + 1 &&
    a.best.length >= r + 1 &&
    a.judgements.length >= r;
  if (!fits) return { graded: 0, arrays: emptyArrays() };
  return {
    graded: r,
    arrays: {
      evals: a.evals.slice(0, r + 1),
      second: a.second.slice(0, r + 1),
      best: a.best.slice(0, r + 1),
      judgements: a.judgements.slice(0, r),
    },
  };
}

/** A completed analysis of the current engine profile is re-graded without the engine (§8.14). */
export function canRegrade(game: LoadedGame, totalPlies: number): boolean {
  const a = game.analysis;
  return (
    a !== null &&
    a.completed &&
    profileOf(a.engine) === ENGINE_PROFILE.id &&
    a.totalPlies === totalPlies &&
    a.evals.length === totalPlies + 1 &&
    a.second.length === totalPlies + 1 &&
    a.best.length === totalPlies + 1
  );
}

/** The previous attempt's failure code from `jobs."lastError"` ("<code>: …"), or null. */
export function previousFailure(lastError: string | null): AnalysisFailureCode | null {
  const code = lastError?.split(":")[0]?.trim();
  return code && (FAILURE_CODES as readonly string[]).includes(code) ? (code as AnalysisFailureCode) : null;
}

export function analyzeGameHandler(deps: AnalyzeDeps): JobHandler<"ANALYZE_GAME"> {
  const extensions = deps.extensions ?? FINAL_BATCH_EXTENSIONS;
  return {
    kind: "ANALYZE_GAME",
    run: (ctx) => {
      const tags = {
        kind: "ANALYZE_GAME",
        attempt: ctx.job.attempts,
        priority: ctx.job.priority,
        band: bandOf(ctx.job.priority),
        profile: ENGINE_PROFILE.id,
      };
      return ctx.telemetry.span("job.analyze", tags, () => new Run(ctx, deps, extensions).go(), { transaction: true });
    },
    onFailed: (input) => onAnalysisFailed(deps, input),
  };
}

/** After the runner's fail write: telemetry, and the background band's `analysis:batch` count. */
function onAnalysisFailed(deps: AnalyzeDeps, input: FailureHookInput<"ANALYZE_GAME">): void {
  const { failed, code, ctx } = input;
  if (!failed?.game) return;
  const members = failed.game.members;
  if (members[0]) {
    deps.events.capture("analysis_failed", members[0], {
      code,
      attempt: Math.max(1, Math.min(10, failed.attempts)),
      failed_at_ply: Math.min(failed.game.gradedPlies, 1_200),
      retryable: failed.status === "QUEUED",
    });
  }
  ctx.telemetry.metric("count", "worker.job.fail", 1, { kind: "ANALYZE_GAME", code });
  if (!streamsProgress(ctx.job.priority, ctx.isWatched(failed.game.ref))) {
    deps.batch.add(members, failed.game.ref, "failed");
    void deps.batch.flushDue();
  }
}

class Run {
  private readonly startedMs: number;
  private readonly fault: Fault | null;
  private stream: ProgressStream | null = null;
  private searcher: Searcher | null = null;
  private lastCheckpoint = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly deps: AnalyzeDeps,
    private readonly extensions: readonly FinalBatchExtension[],
  ) {
    this.startedMs = ctx.clock.now();
    this.fault = ctx.takeFault(ctx.payload.gameRef);
  }

  private get gameRef(): string {
    return this.ctx.payload.gameRef;
  }

  private streams(): boolean {
    return streamsProgress(this.ctx.job.priority, this.ctx.isWatched(this.gameRef));
  }

  private span<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.telemetry.span(name, { kind: "ANALYZE_GAME" }, fn);
  }

  private async pauseAt(phase: string): Promise<void> {
    if (this.fault?.kind === "pause_at" && this.fault.phase === phase) {
      this.ctx.log.warn("test fault: pause", { phase, ms: this.fault.ms });
      await this.ctx.clock.sleep(this.fault.ms, this.ctx.signal);
    }
  }

  async go(): Promise<"done"> {
    const { ctx } = this;
    if (this.fault?.kind === "engine_crash") ctx.engine?.injectCrash(this.fault.count);
    const game = await this.span("load", () => this.deps.store.load(ctx.payload.gameId, ctx.job.id));
    if (!game) throw new JobError("internal", "the game no longer exists", { terminal: true });

    const reason = skipReasonOf(game);
    let replay: Replay | null = null;
    if (!reason) {
      try {
        replay = replayUci(game.startingFen, game.moves);
      } catch {
        replay = null;
      }
    }
    if (reason || !replay) return this.skip(game, reason ?? "unreplayable");

    const n = replay.uci.length;
    const priority = ctx.job.priority;
    if (canRegrade(game, n)) {
      this.started(game, 0);
      return this.regrade(game, replay);
    }
    if (!ctx.engine) throw new JobError("internal", "no engine in this worker", { terminal: true });
    const engineId = analysisEngine(ctx.engine.buildId);
    const resume = resumeFrom(game, engineId, n);
    this.started(game, resume.graded);
    ctx.log.info("analysis started", { gameRef: this.gameRef, plies: n, resumedFrom: resume.graded, priority });

    const book = await this.deps.book.get();
    const facts = memberFacts({
      legend: game.legend,
      comparisons: game.comparisons,
      members: game.members,
      startFen: game.startingFen,
      startPly: game.startPly,
      moves: replay.uci,
    });
    const identity: AnalysisIdentity = {
      version: GRADING_VERSION,
      engine: engineId,
      nodesPass1: ENGINE_PROFILE.pass1.nodes,
      nodesPass2: ENGINE_PROFILE.pass2.nodes,
      totalPlies: n,
    };
    const positions = planPositions(replay);
    const searcher = new Searcher({
      engine: ctx.engine,
      cache: ctx.evalCache,
      lag: ctx.lag,
      signal: ctx.signal,
      fromInitial: fromInitialPosition(replay),
    });
    this.searcher = searcher;
    const memberRefs = game.members.map((m) => m.userRef);
    this.stream = new ProgressStream({
      emitter: ctx.emitter,
      clock: ctx.clock,
      gameRef: this.gameRef,
      totalPlies: n,
      memberRefs,
      streams: () => this.streams(),
      depthP50: () => medianDepth(searcher.stats.depths) ?? 0,
    });

    // ── pass 1 ───────────────────────────────────────────────────────────────────────────────────────────────
    await this.pauseAt("pass1");
    const arrays = resume.arrays;
    this.lastCheckpoint = resume.graded;
    this.stream.start(resume.graded, arrays);
    const newFacts = facts.filter((f) => !f.stored);
    let factsPending = newFacts.length > 0;
    const pass1Ms0 = ctx.clock.now();
    await this.span("pass1", async () => {
      // No per-game `ucinewgame` here: the Searcher clears the engine before every search (history-independent facts).
      for (let i = arrays.evals.length; i <= n; i++) {
        await this.safePoint({
          game,
          identity,
          arrays,
          replay: replay!,
          book,
          graded: Math.max(0, i - 1),
          newFacts: factsPending ? newFacts : [],
        });
        const pos = positions[i] as PositionPlan;
        const e = await searcher.evaluate(pos, ENGINE_PROFILE.pass1, { pass1: true });
        arrays.evals[i] = e.eval;
        arrays.second[i] = e.second;
        arrays.best[i] = e.best;
        if (i === 0) continue;
        const graded = i;
        await this.faultAt(graded);
        const checkpointDue = isCheckpointPly(graded, n);
        const frameDue = this.stream!.wants(graded);
        if (checkpointDue || frameDue) arrays.judgements = this.streamGrades(replay!, arrays, book, graded);
        if (checkpointDue) {
          await this.checkpoint({ game, identity, arrays, graded, newFacts: factsPending ? newFacts : [] });
          factsPending = false;
        }
        if (frameDue) this.stream!.update(graded, arrays);
      }
    });
    const pass1Ms = ctx.clock.now() - pass1Ms0;
    arrays.judgements = this.streamGrades(replay, arrays, book, n);
    this.stream.flush(n, arrays);
    const pass1Arrays = copyArrays(arrays);

    // ── pass 2 ───────────────────────────────────────────────────────────────────────────────────────────────
    await this.stream.drain();
    if (this.streams())
      await ctx.emitter.emit("analysis:writing", buildEvent("analysis:writing", { gameRef: this.gameRef }), memberRefs);
    await this.pauseAt("writing");
    const pass2Ms0 = ctx.clock.now();
    // The legend evals are searched only while some member's facts still lack them.
    const divergence = facts.some((f) => f.facts.evalAtDivergence === null) ? divergenceOf(facts) : null;
    const { lines, searched, legendEvals } = await this.span("pass2", () =>
      this.pass2({
        game,
        replay: replay!,
        positions,
        arrays,
        pass1Arrays,
        book,
        identity,
        divergence,
        newFacts: factsPending ? newFacts : [],
      }),
    );
    const pass2Ms = ctx.clock.now() - pass2Ms0;

    // ── grade, moments, texts ────────────────────────────────────────────────────────────────────────────────
    const result = await this.span("classify", async () =>
      gradeAnalysis({
        startFen: game.startingFen,
        startPly: game.startPly,
        moves: replay!.uci,
        evals: arrays.evals,
        second: arrays.second,
        best: arrays.best,
        lines,
        isBook: (epd) => book.book.has(epd),
        members: game.members.map((m) => ({
          side: m.color,
          result: memberResult(m),
          legend: this.legendFor(m, facts, game),
        })),
      }),
    );
    arrays.judgements = result.judgements;
    const comparisons: ComparisonWrite[] = facts.map((f) => {
      const evals = legendEvals ? evalAtDivergence(f.color, legendEvals.game, legendEvals.legend) : null;
      if (evals && f.facts.divergencePly !== null)
        return { userId: f.userId, facts: { ...f.facts, evalAtDivergence: evals }, ready: true };
      return { userId: f.userId, facts: f.facts, ready: false };
    });
    const members = await this.span("text", async () => this.memberWrites(game, result));

    await this.pauseAt("write");
    await this.span("write", () =>
      this.deps.store.finish({
        jobId: ctx.job.id,
        me: ctx.me,
        gameId: game.id,
        identity,
        arrays,
        lines: LinesV1.parse(result.lines),
        middlegamePly: result.division.middlegamePly,
        endgamePly: result.division.endgamePly,
        accuracy: result.accuracy,
        counts: result.counts,
        depthP50: medianDepth(searcher.stats.depths),
        measureReady: MEASURED_REASONS.has(ctx.payload.reason),
        members,
        opening: game.ecoCode ? null : openingOf(book, replay!.epds),
        comparisons: comparisons.filter((c) => c.ready || !this.inserted(c.userId, facts)),
        chessPositionId: game.legend?.chessPositionId ?? null,
        result: { plies: n, resumedFrom: resume.graded, pass2: searched, regrade: false },
        extensions: extensionStatements(this.extensions, {
          gameId: game.id,
          gameRef: game.ref,
          startPly: game.startPly,
          moves: replay!.uci,
          members: game.members,
          result,
          memberSides: game.members.map((m) => m.color),
          regrade: false,
        }),
      }),
    );
    ctx.heartbeat.noteWrite();
    ctx.evalCache?.flush();
    await this.stream.drain();
    await this.announce(
      game,
      result,
      comparisons.some((c) => c.ready),
    );
    this.ready(game, result, { regrade: false, pass2: searched, pass1Ms, pass2Ms });
    return "done";
  }

  // ── pass 1 helpers ─────────────────────────────────────────────────────────────────────────────────────────
  /** Members whose facts row this run inserted at a checkpoint. */
  private readonly insertedFacts = new Set<string>();

  private inserted(userId: string, facts: readonly MemberFacts[]): boolean {
    return this.insertedFacts.has(userId) || facts.some((f) => f.userId === userId && f.stored);
  }

  /** Pass-1 grades of plies 0 … graded − 1 (what checkpoints store and frames carry); classifyGame streams. */
  private streamGrades(replay: Replay, arrays: AnalysisArrays, book: OpeningIndex, graded: number): number[] {
    const grades = classifyGame({
      replay,
      evals: arrays.evals.slice(0, graded + 1),
      second: arrays.second,
      best: arrays.best,
      isBook: (epd) => book.book.has(epd),
    });
    return gradeCodes(grades);
  }

  private async checkpoint(input: {
    game: LoadedGame;
    identity: AnalysisIdentity;
    arrays: AnalysisArrays;
    graded: number;
    newFacts: readonly MemberFacts[];
  }): Promise<void> {
    const { ctx } = this;
    const evalsLen = input.graded + 1;
    const priority = await this.deps.store.checkpoint({
      jobId: ctx.job.id,
      me: ctx.me,
      gameId: input.game.id,
      identity: input.identity,
      gradedPlies: input.graded,
      arrays: {
        evals: input.arrays.evals.slice(0, evalsLen),
        second: input.arrays.second.slice(0, evalsLen),
        best: input.arrays.best.slice(0, evalsLen),
        judgements: input.arrays.judgements.slice(0, input.graded),
      },
      newComparisons: input.newFacts.map((f) => ({ userId: f.userId, facts: f.facts, ready: false })),
      chessPositionId: input.game.legend?.chessPositionId ?? null,
    });
    for (const f of input.newFacts) this.insertedFacts.add(f.userId);
    this.lastCheckpoint = input.graded;
    ctx.heartbeat.noteWrite(priority);
    ctx.evalCache?.flush();
    this.stream?.noteCheckpoint(input.graded);
  }

  /** SIGTERM / lost: checkpoint what is new since the last checkpoint (stop only), then leave. */
  private async safePoint(input: {
    game: LoadedGame;
    identity: AnalysisIdentity;
    arrays: AnalysisArrays;
    replay: Replay;
    book: OpeningIndex;
    graded: number;
    newFacts: readonly MemberFacts[];
  }): Promise<void> {
    const { signal } = this.ctx;
    if (!signal.aborted) return;
    if (signal.reason !== "lost" && input.graded > this.lastCheckpoint) {
      input.arrays.judgements = this.streamGrades(input.replay, input.arrays, input.book, input.graded);
      await this.checkpoint({ ...input });
    }
    throw new JobAborted(String(signal.reason ?? "stopping"));
  }

  private async faultAt(graded: number): Promise<void> {
    const f = this.fault;
    if (f?.kind === "fail_at_ply" && graded >= f.ply) {
      throw new JobError("engine_failed", `test fault fail_at_ply:${f.ply}`);
    }
    if (f?.kind === "stall_at_ply" && graded === f.ply) {
      this.ctx.log.warn("test fault: stall", { ply: graded });
      this.ctx.heartbeat.suspend();
      await this.ctx.clock.sleep(STALL_HOLD_MS, this.ctx.signal);
      if (this.ctx.signal.aborted) throw new JobAborted(String(this.ctx.signal.reason ?? "stopping"));
      throw new JobError("worker_stalled", `test fault stall_at_ply:${f.ply}`);
    }
  }

  // ── pass 2 ─────────────────────────────────────────────────────────────────────────────────────────────────
  private async pass2(input: {
    game: LoadedGame;
    replay: Replay;
    positions: PositionPlan[];
    arrays: AnalysisArrays;
    pass1Arrays: AnalysisArrays;
    book: OpeningIndex;
    identity: AnalysisIdentity;
    divergence: { ply: number; gameUci: string; legendUci: string } | null;
    newFacts: readonly MemberFacts[];
  }): Promise<{
    lines: Record<number, LineFacts>;
    searched: number;
    legendEvals: { game: number; legend: number } | null;
  }> {
    const { ctx } = this;
    const searcher = this.searcher!;
    const { replay, positions, arrays } = input;
    const n = replay.uci.length;
    const profile = ENGINE_PROFILE.pass2;
    const started = ctx.clock.now();
    const lines: Record<number, LineFacts> = {};
    const deep = new Map<number, PositionEval>();
    const legendPos = input.divergence
      ? legendPosition(positions[input.divergence.ply] as PositionPlan, input.divergence.legendUci, replay.epds)
      : null;
    const reserve = input.divergence && legendPos ? 2 : 0;
    const budget = profile.maxPositions - reserve;
    let searched = 0;
    const timeLeft = () => ctx.clock.now() - started < profile.maxSeconds * 1000;
    const search = async (pos: PositionPlan): Promise<PositionEval> => {
      await this.safePoint({ ...input, arrays: input.pass1Arrays, graded: n });
      const e = await searcher.evaluate(pos, profile, { pass1: false });
      if (pos.terminal === null) searched++;
      return e;
    };

    const grades = classifyGame({
      replay,
      evals: arrays.evals,
      second: arrays.second,
      best: arrays.best,
      isBook: (epd) => input.book.book.has(epd),
    });
    const hasBest = (ply: number) => decodeMove(arrays.best[ply] ?? 0) !== null;
    const candidates = pass2Candidates({
      grades,
      members: input.game.members.map((m) => m.color),
      startMover: replay.startMover,
      fens: replay.fens,
      uci: replay.uci,
      hasBest,
      reserve,
    });
    for (const ply of candidates) {
      if (!timeLeft()) break;
      const need = [ply, ply + 1].filter(
        (j) => j <= n && !deep.has(j) && (positions[j] as PositionPlan).terminal === null,
      );
      if (searched + need.length > budget) continue;
      for (const j of need) {
        if (!timeLeft()) break;
        deep.set(j, await search(positions[j] as PositionPlan));
      }
    }
    for (const [j, e] of deep) {
      arrays.evals[j] = e.eval;
      arrays.second[j] = e.second;
      arrays.best[j] = e.best;
      if (j < n && e.lines.length > 0 && e.lines[0]!.pv.length > 0) {
        const mover: Color = (positions[j] as PositionPlan).mover;
        lines[j] = {
          pv: e.lines[0]!.pv,
          accept: acceptMoves(
            e.lines.filter((l) => l.pv[0]).map((l) => ({ uci: l.pv[0] as string, eval: l.eval })),
            mover,
          ),
        };
      }
    }

    let legendEvals: { game: number; legend: number } | null = null;
    if (input.divergence && legendPos && timeLeft()) {
      const gamePos = positions[input.divergence.ply + 1] as PositionPlan;
      const g = deep.get(gamePos.index) ?? (await search(gamePos));
      const l = await search(legendPos);
      legendEvals = { game: g.eval, legend: l.eval };
    }
    ctx.evalCache?.flush();
    return { lines, searched, legendEvals };
  }

  // ── texts and writes ───────────────────────────────────────────────────────────────────────────────────────
  private legendFor(m: GameMember, facts: readonly MemberFacts[], game: LoadedGame): AnalysisMember["legend"] {
    const f = facts.find((x) => x.userId === m.userId);
    return f ? { facts: f.facts, year: game.legend?.year ?? null } : null;
  }

  private memberWrites(game: LoadedGame, result: AnalysisResult): MemberWrite[] {
    return game.members.map((m) => {
      const review = result.reviews[m.color];
      if (!review) throw new JobError("internal", `no review was built for side ${m.color}`);
      const content = buildReviewContent(review);
      return {
        color: m.color,
        accuracy: result.accuracy[m.color],
        headline: content.headline,
        momentsCount: content.moments.length,
        counts: result.counts[m.color],
        phaseAccuracy: [...result.phaseAccuracy[m.color]],
        content,
      };
    });
  }

  private async skip(game: LoadedGame, reason: string): Promise<"done"> {
    const { ctx } = this;
    ctx.log.info("analysis skipped", { gameRef: this.gameRef, reason });
    await this.span("write", () => this.deps.store.skip({ jobId: ctx.job.id, me: ctx.me, gameId: game.id, reason }));
    const refs = game.members.map((m) => m.userRef);
    if (this.streams()) {
      for (const m of game.members) {
        const data = buildEvent("analysis:done", {
          gameRef: this.gameRef,
          analysisVersion: GRADING_VERSION,
          accuracy: null,
          momentsCount: 0,
          headline: null,
          coachLine: null,
          isClean: false,
          bank: null,
        });
        await ctx.emitter.emit("analysis:done", data, [m.userRef], {
          dedupeKey: analysisDoneDedupeKey(game.id, GRADING_VERSION, m.color),
        });
      }
      await ctx.emitter.emit("games:changed", buildEvent("games:changed", { gameRef: this.gameRef }), refs);
    } else {
      this.deps.batch.add(refs, this.gameRef, "done");
      await this.deps.batch.flushDue();
    }
    return "done";
  }

  private async regrade(game: LoadedGame, replay: Replay): Promise<"done"> {
    const { ctx } = this;
    const stored = game.analysis!;
    const book = await this.deps.book.get();
    const facts = memberFacts({
      legend: game.legend,
      comparisons: game.comparisons,
      members: game.members,
      startFen: game.startingFen,
      startPly: game.startPly,
      moves: replay.uci,
    });
    const result = await this.span("classify", async () =>
      regradeAnalysis({
        stored: {
          version: stored.version,
          engine: stored.engine,
          evals: stored.evals,
          second: stored.second,
          best: stored.best,
          judgements: stored.judgements,
          lines: stored.lines,
        },
        game: { startFen: game.startingFen, startPly: game.startPly, moves: replay.uci },
        members: game.members.map((m) => ({
          side: m.color,
          result: memberResult(m),
          legend: this.legendFor(m, facts, game),
        })),
        isBook: (epd) => book.book.has(epd),
      }),
    );
    const members = await this.span("text", async () => this.memberWrites(game, result));
    await this.pauseAt("write");
    await this.span("write", () =>
      this.deps.store.finish({
        jobId: ctx.job.id,
        me: ctx.me,
        gameId: game.id,
        identity: {
          version: result.version,
          engine: stored.engine,
          nodesPass1: stored.nodesPass1,
          nodesPass2: stored.nodesPass2,
          totalPlies: result.totalPlies,
        },
        arrays: { evals: stored.evals, second: stored.second, best: stored.best, judgements: result.judgements },
        lines: LinesV1.parse(result.lines),
        middlegamePly: result.division.middlegamePly,
        endgamePly: result.division.endgamePly,
        accuracy: result.accuracy,
        counts: result.counts,
        depthP50: stored.depthP50,
        measureReady: false,
        members,
        opening: game.ecoCode ? null : openingOf(book, replay.epds),
        comparisons: facts.filter((f) => !f.stored).map((f) => ({ userId: f.userId, facts: f.facts, ready: false })),
        chessPositionId: game.legend?.chessPositionId ?? null,
        result: {
          plies: result.totalPlies,
          regrade: true,
          changedPlies: result.changedPlies.length,
          fromVersion: stored.version,
        },
        extensions: extensionStatements(this.extensions, {
          gameId: game.id,
          gameRef: game.ref,
          startPly: game.startPly,
          moves: replay.uci,
          members: game.members,
          result,
          memberSides: game.members.map((m) => m.color),
          regrade: true,
        }),
      }),
    );
    ctx.heartbeat.noteWrite();
    await this.announce(game, result, false);
    this.ready(game, result, { regrade: true, pass2: 0, pass1Ms: 0, pass2Ms: 0 });
    return "done";
  }

  /** The done events: per game for band ≥ 80 or a watched game, else the member's `analysis:batch`. */
  private async announce(game: LoadedGame, result: AnalysisResult, compareReady: boolean): Promise<void> {
    const { ctx } = this;
    const refs = game.members.map((m) => m.userRef);
    if (!this.streams()) {
      this.deps.batch.add(refs, this.gameRef, "done");
      await this.deps.batch.flushDue();
      return;
    }
    for (const m of game.members) {
      const review = result.reviews[m.color];
      const accuracy = result.accuracy[m.color];
      const data = buildEvent("analysis:done", {
        gameRef: this.gameRef,
        analysisVersion: GRADING_VERSION,
        accuracy: accuracy === null ? null : Math.max(0, Math.min(100, Math.round(accuracy))),
        momentsCount: review?.moments.length ?? 0,
        headline: review?.headline ?? null,
        coachLine: review?.coachLine?.t ?? null,
        isClean: review?.isClean ?? false,
        bank: null,
      });
      await ctx.emitter.emit("analysis:done", data, [m.userRef], {
        dedupeKey: analysisDoneDedupeKey(game.id, GRADING_VERSION, m.color),
      });
    }
    await ctx.emitter.emit("games:changed", buildEvent("games:changed", { gameRef: this.gameRef }), refs);
    if (compareReady)
      await ctx.emitter.emit(
        "compare:ready",
        buildEvent("compare:ready", { gameRef: this.gameRef, status: "ready" }),
        refs,
      );
  }

  // ── telemetry ──────────────────────────────────────────────────────────────────────────────────────────────
  private started(game: LoadedGame, resumedFrom: number): void {
    const { ctx } = this;
    const job = ctx.job;
    const waitMs = clampMs(job.claimedAtMs - Math.max(job.runAtMs, job.createdAtMs));
    const band = bandOf(job.priority);
    ctx.telemetry.metric("distribution", "worker.queue.wait_ms", waitMs, { kind: "ANALYZE_GAME", band });
    const who = game.members[0]?.userRef;
    if (who) {
      this.deps.events.capture("analysis_started", who, {
        wait_ms: waitMs,
        attempt: Math.max(1, Math.min(10, job.attempts)),
        resumed_from_ply: Math.min(resumedFrom, 1_200),
        priority: Math.max(0, Math.min(100, job.priority)),
        band,
      });
    }
  }

  private ready(
    game: LoadedGame,
    result: AnalysisResult,
    run: { regrade: boolean; pass2: number; pass1Ms: number; pass2Ms: number },
  ): void {
    const { ctx } = this;
    const now = ctx.clock.now();
    const band = bandOf(ctx.job.priority);
    const durationMs = clampMs(now - this.startedMs);
    const measured = !run.regrade && MEASURED_REASONS.has(ctx.payload.reason) && game.completedAtMs !== null;
    const fromGameEnd = measured ? clampMs(now - (game.completedAtMs as number)) : null;
    const stats = this.searcher?.stats;
    ctx.telemetry.metric("distribution", "worker.job.duration_ms", durationMs, { kind: "ANALYZE_GAME", pass: "total" });
    if (!run.regrade) {
      ctx.telemetry.metric("distribution", "worker.job.duration_ms", clampMs(run.pass1Ms), {
        kind: "ANALYZE_GAME",
        pass: "pass1",
      });
      ctx.telemetry.metric("distribution", "worker.job.duration_ms", clampMs(run.pass2Ms), {
        kind: "ANALYZE_GAME",
        pass: "pass2",
      });
    }
    if (fromGameEnd !== null) ctx.telemetry.metric("distribution", "worker.review_ready_ms", fromGameEnd, { band });
    const firstFrame = this.stream?.firstFrameAtMs;
    if (firstFrame !== null && firstFrame !== undefined) {
      ctx.telemetry.metric("distribution", "worker.first_progress_ms", clampMs(firstFrame - this.startedMs), { band });
    }
    if (stats) {
      if (stats.hitsMemory) ctx.telemetry.metric("count", "worker.cache.hit", stats.hitsMemory, { tier: "memory" });
      if (stats.hitsDisk) ctx.telemetry.metric("count", "worker.cache.hit", stats.hitsDisk, { tier: "disk" });
      if (stats.engineMs > 0)
        ctx.telemetry.metric("gauge", "worker.engine.nps", Math.round((stats.nodes / stats.engineMs) * 1000));
      ctx.telemetry.metric("distribution", "worker.lag_pause_ms", clampMs(stats.lagPauseMs));
    }
    const side = (c: Color) => (game.members.some((m) => m.color === c) ? result.reviews[c] : undefined);
    const who = game.members[0]?.userRef;
    if (who) {
      this.deps.events.capture("analysis_ready", who, {
        ms_from_game_end: fromGameEnd,
        plies: Math.min(result.totalPlies, 1_200),
        nodes_total: stats?.nodes ?? 0,
        cache_hit_ratio: this.searcher ? Math.round(this.searcher.cacheHitRatio() * 1000) / 1000 : 0,
        duration_ms: durationMs,
        pass2_positions: Math.min(run.pass2, 100),
        moments_w: side("w")?.moments.length ?? 0,
        moments_b: side("b")?.moments.length ?? 0,
        clean_w: side("w")?.isClean ?? false,
        clean_b: side("b")?.isClean ?? false,
        regrade: run.regrade,
      });
      const before = previousFailure(game.jobLastError);
      if (before && ctx.job.attempts > 1) {
        this.deps.events.capture("analysis_retry_succeeded", who, {
          code: before,
          attempt: Math.min(10, ctx.job.attempts),
        });
      }
    }
    ctx.log.info("analysis done", { gameRef: this.gameRef, ms: durationMs, regrade: run.regrade, pass2: run.pass2 });
  }
}
