// HOUSEKEEPING slice 4 (phase-03 plan §7.7, P3-D10): once a week (Sunday's run, UTC) the SQLite eval cache is
// trimmed to EVAL_CACHE_MAX_GB by `used_at` (least recently used rows first). No database statement.
import type { RecurringSlice } from "./types";

/** getUTCDay() of the weekly run. */
export const TRIM_WEEKDAY_UTC = 0;

export const evalcacheTrim: RecurringSlice = {
  id: "evalcache-trim",
  async run(ctx) {
    if (ctx.now.getUTCDay() !== TRIM_WEEKDAY_UTC || !ctx.evalCache) return;
    const { deleted, sizeBytes } = ctx.evalCache.trimTo(ctx.evalCacheMaxBytes);
    ctx.log.info("eval cache trimmed", { deleted, sizeBytes });
  },
};
