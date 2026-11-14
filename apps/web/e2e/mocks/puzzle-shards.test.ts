// The CI puzzle shard server (puzzle-shards.ts; phase-05 plan §9.3): R2's headers on the committed fixtures, 404 for
// anything else, path traversal refused, the request log and the keyed faults the specs use.
import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, it } from "node:test";
import { startPuzzleShardServer } from "./puzzle-shards";
import { DEFAULT_PUZZLE_SHARDS_PORT, puzzleShardEnv } from "./puzzle-shards-client";

describe("puzzle shard server", () => {
  let s: Awaited<ReturnType<typeof startPuzzleShardServer>>;
  before(async () => {
    s = await startPuzzleShardServer({ port: 0 });
  });
  after(() => s.close());
  beforeEach(async () => {
    await fetch(`${s.origin}/__faults`, { method: "DELETE" });
    await fetch(`${s.origin}/__requests`, { method: "DELETE" });
  });

  it("is healthy and serves the v1 fixtures", async () => {
    const health = (await (await fetch(`${s.origin}/__health`)).json()) as { ok: boolean; versions: string[]; files: number };
    assert.equal(health.ok, true);
    assert.deepEqual(health.versions, ["v1"]);
    assert.equal(health.files, 43); // 6 themes × 7 bands + the manifest
  });

  it("answers a shard and the manifest with R2's headers, HEAD without a body", async () => {
    const res = await fetch(`${s.baseUrl}/v1/fork/15.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    const body = (await res.json()) as { theme: string; band: number; p: unknown[] };
    assert.equal(body.theme, "fork");
    assert.equal(body.band, 15);
    const m = await fetch(`${s.baseUrl}/v1/manifest.json`);
    assert.equal(((await m.json()) as { version: string }).version, "v1");
    const head = await fetch(`${s.baseUrl}/v1/pin/14.json`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });

  it("answers 404 for a missing shard or a traversal attempt, 405 for a write", async () => {
    assert.equal((await fetch(`${s.baseUrl}/v1/fork/22.json`)).status, 404);
    assert.equal((await fetch(`${s.baseUrl}/v2/fork/15.json`)).status, 404);
    assert.equal((await fetch(`${s.origin}/puzzles/v1/..%2f..%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${s.baseUrl}/v1/fork/15.json`, { method: "PUT", body: "x" })).status, 405);
  });

  it("logs requests and applies keyed faults a given number of times", async () => {
    const since = Date.now();
    const f = await fetch(`${s.origin}/__faults`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ match: "/pin/", status: 503, times: 1 }),
    });
    assert.equal(f.status, 200);
    assert.equal((await fetch(`${s.baseUrl}/v1/pin/15.json`)).status, 503);
    assert.equal((await fetch(`${s.baseUrl}/v1/pin/15.json`)).status, 200);
    assert.equal((await fetch(`${s.baseUrl}/v1/fork/15.json`)).status, 200);
    const log = (await (await fetch(`${s.origin}/__requests?since=${since}`)).json()) as { requests: { path: string; status: number }[] };
    assert.deepEqual(
      log.requests.map((r) => [r.path, r.status]),
      [
        ["/puzzles/v1/pin/15.json", 503],
        ["/puzzles/v1/pin/15.json", 200],
        ["/puzzles/v1/fork/15.json", 200],
      ],
    );
  });

  it("delays a response when asked", async () => {
    await fetch(`${s.origin}/__faults`, { method: "POST", body: JSON.stringify({ match: "/mix/14", delayMs: 150, times: 1 }) });
    const t0 = performance.now();
    assert.equal((await fetch(`${s.baseUrl}/v1/mix/14.json`)).status, 200);
    assert.ok(performance.now() - t0 >= 140);
  });

  it("gives the web server the 4012 (+ offset) base URL and the v1 version", () => {
    const env = puzzleShardEnv();
    assert.match(env.PUZZLE_SHARD_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/puzzles$/);
    assert.equal(Number(/:(\d+)\//.exec(env.PUZZLE_SHARD_BASE_URL)?.[1]), DEFAULT_PUZZLE_SHARDS_PORT + (Number(process.env.E2E_PORT_OFFSET ?? 0) || 0));
    assert.equal(env.PUZZLES_VERSION, "v1");
  });
});
