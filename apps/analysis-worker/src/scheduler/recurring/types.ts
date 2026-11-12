// The `recurring/` extension contract (phase-03 plan §7.7, P3-D22). Timed work runs from one daily HOUSEKEEPING job
// (21:00 UTC) instead of an hourly tick. Each slice is one file in this directory, listed in order in `index.ts`:
//
//   run(ctx)          work done inside today's HOUSEKEEPING job (≤ 60 s each; a slice error does not stop the others)
//   statements(ctx)   set-based statements that ride in HOUSEKEEPING's ONE batch (lock guard … plan … DONE), so the
//                     daily wake stays a handful of round trips (the timer audit, §12.1)
//   after(ctx, rows)  reads what its statements returned (logging, follow-up work such as the regrade enqueues)
//   plan(window)      timed job rows for the next 26 h (DAILY_PLAN inserts them with ON CONFLICT ("dedupeKey") DO NOTHING)
//
// P3 ships the planner of the next HOUSEKEEPING row (housekeeping-plan.ts) and the prune/trim/regrade slices (C6);
// P6 adds the weekly weakness roll, P10 reminders and DST, P13 backups: each a new file plus one line in index.ts.
import type { EnqueueJobInput } from "@repo/db/jobs";
import type { EvalCache } from "../../cache/evalcache";
import type { Db, Row, Statement } from "../../db/client";
import type { Logger } from "../../obs/log";
import type { Metrics } from "../../obs/metrics";
import type { Clock } from "../clock";

/** A timed row: any enqueue input with a dedupe key (so planning twice inserts once). */
export type JobRowInput = Omit<EnqueueJobInput, "onConflict" | "reviveDone" | "when"> & { dedupeKey: string };

export interface PlanWindow {
  from: Date;
  to: Date;
}

export interface HousekeepingCtx {
  db: Db;
  clock: Clock;
  log: Logger;
  metrics: Metrics;
  /** Aborts on SIGTERM: a slice stops at its next safe point. */
  signal: AbortSignal;
  /** When this HOUSEKEEPING run started. */
  now: Date;
  /** The worker's eval cache (null when EVAL_CACHE=off): the weekly `evalcache-trim` slice uses it. */
  evalCache: EvalCache | null;
  /** EVAL_CACHE_MAX_GB in bytes. */
  evalCacheMaxBytes: number;
}

export interface RecurringSlice {
  /** "prune-jobs", later "weakness-roll" (P6), "notify-reminders" (P10), "backup" (P13). */
  id: string;
  run?(ctx: HousekeepingCtx): Promise<void>;
  statements?(ctx: HousekeepingCtx): Statement[];
  after?(ctx: HousekeepingCtx, rows: Row[][]): Promise<void>;
  plan?(window: PlanWindow): JobRowInput[];
}
