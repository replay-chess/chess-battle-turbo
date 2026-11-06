// No timer queries the database (phase-02 plan 12.4 `no-idle-queries`, 7.7, api-perf §5 "timer audit"): with no
// live games, 24 simulated hours of every server timer (eviction sweep, limiter prune, journal fsync and hourly
// cleanup, metrics push, loop-lag probe) send zero statements, so the Neon compute can scale to zero.
import { after, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../src/boot";
import { AggregatingMetrics, type MetricsSink } from "../src/obs/metrics";
import { SILENT_LOGGER } from "../src/ports";
import { testEnv, testTiming } from "./helpers";
import { newJournalDir } from "./db";

describe("no idle queries", () => {
  after(() => mock.timers.reset());

  test("24 h of timers with no live games: zero DB statements", async () => {
    let statements = 0;
    const db = {
      $queryRaw: () => {
        statements++;
        return Promise.resolve([]);
      },
      $executeRaw: () => {
        statements++;
        return Promise.resolve(0);
      },
      $disconnect: () => Promise.resolve(),
    };
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.now() });
    const metrics = new AggregatingMetrics();
    const pushed: string[] = [];
    const sink: MetricsSink = { count: (n) => pushed.push(n), gauge: (n) => pushed.push(n) };
    const booted = await bootServer({
      env: testEnv(),
      db: db as never,
      log: SILENT_LOGGER,
      metrics,
      timing: testTiming(),
      journalDir: newJournalDir(),
      metricsPush: { metrics, sink },
    });
    await booted.restore();
    const atBoot = statements;
    assert.ok(atBoot >= 2, "the boot restore list and the boot stale sweep");
    for (let minute = 0; minute < 24 * 60; minute++) {
      mock.timers.tick(60_000);
      await Promise.resolve();
    }
    assert.equal(statements - atBoot, 0, "no statement in 24 h of timers");
    assert.ok(pushed.includes("ws.sockets"), "the metrics push ran");
    mock.timers.reset();
    await booted.stop();
  });
});
