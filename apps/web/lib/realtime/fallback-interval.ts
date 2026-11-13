// HTTP polling as the socket's fallback (phase-04 plan §5.7; api-perf AP-20). Client-safe and pure.
//
// `fallbackInterval(query, schedule, active, now)` is a TanStack `refetchInterval` body: while `active` it walks the
// schedule (one step per finished poll, the last step repeats) and gives up `stopAfterMs` after the first poll was
// scheduled; inactive resets that query's schedule (a later outage starts again at the first step). The state lives
// in a module-scoped WeakMap keyed by the Query object (one per query hash), not in hook options, so a re-created
// hook (a new render) keeps the start time and `stopAfterMs` really stops it. P3's review poller
// (features/review/live.ts) is the same rule with one fixed schedule; this module takes the schedule as data.

export type FallbackSchedule = {
  /** Wait before the first poll after the poller becomes active (the "socket down for 5 s" grace). */
  delayMs: number;
  /** One entry per poll; the last one repeats. */
  stepsMs: readonly number[];
  /** Stop polling this long after the poller became active (the UI keeps its last state). */
  stopAfterMs: number;
};

/** §5.7: import status (activating, done, archive banner): 3 s × 10, then 10 s, for 10 min. */
export const IMPORT_STATUS_FALLBACK: FallbackSchedule = {
  delayMs: 5_000,
  stepsMs: [...Array<number>(10).fill(3_000), 10_000],
  stopAfterMs: 10 * 60_000,
};

/** §5.7: linked accounts (Connected) while any account syncs: 3 s, 3 s, 5 s, then 10 s, for 10 min. */
export const ACCOUNTS_FALLBACK: FallbackSchedule = {
  delayMs: 5_000,
  stepsMs: [3_000, 3_000, 5_000, 10_000],
  stopAfterMs: 10 * 60_000,
};

/** The fields of a TanStack Query this reads (structural, so tests pass plain objects). */
export type PollQuery = { state: { dataUpdatedAt: number; errorUpdatedAt: number } };

type PollState = { startedAt: number; polls: number; stamp: number };

const states = new WeakMap<object, PollState>();

export function fallbackInterval(query: PollQuery, schedule: FallbackSchedule, active: boolean, now: number): number | false {
  if (!active) {
    states.delete(query);
    return false;
  }
  const stamp = Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt);
  let s = states.get(query);
  if (!s) {
    s = { startedAt: now, polls: 0, stamp };
    states.set(query, s);
    return schedule.delayMs;
  }
  if (stamp !== s.stamp) {
    s.stamp = stamp;
    s.polls += 1;
  }
  if (now - s.startedAt >= schedule.stopAfterMs) return false;
  // `polls` counts finished polls after activation; the first one ran after delayMs.
  const step = Math.max(0, s.polls - 1);
  return schedule.stepsMs[Math.min(step, schedule.stepsMs.length - 1)]!;
}

/** True once this query's poller has given up (the screen may offer a manual refresh). */
export function fallbackExpired(query: object, schedule: FallbackSchedule, now: number): boolean {
  const s = states.get(query);
  return !!s && now - s.startedAt >= schedule.stopAfterMs;
}
