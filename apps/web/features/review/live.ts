// The review's fallback and recovery rules (phase-03 plan §5.2; AP-20), pure so they are unit-tested:
//
// - Fallback poll of A2 while the socket is down: [2, 4, 8, 15] s (the last step repeats), stopping 180 s after the
//   first poll. The start time and the step live per *query* (a WeakMap keyed by the Query object), not in a closure,
//   so re-renders and new option objects never restart the schedule.
// - Stall detection: no `analysis:*` event for 45 s while the socket is live → one A2 fetch.
// - Reconciling A2 with the cached payload: a different status or more graded plies either patches the payload
//   (failed, queued) or asks for one A1 refetch (done, more plies than the cache holds).

import type { ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";

// The timing constants come from the zod-free contract module (the review chunk must not contain zod, AP-12).
import {
  REVIEW_FALLBACK_SCHEDULE_MS,
  REVIEW_FALLBACK_STOP_AFTER_MS,
  REVIEW_STALL_SILENCE_MS,
} from "@repo/contracts/http/plain";

export { REVIEW_FALLBACK_SCHEDULE_MS, REVIEW_FALLBACK_STOP_AFTER_MS, REVIEW_STALL_SILENCE_MS };
/** How long the socket may take to connect before the poller starts (plan §5.2). */
export const SOCKET_GRACE_MS = 3_000;

/** The statuses that still change on the server (the poller and the stall timer run only for these). */
export function isLiveStatus(status: ReviewDTO["status"]): boolean {
  return status === "queued" || status === "running";
}

type PollQuery = { state: { dataUpdatedAt: number; errorUpdatedAt: number } };
type PollState = { startedAt: number; polls: number; stamp: number };

const pollStates = new WeakMap<object, PollState>();

/**
 * The refetch interval of the status query while the fallback is active: the next step of the schedule, or false
 * once 180 s have passed since the first poll. Inactive resets the query's schedule (a later outage starts at 2 s).
 */
export function fallbackInterval(query: PollQuery, active: boolean, now: number): number | false {
  if (!active) {
    pollStates.delete(query);
    return false;
  }
  const stamp = Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt);
  let s = pollStates.get(query);
  if (!s) {
    s = { startedAt: now, polls: 0, stamp };
    pollStates.set(query, s);
  } else if (stamp !== s.stamp) {
    // A poll finished since the last call: move to the next step.
    s.stamp = stamp;
    s.polls += 1;
  }
  if (now - s.startedAt >= REVIEW_FALLBACK_STOP_AFTER_MS) return false;
  const schedule = REVIEW_FALLBACK_SCHEDULE_MS;
  return schedule[Math.min(s.polls, schedule.length - 1)]!;
}

/** True once the fallback for this query has given up (180 s): the screen offers "Try Again" instead. */
export function fallbackExpired(query: object, now: number): boolean {
  const s = pollStates.get(query);
  return !!s && now - s.startedAt >= REVIEW_FALLBACK_STOP_AFTER_MS;
}

/** What to do with the cached payload after an A2 answer. */
export function reconcileWithStatus(d: ReviewDTO, s: ReviewStatusDTO): { next: ReviewDTO; refetch: boolean } {
  const a = s.analysis;
  const graded = d.analysis?.gradedPlies ?? 0;
  if (d.status === "done" || d.status === "skipped") return { next: d, refetch: false };
  switch (a.status) {
    case "done":
    case "skipped":
    case "none":
      return { next: d, refetch: a.status !== d.status };
    case "failed": {
      if (!d.analysis) return { next: d, refetch: true };
      const failure = {
        failedAtPly: a.failedAtPly ?? graded,
        retryable: a.retryable,
        retryAt: a.retryAt,
        code: a.code ?? "internal",
      };
      const same =
        d.status === "failed" &&
        d.analysis.failure?.failedAtPly === failure.failedAtPly &&
        d.analysis.failure.retryable === failure.retryable &&
        d.analysis.failure.retryAt === failure.retryAt &&
        d.analysis.failure.code === failure.code;
      return {
        next: same ? d : { ...d, status: "failed", analysis: { ...d.analysis, failure, queue: null } },
        refetch: a.gradedPlies > graded,
      };
    }
    case "queued":
      if (d.status === "queued" || !d.analysis) return { next: d, refetch: !d.analysis };
      return {
        next: {
          ...d,
          status: "queued",
          analysis: { ...d.analysis, failure: null, queue: { position: d.analysis.queue?.position ?? 0, etaSec: a.etaSec ?? 0 } },
        },
        refetch: a.gradedPlies > graded,
      };
    case "running":
      return { next: d, refetch: a.gradedPlies > graded || d.status !== "running" };
  }
}
