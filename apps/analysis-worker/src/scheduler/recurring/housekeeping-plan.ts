// Plans the next HOUSEKEEPING rows (phase-03 plan §7.7, P3-D22): one per UTC day at 21:00, dedupe key
// `housekeeping:<yyyy-mm-dd>`. Inside a 26-hour window this is always at least one row, so the worker's longest
// sleep (24 h) always ends on a planned wake, and a missed day self-heals at the next boot or drain.
import { housekeepingDedupeKey, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import type { JobRowInput, PlanWindow, RecurringSlice } from "./types";

/** HOUSEKEEPING runs at this UTC hour (§7.7). */
export const HOUSEKEEPING_HOUR_UTC = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Every 21:00 UTC inside [from, to]. */
export function housekeepingTimes(window: PlanWindow): Date[] {
  const out: Date[] = [];
  const first = new Date(
    Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), window.from.getUTCDate(), HOUSEKEEPING_HOUR_UTC),
  );
  for (let t = first.getTime(); t <= window.to.getTime(); t += DAY_MS) {
    if (t >= window.from.getTime()) out.push(new Date(t));
  }
  return out;
}

export function housekeepingRow(at: Date): JobRowInput {
  const day = isoDay(at);
  return {
    kind: "HOUSEKEEPING",
    priority: JOB_PRIORITY.HOUSEKEEPING,
    payload: { v: 1, day },
    dedupeKey: housekeepingDedupeKey(day),
    runAt: at,
    maxAttempts: JOB_MAX_ATTEMPTS.HOUSEKEEPING,
  };
}

export const housekeepingPlan: RecurringSlice = {
  id: "housekeeping-plan",
  plan: (window) => housekeepingTimes(window).map(housekeepingRow),
};
