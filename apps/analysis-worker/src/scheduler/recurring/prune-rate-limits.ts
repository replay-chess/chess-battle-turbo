// HOUSEKEEPING slice 3 (phase-03 plan §3.2, §7.7): the limiter sweep moves here from P1's daily Vercel cron task
// `rate-limit-sweep` (WEB/lib/cron/tasks/rate-limit-sweep.ts, removed from the cron list in the same change set).
// Same rule: rows whose window ended more than an hour ago, from both stores.
import { num, stmt, type Statement } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { RecurringSlice } from "./types";

export function pruneRateLimitStatements(): Statement[] {
  const one = (table: "rate_limit_buckets" | "rate_limit_windows") =>
    stmt(
      `WITH d AS (DELETE FROM ${table} WHERE "resetAt" < ${NOW} - interval '1 hour' RETURNING 1)
SELECT count(*)::int AS deleted FROM d`,
    );
  return [one("rate_limit_buckets"), one("rate_limit_windows")];
}

export const pruneRateLimits: RecurringSlice = {
  id: "prune-rate-limits",
  statements: () => pruneRateLimitStatements(),
  async after(ctx, [buckets, windows]) {
    ctx.log.info("pruned rate limits", {
      buckets: num(buckets?.[0]?.deleted ?? 0),
      windows: num(windows?.[0]?.deleted ?? 0),
    });
  },
};
