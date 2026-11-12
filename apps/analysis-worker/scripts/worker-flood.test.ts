// The §12.7 throughput / co-location tool (scripts/worker-flood.ts; FIX-1): argument parsing, the gates and the
// signing kid. The database half runs in src/flood.int.test.ts.
// regression: throughput-tooling-missing (FIX-1): bench.ts measured one cold game only, nothing enqueued 60 games or
// read the cache hit ratio, the per-game emits or the socket's lag while the worker ran flat out.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { parseKeyRing } from "@repo/contracts/internal/auth";
import type { WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import { GATE, parseArgs, percentile, summarise, workerKid, type BenchGame } from "./worker-flood";

const k = () => randomBytes(32).toString("base64");

function metrics(o: { hits?: number; misses?: number; emits?: Record<string, number>; nps?: number | null } = {}): WorkerMetricsResponse {
  return {
    v: 1,
    workerId: "dev-worker-ab12",
    bootId: "ab12",
    version: "0.1.0",
    profile: "sf18-v1",
    uptimeSec: 60,
    draining: false,
    nextRunAt: null,
    lastDrainAt: null,
    lastHousekeepingAt: null,
    queue: { depth: { "80+": 0, "<80": 0 }, oldestSec: { "80+": 0, "<80": 0 }, queueSeenAt: null },
    jobs: { done: {}, failed: {}, durationMsP50: {} },
    engine: { nps: o.nps ?? 400_000, restarts: 0 },
    cache: { hitsMemory: o.hits ?? 0, hitsDisk: 0, misses: o.misses ?? 0 },
    db: { statements: 0, retries: 0 },
    lagPauseMs: 0,
    emits: o.emits ?? {},
  } as WorkerMetricsResponse;
}

const games: BenchGame[] = Array.from({ length: 60 }, (_, i) => ({ id: String(i + 1), ref: `cbench${i}`, plies: 60 }));

describe("worker-flood", () => {
  it("parses its arguments; co-location needs the socket URL", () => {
    const a = parseArgs([], { PORT: "3003" });
    assert.equal(a.games, 60);
    assert.equal(a.workerUrl, "http://127.0.0.1:3003");
    assert.equal(parseArgs(["--games", "6", "--colocation"], { WS_INTERNAL_URL: "http://localhost:3002" }).colocation, true);
    assert.throws(() => parseArgs(["--colocation"], {}), /needs WS_INTERNAL_URL/);
    assert.throws(() => parseArgs(["--games", "0"], {}), /1\.\.500/);
    assert.throws(() => parseArgs(["--bogus"], {}), /unknown argument/);
  });

  it("passes at ≥ 60 games/hour with no failure and no per-game emit; reports the cache hit ratio", () => {
    const r = summarise({
      games,
      done: 60,
      failed: 0,
      skipped: 0,
      elapsedMs: 50 * 60_000,
      before: metrics({ hits: 10, misses: 100, emits: { "analysis:batch": 2 } }),
      after: metrics({ hits: 1_010, misses: 3_100, emits: { "analysis:batch": 5, "games:changed": 0 } }),
      lagP99s: null,
      nowIso: "2026-11-12T00:00:00.000Z",
    });
    assert.equal(r.gamesPerHour, 72);
    assert.equal(r.cache.hitRatio, 0.25);
    assert.equal(r.batchEmits, 3);
    assert.deepEqual(r.gate.failures, []);
    assert.equal(r.gate.pass, true);
    assert.equal(r.games.averagePlies, 60);
  });

  it("fails on a slow run, a failed game, a per-game emit and a laggy socket", () => {
    const r = summarise({
      games,
      done: 59,
      failed: 1,
      skipped: 0,
      elapsedMs: 70 * 60_000,
      before: metrics(),
      after: metrics({ emits: { "analysis:done": 2, "analysis:progress": 40 } }),
      lagP99s: [12, 20, 61, 18],
      nowIso: "2026-11-12T00:00:00.000Z",
    });
    assert.equal(r.gate.pass, false);
    const text = r.gate.failures.join(" | ");
    assert.match(text, /games\/hour < 60/);
    assert.match(text, /1 failed/);
    assert.match(text, /analysis:progress ×40/);
    assert.match(text, /analysis:done ×2/);
    assert.match(text, new RegExp(`loop lag p99 61 ms ≥ ${GATE.lagP99MaxMs}`));
    assert.equal(r.lag?.p99MaxMs, 61);
  });

  it("p99 of the samples; signs with opswk in the container, else webwk", () => {
    assert.equal(percentile([], 99), null);
    assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 99), 99);
    assert.equal(workerKid(parseKeyRing(`wk:${k()},opswk:${k()},webwk:${k()}`)), "opswk");
    assert.equal(workerKid(parseKeyRing(`wk:${k()},webwk:${k()}`)), "webwk");
    assert.throws(() => workerKid(parseKeyRing(`wk:${k()}`)), /no opswk or webwk key/);
  });
});
