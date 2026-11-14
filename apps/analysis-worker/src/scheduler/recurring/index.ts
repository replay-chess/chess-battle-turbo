// The recurring slices, in the order HOUSEKEEPING runs them (phase-03 plan §7.7). DAILY_PLAN (../daily-plan.ts) runs
// last and asks every slice with a `plan()` for its timed rows. Later phases add one file and one line here.
import { evalcacheTrim } from "./evalcache-trim";
import { housekeepingPlan } from "./housekeeping-plan";
import { importBackstop } from "./import-backstop";
import { pruneJobs } from "./prune-jobs";
import { pruneRateLimits } from "./prune-rate-limits";
import { pruneShares } from "./prune-shares";
import { regradeSweep } from "./regrade-sweep";
import { trainingHygiene } from "./training-hygiene";
import type { RecurringSlice } from "./types";

export const RECURRING_SLICES: readonly RecurringSlice[] = [
  pruneJobs,
  pruneShares,
  pruneRateLimits,
  evalcacheTrim,
  regradeSweep(),
  importBackstop,
  trainingHygiene,
  housekeepingPlan,
];

export type { HousekeepingCtx, JobRowInput, PlanWindow, RecurringSlice } from "./types";
