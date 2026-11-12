// The reaper (phase-03 plan §8.12; owner test T11). It runs at worker boot and at the end of each drain, never on a
// timer (the idle worker issues zero queries). Its statement is reapStatement() (outcome.ts); it is sent inside the
// boot batch and the drain-end batch, so it costs no round trip of its own.
//
// For every reaped ANALYZE_GAME the game is marked FAILED (same statement) and both members get
// `analysis:failed {code:"worker_stalled", retryable, retryAt}`. 30 s later the retry resumes from the last
// checkpoint. A worker that dies and is not restarted is covered by A2's 90 s stall rule and the daily cron backstop.
//
// A reaped LEGEND_COMPARE that used its last attempt fails the member's comparison row (same statement) and the
// member gets `compare:ready {status: "failed"}`, as when the runner fails it (jobs/legend-compare.ts `onFailed`), so
// a compare page waiting on the socket always hears the result (FIX-2).
import type { Row } from "../db/client";
import { buildEvent } from "../socket/events";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";
import type { ProductEvents } from "../obs/posthog";
import type { EmitSink } from "../socket/emit";
import { failedEventOf, toFailedJob, type FailedJob } from "./outcome";

/** Interprets the reaper's rows: logs, counts and emits `analysis:failed` to the members of each reaped analysis. */
export async function handleReaped(
  rows: readonly Row[],
  deps: { emitter: EmitSink; log: Logger; metrics: Metrics; events?: ProductEvents },
): Promise<FailedJob[]> {
  const reaped = rows.map(toFailedJob);
  for (const job of reaped) {
    deps.metrics.jobFailed("worker_stalled");
    deps.log.warn("reaped a stalled job", {
      jobId: job.id,
      kind: job.kind,
      status: job.status,
      gameRef: job.game?.ref,
    });
    const event = failedEventOf(job, "worker_stalled");
    if (event && job.game) {
      await deps.emitter.emit("analysis:failed", event, job.game.members);
      const who = job.game.members[0];
      if (who) {
        deps.events?.capture("analysis_failed", who, {
          code: "worker_stalled",
          attempt: Math.max(1, Math.min(10, job.attempts)),
          failed_at_ply: Math.min(event.failedAtPly, 1_200),
          retryable: event.retryable,
        });
      }
    }
    if (job.compare) {
      await deps.emitter.emit(
        "compare:ready",
        buildEvent("compare:ready", { gameRef: job.compare.gameRef, status: "failed" }),
        [job.compare.member],
      );
    }
  }
  return reaped;
}
