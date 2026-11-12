// worker-alive (phase-03 plan §3.2, task D6 acceptance "the cron task alerts when the worker is down (a test with a
// fake URL)"): a signed metrics probe, a backstop kick, Sentry alerts for a down worker and a stalled daily planner.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyInternal, parseKeyRing, workerKidMayCall } from "@repo/contracts/internal/auth";
import type { WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import type { CronContext } from "./index";
import { HOUSEKEEPING_MAX_AGE_MS, createWorkerAlive, type AlertLevel, type WorkerAliveDeps } from "./worker-alive";

const NOW = Date.parse("2026-11-11T04:00:00Z");
const RING = `web:${Buffer.alloc(32, 3).toString("base64")},webwk:${Buffer.alloc(32, 7).toString("base64")}`;
const ENV = { ANALYSIS_WORKER_URL: "http://worker.test:3003/", INTERNAL_API_SECRET: RING };

const ctx: CronContext = { now: new Date(NOW), clock: () => NOW, sleep: async () => undefined, after: () => undefined, deadlineMs: NOW + 45_000 };

function metrics(overrides: Partial<WorkerMetricsResponse> = {}): WorkerMetricsResponse {
  return {
    v: 1,
    workerId: "dev-worker-ab12",
    bootId: "ab12",
    version: "0.1.0",
    profile: "sf18-v1",
    uptimeSec: 3 * 86_400,
    draining: false,
    nextRunAt: null,
    lastDrainAt: "2026-11-11T03:00:00.000Z",
    lastHousekeepingAt: "2026-11-10T21:00:05.000Z",
    queue: { depth: { "80+": 0, "<80": 3 }, oldestSec: { "80+": 0, "<80": 40 }, queueSeenAt: "2026-11-11T03:00:00.000Z" },
    jobs: { done: { ANALYZE_GAME: 12 }, failed: {}, durationMsP50: { ANALYZE_GAME: 21_000 } },
    engine: { nps: 400_000, restarts: 0 },
    cache: { hitsMemory: 10, hitsDisk: 2, misses: 30 },
    db: { statements: 90, retries: 0 },
    lagPauseMs: 0,
    emits: { "analysis:done": 12 },
    ...overrides,
  };
}

function harness(fetchImpl: WorkerAliveDeps["fetch"], env: Record<string, string | undefined> = ENV) {
  const alerts: { message: string; level: AlertLevel; extra: Record<string, unknown> }[] = [];
  let kicks = 0;
  const task = createWorkerAlive({
    env: () => env,
    fetch: fetchImpl,
    kick: async () => {
      kicks += 1;
      return { ok: true, status: 202 };
    },
    alert: (message, level, extra) => {
      alerts.push({ message, level, extra });
    },
  });
  return { task, alerts, kicks: () => kicks };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("worker-alive", () => {
  it("alerts (error) when the worker URL does not answer: a real fetch to a fake, unreachable URL", async () => {
    const h = harness((url, init) => fetch(url, init), { ...ENV, ANALYSIS_WORKER_URL: "http://127.0.0.1:9" });
    const out = await h.task.run(ctx);
    assert.deepEqual(out, { count: 0, detail: { alive: 0, kicked: 0 } });
    assert.equal(h.alerts.length, 1);
    assert.deepEqual({ m: h.alerts[0]!.message, l: h.alerts[0]!.level, r: h.alerts[0]!.extra.reason }, {
      m: "analysis.worker_down",
      l: "error",
      r: "network",
    });
    assert.equal(h.kicks(), 0, "no kick to a worker that is down");
  });

  it("alerts when ANALYSIS_WORKER_URL or the key ring is missing (the cron cannot reach the worker at all)", async () => {
    for (const env of [{ INTERNAL_API_SECRET: RING }, { ANALYSIS_WORKER_URL: "http://worker.test:3003" }]) {
      const h = harness(async () => json(metrics()), env);
      const out = await h.task.run(ctx);
      assert.equal(out.count, 0);
      assert.equal(h.alerts[0]?.message, "analysis.worker_down");
      assert.equal(h.alerts[0]?.extra.reason, "not_configured");
    }
  });

  it("alerts on a non-2xx answer and on a body that is not WorkerMetricsResponse", async () => {
    const down = harness(async () => new Response("nope", { status: 503 }));
    await down.task.run(ctx);
    assert.deepEqual(down.alerts[0]?.extra, { reason: "http_error", status: 503 });
    const garbled = harness(async () => json({ v: 2 }));
    await garbled.task.run(ctx);
    assert.equal(garbled.alerts[0]?.extra.reason, "bad_body");
  });

  it("a healthy worker: signed GET /internal/metrics (web may call it), one backstop kick, no alert", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const h = harness(async (url, init) => {
      seen.push({ url, init });
      return json(metrics());
    });
    const out = await h.task.run(ctx);
    assert.deepEqual(out, { count: 1, detail: { alive: 1, kicked: 1, housekeepingStale: 0, queueDepth: 3, queueOldestSec: 40 } });
    assert.deepEqual(h.alerts, []);
    assert.equal(h.kicks(), 1);
    assert.equal(seen[0]!.url, "http://worker.test:3003/internal/metrics");
    assert.equal(seen[0]!.init.method, "GET");
    const headers = new Headers(seen[0]!.init.headers);
    const verified = verifyInternal({
      headers,
      method: "GET",
      path: "/internal/metrics",
      body: "",
      keys: parseKeyRing(RING),
      nowMs: NOW,
    });
    assert.deepEqual(verified, { ok: true, kid: "webwk" });
    assert.equal(workerKidMayCall("webwk", "/internal/metrics"), true);
    assert.equal(workerKidMayCall("web", "/internal/metrics"), false, "the web's socket key never reaches the worker");
  });

  it("warns when no HOUSEKEEPING finished in 26 h, but not for a worker that booted less than 26 h ago", async () => {
    const old = new Date(NOW - HOUSEKEEPING_MAX_AGE_MS - 60_000).toISOString();
    const stale = harness(async () => json(metrics({ lastHousekeepingAt: old })));
    const out = await stale.task.run(ctx);
    assert.equal(out.detail?.housekeepingStale, 1);
    assert.deepEqual({ m: stale.alerts[0]?.message, l: stale.alerts[0]?.level }, { m: "analysis.housekeeping_missed", l: "warning" });
    assert.equal(stale.kicks(), 1, "the backstop kick still goes out");

    const fresh = harness(async () => json(metrics({ lastHousekeepingAt: null, uptimeSec: 3_600 })));
    assert.equal((await fresh.task.run(ctx)).detail?.housekeepingStale, 0);
    assert.deepEqual(fresh.alerts, []);

    const neverRan = harness(async () => json(metrics({ lastHousekeepingAt: null, uptimeSec: 2 * 86_400 })));
    assert.equal((await neverRan.task.run(ctx)).detail?.housekeepingStale, 1);
  });

  it("reports a failed kick without alerting twice (kickWorker reports it)", async () => {
    const task = createWorkerAlive({
      env: () => ENV,
      fetch: async () => json(metrics()),
      kick: async () => ({ ok: false, reason: "network" }),
      alert: () => assert.fail("no alert for a kick failure"),
    });
    assert.equal((await task.run(ctx)).detail?.kicked, 0);
  });
});
