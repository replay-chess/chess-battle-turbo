// Runs one claimed job (phase-03 plan §8.12, §7.7): payload version check, heartbeat, the kind's handler, and the
// outcome when the handler does not finish:
//
//   payload newer than this build → released untouched (not an attempt), runAt + 10 min (FEA §9 rollback safety)
//   payload invalid / no handler  → FAILED at once (`internal`)
//   SIGTERM                       → released, the attempt not counted (§8.12 "Graceful SIGTERM")
//   lost to the reaper            → nothing written (the job is someone else's now)
//   any other error               → the fail write: QUEUED after 30 s / 2 min / 10 min, FAILED after the last attempt;
//                                   an ANALYZE_GAME also marks its game FAILED and emits `analysis:failed` to both
//                                   members (always: a failure is rare and someone may be waiting)
import { PAYLOAD_V_MAX, readJobPayload, type P3JobKind } from "@repo/contracts/internal/jobs";
import type { AnalysisFailureCode } from "@repo/contracts/http/review";
import type { EvalCache } from "../cache/evalcache";
import type { AppEnvName } from "../config/env";
import type { Fault } from "../config/faults";
import type { Db } from "../db/client";
import { EngineFailed } from "../engine/types";
import type { EnginePool } from "../engine/pool";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";
import type { Telemetry } from "../obs/telemetry";
import type { ClaimedJob } from "../queue/claim";
import { Heartbeat } from "../queue/heartbeat";
import {
  failedEventOf,
  failStatement,
  isLockLost,
  releaseStatement,
  toFailedJob,
  type FailedJob,
} from "../queue/outcome";
import type { Clock } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import type { LagPause } from "../socket/load";
import { JobAborted, JobError, type JobContext, type JobHandler } from "./types";

/** A job written by a newer build waits this long before this build looks at it again. */
export const NEWER_PAYLOAD_RELEASE_SEC = 600;

export type HandlerMap = { [K in P3JobKind]?: JobHandler<K> };

export interface RunnerDeps {
  db: Db;
  clock: Clock;
  log: Logger;
  metrics: Metrics;
  telemetry: Telemetry;
  emitter: EmitSink;
  me: string;
  appEnv: AppEnvName;
  handlers: HandlerMap;
  engine: EnginePool | null;
  evalCache: EvalCache | null;
  evalCacheMaxBytes: number;
  lag: LagPause | null;
  /** Aborted on SIGTERM. */
  stopSignal: AbortSignal;
  isWatched(gameRef: string): boolean;
  takeFault(gameRef: string): Fault | null;
  heartbeatEveryMs?: number;
}

export type RunResult = "done" | "released" | "failed" | "lost";

const CODES: readonly AnalysisFailureCode[] = ["engine_failed", "worker_stalled", "timeout", "internal"];

function failureCode(error: unknown): AnalysisFailureCode {
  if (error instanceof JobError) return error.code;
  if (error instanceof EngineFailed) return "engine_failed";
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && (CODES as readonly string[]).includes(code)
    ? (code as AnalysisFailureCode)
    : "internal";
}

/** A short, PII-free message for `lastError` (our own messages only; driver errors are reduced to their code). */
function failureMessage(error: unknown): string {
  if (error instanceof JobError || error instanceof EngineFailed) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? `unexpected error (${code})` : "unexpected error";
}

