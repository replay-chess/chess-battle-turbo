// Operations helpers without a server: the signing CLI's requests, `/ready`'s rules, the metrics aggregation that is
// pushed to Sentry every 60 s, and the outbox stats with a failing database.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requestFor } from "../src/cli/internal";
import { readiness } from "../src/http/ready";
import { AggregatingMetrics, startMetricsPush, staticLoopLag, type MetricsSink } from "../src/obs/metrics";

describe("signing CLI", () => {
  test("broadcast, drain, metrics, emit-echo requests; bad input refused", () => {
    assert.deepEqual(requestFor(["broadcast", "--in", "30"]), {
      method: "POST",
      path: "/internal/broadcast",
      body: JSON.stringify({ v: 1, type: "restart", inSeconds: 30 }),
      kid: "ops",
    });
    assert.equal((requestFor(["drain"]) as { path: string }).path, "/internal/drain");
    assert.deepEqual(requestFor(["metrics"]), { method: "GET", path: "/internal/metrics", body: "", kid: "ops" });
    assert.equal((requestFor(["emit-echo", "--user", "cabc"]) as { kid: string }).kid, "web");
    assert.ok("error" in requestFor(["broadcast", "--in", "3"]));
    assert.ok("error" in requestFor(["emit-echo"]));
    assert.ok("error" in requestFor(["nope"]));
  });
});

describe("/ready", () => {
  const base = {
    now: () => 1_000_000,
    bootAt: 0,
    draining: () => false,
    restored: () => true,
    liveGames: () => 1,
    outbox: () => ({ depth: 0, oldestMs: 0, dbOkAt: 999_000, lastFailAt: null }),
  };
  test("ready when restored, not draining, outbox fresh", () => {
    assert.equal(readiness(base).ready, true);
  });
  test("503 while draining, before the restore, with a 60 s old outbox, or a DB failing for 5 min with live games", () => {
    assert.equal(readiness({ ...base, draining: () => true }).ready, false);
    assert.equal(readiness({ ...base, restored: () => false }).ready, false);
    assert.equal(readiness({ ...base, outbox: () => ({ depth: 1, oldestMs: 60_001, dbOkAt: 999_000, lastFailAt: null }) }).ready, false);
    const stuck = { depth: 0, oldestMs: 0, dbOkAt: 600_000, lastFailAt: 990_000 };
    assert.equal(readiness({ ...base, outbox: () => stuck }).ready, false);
    assert.equal(readiness({ ...base, outbox: () => stuck, liveGames: () => 0 }).ready, true, "idle: no DB rule");
    const quiet = { depth: 0, oldestMs: 0, dbOkAt: 600_000, lastFailAt: null };
    assert.equal(readiness({ ...base, outbox: () => quiet }).ready, true, "no failure, just a quiet game");
  });
});

describe("metrics aggregation", () => {
  test("counters sum, samples become p50/p99/max, gauges and loop lag are pushed", () => {
    const m = new AggregatingMetrics();
    m.count("ws.persist.fail", { op: "checkpoint", code: "P1017" });
    m.count("ws.persist.fail", { code: "P1017", op: "checkpoint" }, 2);
    for (let i = 1; i <= 100; i++) m.sample("ws.move_latency_ms", i);
    const out: [string, number, Record<string, string>][] = [];
    const sink: MetricsSink = { count: (n, v, t) => out.push([n, v, t]), gauge: (n, v, t) => out.push([n, v, t]) };
    const push = startMetricsPush({
      metrics: m,
      sink,
      loopLag: staticLoopLag(7),
      gauges: () => ({ sockets: 3, gamesByPhase: { playing: 2 }, outboxDepth: 1, outboxOldestMs: 500 }),
      base: { env: "test" },
    });
    push.pushNow();
    push.stop();
    const get = (n: string) => out.find((o) => o[0] === n);
    assert.equal(get("ws.persist.fail")![1], 3);
    assert.deepEqual(get("ws.persist.fail")![2], { env: "test", code: "P1017", op: "checkpoint" });
    assert.equal(get("ws.move_latency_ms.p50")![1], 50);
    assert.equal(get("ws.move_latency_ms.p99")![1], 99);
    assert.equal(get("ws.loop_lag_ms.p99")![1], 7);
    assert.equal(get("ws.games")![2].phase, "playing");
    assert.equal(get("ws.outbox.oldest_ms")![1], 500);
    out.length = 0;
    push.pushNow();
    assert.equal(get("ws.persist.fail"), undefined, "the window was drained");
  });
});
