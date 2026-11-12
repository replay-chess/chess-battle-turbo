// HOUSEKEEPING slice 1 (phase-03 plan §7.7, §6.5): finished jobs leave the queue table — DONE after 14 days,
// FAILED / CANCELLED after 30 days (by `finishedAt`, the partial index jobs_finished_idx). A daily run deletes about
// one day's worth; the statement is capped so it stays far below the role's 60 s statement timeout, and anything
// left over goes the next day.
import { num, stmt, type Statement } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { RecurringSlice } from "./types";

export const DONE_RETENTION_DAYS = 14;
export const FAILED_RETENTION_DAYS = 30;
export const PRUNE_JOBS_MAX = 50_000;

export function pruneJobsStatement(max = PRUNE_JOBS_MAX): Statement {
  return stmt(
    `WITH d AS (
  DELETE FROM jobs WHERE id IN (
    SELECT id FROM jobs
     WHERE (status = 'DONE' AND "finishedAt" < ${NOW} - ($1::int * interval '1 day'))
        OR (status IN ('FAILED', 'CANCELLED') AND "finishedAt" < ${NOW} - ($2::int * interval '1 day'))
     LIMIT $3)
  RETURNING 1
)
SELECT count(*)::int AS deleted FROM d`,
    [DONE_RETENTION_DAYS, FAILED_RETENTION_DAYS, max],
  );
}

export const pruneJobs: RecurringSlice = {
  id: "prune-jobs",
  statements: () => [pruneJobsStatement()],
  async after(ctx, [rows]) {
    ctx.log.info("pruned jobs", { deleted: num(rows?.[0]?.deleted ?? 0) });
  },
};
