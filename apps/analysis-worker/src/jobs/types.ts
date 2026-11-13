// The job handler contract (phase-03 plan §7.7, §8.12). The runner (runner.ts) claims nothing itself: the scheduler
// claims, the runner reads the payload, heart-beats, calls the kind's handler and writes the outcome on failure.
//
// A handler marks its job DONE inside its own final batch (`lockGuardStatement` first, `doneStatement` last, so the
// results and the DONE flag commit together, and never after the job was reaped). It throws JobError for a failure
// with a contract code; anything else fails the job as `internal`. It checks `ctx.signal` between steps: on SIGTERM
// it stops at the next safe point (a checkpoint) and throws JobAborted (or returns "released" after releasing).
import type { AnalysisFailureCode } from "@repo/contracts/http/review";
import type { JobPayload, RunJobKind } from "@repo/contracts/internal/jobs";
import type { EvalCache } from "../cache/evalcache";
import type { AppEnvName } from "../config/env";
import type { Fault } from "../config/faults";
import type { Db } from "../db/client";
import type { EnginePool } from "../engine/pool";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";
import type { Telemetry } from "../obs/telemetry";
import type { ClaimedJob } from "../queue/claim";
import type { Heartbeat } from "../queue/heartbeat";
import type { FailedJob } from "../queue/outcome";
import type { Clock } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import type { LagPause } from "../socket/load";

/**
 * `failed`: the handler wrote its own failure in its final batch (P4 imports: the run, the account and the job's
 * back-off commit together), so the runner writes nothing more.
 */
export type JobOutcome = "done" | "released" | "failed";

export interface JobContext<K extends RunJobKind = RunJobKind> {
  job: ClaimedJob;
  payload: JobPayload<K>;
  /** `lockedBy` of this worker boot. */
  me: string;
  appEnv: AppEnvName;
  db: Db;
  clock: Clock;
  log: Logger;
  metrics: Metrics;
  telemetry: Telemetry;
  emitter: EmitSink;
  engine: EnginePool | null;
  evalCache: EvalCache | null;
  evalCacheMaxBytes: number;
  lag: LagPause | null;
  heartbeat: Heartbeat;
  /** Aborts on SIGTERM (`reason` "stop") or when the job was lost to the reaper (`reason` "lost"). */
  signal: AbortSignal;
  /** Was this game named in a kick's `watch` within the last 10 minutes (P3-D26)? */
  isWatched(gameRef: string): boolean;
  /** The one-shot fault a test kick attached to this game (APP_ENV=test), else the env fault (dev/test). */
  takeFault(gameRef: string): Fault | null;
  /**
   * Work was queued for the engine lane from another lane (an import's ANALYZE_GAME jobs): wake it in-process. The
   * engine lane does not poll; without this the jobs waited for an unrelated kick (D1). Absent in harnesses without one.
   */
  wakeEngine?(): void;
}

/** What the runner's fail write did, for the kind's own follow-up (telemetry, a failed comparison, a batch count). */
export interface FailureHookInput<K extends RunJobKind = RunJobKind> {
  ctx: JobContext<K>;
  /** The job row after the fail write (null when the job was no longer ours). */
  failed: FailedJob | null;
  code: AnalysisFailureCode;
}

export interface JobHandler<K extends RunJobKind = RunJobKind> {
  kind: K;
  run(ctx: JobContext<K>): Promise<JobOutcome>;
  /** Called after the runner wrote a failure (back-off or terminal). Errors are logged, never rethrown. */
  onFailed?(input: FailureHookInput<K>): Promise<void> | void;
}

/** A failure with a contract code (`analysis:failed.code`, `jobs."lastError"`). */
export class JobError extends Error {
  readonly terminal: boolean;
  constructor(
    readonly code: AnalysisFailureCode,
    message: string,
    options: { terminal?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "JobError";
    this.terminal = options.terminal === true;
  }
}

/** SIGTERM reached the handler at a safe point: the runner releases the job without counting the attempt. */
export class JobAborted extends Error {
  constructor(message = "stopping") {
    super(message);
    this.name = "JobAborted";
  }
}

/** Throws JobAborted when the context was aborted (handlers call it between steps). */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new JobAborted(String(signal.reason ?? "stopping"));
}
