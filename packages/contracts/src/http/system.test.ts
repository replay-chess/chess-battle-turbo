import assert from "node:assert/strict";
import { test } from "node:test";
import { CronDailyData } from "./system";

// The cron route returns per-task `detail` tallies (lib/cron/tasks/index.ts). A strict parse must keep them,
// so moving the route onto route() with response validation can't silently strip them.
test("CronDailyData keeps each task's detail tallies", () => {
  const body = {
    tasks: {
      "rate-limit-sweep": { ok: true, ms: 12, count: 3, detail: { buckets: 2, windows: 1 } },
      "billing-reconcile": { ok: false, ms: 40 },
    },
    durationMs: 55,
  };
  assert.deepEqual(CronDailyData.parse(body), body);
});

test("CronDailyData rejects non-numeric detail values", () => {
  const bad = { tasks: { x: { ok: true, ms: 1, detail: { buckets: "two" } } }, durationMs: 1 };
  assert.equal(CronDailyData.safeParse(bad).success, false);
});