export async function runJob(job: ClaimedJob, deps: RunnerDeps): Promise<RunResult> {
  const log = deps.log.child({ jobId: job.id, kind: job.kind, attempt: job.attempts });
  const started = deps.clock.now();
  const kind = job.kind as P3JobKind;

  const read = readJobPayload(kind, job.payload);
  if (!read.ok && read.reason === "newer") {
    log.warn("payload written by a newer build: released", { payloadVMax: PAYLOAD_V_MAX });
    await deps.db.query(releaseStatement(job.id, deps.me, NEWER_PAYLOAD_RELEASE_SEC));
    return "released";
  }
  const handler = deps.handlers[kind] as JobHandler | undefined;
  if (!read.ok || !handler) {
    const why = !read.ok ? "invalid payload" : "no handler for this kind";
    log.error(`job failed: ${why}`);
    await fail(job, deps, log, new JobError("internal", why, { terminal: true }));
    return "failed";
  }

  const controller = new AbortController();
  const onStop = () => controller.abort("stop");
  if (deps.stopSignal.aborted) onStop();
  else deps.stopSignal.addEventListener("abort", onStop, { once: true });

  const heartbeat = new Heartbeat({
    db: deps.db,
    clock: deps.clock,
    log,
    jobId: job.id,
    me: deps.me,
    intervalMs: deps.heartbeatEveryMs,
    onPriority: (priority) => {
      job.priority = priority;
    },
    onLost: () => controller.abort("lost"),
  });
  const ctx: JobContext = {
    job,
    payload: read.payload,
    me: deps.me,
    appEnv: deps.appEnv,
    db: deps.db,
    clock: deps.clock,
    log,
    metrics: deps.metrics,
    telemetry: deps.telemetry,
    emitter: deps.emitter,
    engine: deps.engine,
    evalCache: deps.evalCache,
    evalCacheMaxBytes: deps.evalCacheMaxBytes,
    lag: deps.lag,
    heartbeat,
    signal: controller.signal,
    isWatched: deps.isWatched,
    takeFault: deps.takeFault,
  };

  heartbeat.start();
  try {
    const outcome = await handler.run(ctx);
    if (outcome === "done") deps.metrics.jobDone(job.kind, deps.clock.now() - started);
    log.info(`job ${outcome}`, { ms: deps.clock.now() - started });
    return outcome;
  } catch (error) {
    if (controller.signal.reason === "lost" || isLockLost(error)) {
      log.warn("job lost to the reaper: nothing written");
      return "lost";
    }
    if (deps.stopSignal.aborted || error instanceof JobAborted) {
      const rows = await deps.db.query(releaseStatement(job.id, deps.me)).catch((e: unknown) => {
        log.error("release failed (the reaper will requeue it)", { error: e });
        return [];
      });
      log.info("job released on stop", { released: rows.length > 0 });
      return "released";
    }
    const failed = await fail(job, deps, log, error);
    if (handler.onFailed) {
      try {
        await handler.onFailed({ ctx, failed: failed.job, code: failed.code });
      } catch (hookError) {
        log.error("failure hook failed", { error: hookError });
      }
    }
    return "failed";
  } finally {
    heartbeat.stop();
    deps.stopSignal.removeEventListener("abort", onStop);
  }
}

async function fail(
  job: ClaimedJob,
  deps: RunnerDeps,
  log: Logger,
  error: unknown,
): Promise<{ job: FailedJob | null; code: AnalysisFailureCode }> {
  const code = failureCode(error);
  const terminal = error instanceof JobError && error.terminal;
  deps.metrics.jobFailed(code);
  deps.telemetry.captureException(error, { kind: job.kind, jobId: job.id, attempt: job.attempts, code });
  log.error("job failed", { code, error });
  try {
    const rows = await deps.db.query(
      failStatement({
        jobId: job.id,
        me: deps.me,
        code,
        message: failureMessage(error),
        attempt: job.attempts,
        terminal,
      }),
    );
    const failed = rows[0] ? toFailedJob(rows[0]) : null;
    if (!failed) {
      log.warn("fail write found the job no longer ours");
      return { job: null, code };
    }
    const event = failedEventOf(failed, code);
    if (event && failed.game) await deps.emitter.emit("analysis:failed", event, failed.game.members);
    return { job: failed, code };
  } catch (writeError) {
    // The job stays RUNNING under this boot's lock; the reaper at the end of this drain requeues it (nothing else
    // runs then, so a row this boot holds is an orphan: outcome.ts reapStatement `drainEnd`).
    log.error("fail write failed", { error: writeError });
    return { job: null, code };
  }
}
