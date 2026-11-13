// Plan §12.1 `WEB/lib/accounts/__tests__/chesscom-lookup.test.ts`: web 429 → worker fallback called once; web 403 →
// fallback; web 404 → no fallback; fallback `rate_limited` → our 429 with `source: chesscom`; fallback timeout → 502
// `kind: timeout`; the cached value records `source`; the cache keeps `not_found` but never an error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { InternalLookupBody } from "@repo/contracts/internal/provider";
import { ApiError } from "@/lib/api/api-error";
import type { DataCache } from "@/lib/api/context";
import { installTestDeps } from "@/test/helpers/route-harness";
import { chesscomLookup, chesscomRecentGames, setChessComFetch } from "./chesscom";
import { lookupDataOf } from "./preview";
import { setWorkerLookupTransport } from "./worker-lookup";

const require = createRequire(import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(require.resolve(`@repo/chess-fixtures/import/chesscom/knightowl_88/${name}`), "utf8"));
const PROFILE = fixture("profile.json");
const STATS = fixture("stats.json");
const ARCHIVES = fixture("archives.json");
const OCT = fixture("2026-10.json");
const SEP = fixture("2026-09.json");

const ENV = {
  ANALYSIS_WORKER_URL: "http://worker.test",
  INTERNAL_API_SECRET: `webwk:${"k".repeat(64)}`,
  CHESSCOM_API_BASE: "http://upstream.test/chesscom",
};

/** A Map-backed stand-in for unstable_cache (one entry per key; errors are not stored, as in Next). */
function memoryCache(): { cache: DataCache; size: () => number } {
  const store = new Map<string, unknown>();
  const cache: DataCache = (fn, keyParts) => async () => {
    const key = JSON.stringify(keyParts);
    if (store.has(key)) return store.get(key) as never;
    const value = await fn();
    store.set(key, value);
    return value;
  };
  return { cache, size: () => store.size };
}

type Upstream = Record<string, () => Response>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

let calls: string[] = [];
let workerBodies: unknown[] = [];
let restores: (() => void)[] = [];

function upstream(routes: Upstream) {
  restores.push(
    setChessComFetch(async (url) => {
      const path = new URL(url).pathname.replace(/^\/chesscom/, "");
      calls.push(path);
      const route = routes[path];
      return route ? route() : json({ code: 0, message: "not found" }, 404);
    }),
  );
}

function worker(answer: () => Response | Promise<Response>) {
  restores.push(
    setWorkerLookupTransport(async (_url, init) => {
      workerBodies.push(InternalLookupBody.parse(JSON.parse(String(init.body))));
      return answer();
    }),
  );
}

const ok = { "/pub/player/knightowl_88": () => json(PROFILE), "/pub/player/knightowl_88/stats": () => json(STATS) };

beforeEach(() => {
  calls = [];
  workerBodies = [];
  restores = [];
});
afterEach(() => {
  for (const r of restores.reverse()) r();
});

function deps(cache = memoryCache()) {
  const t = installTestDeps({ env: ENV, overrides: { dataCache: cache.cache } });
  restores.push(t.restore);
  return { ...t, cache };
}

describe("chesscomLookup", () => {
  it("web found: profile then stats, serially; the second call is a cache hit", async () => {
    deps();
    upstream(ok);
    const first = await chesscomLookup("KnightOwl_88");
    assert.equal(first.cache, "miss");
    assert.equal(first.value.kind, "found");
    assert.equal(first.value.source, "web");
    assert.deepEqual(calls, ["/pub/player/knightowl_88", "/pub/player/knightowl_88/stats"]);
    const second = await chesscomLookup("knightowl_88");
    assert.equal(second.cache, "hit");
    assert.equal(calls.length, 2);
    assert.equal(workerBodies.length, 0);
    const data = lookupDataOf(first.value.kind === "found" ? first.value.profile : PROFILE, first.value.kind === "found" ? first.value.stats : STATS);
    assert.ok(data.totalRatedGames > 0);
  });

  it("web 429 → the worker answers once, cached with source worker", async () => {
    deps();
    upstream({ "/pub/player/knightowl_88": () => json({}, 429, { "retry-after": "60" }) });
    worker(() => json({ kind: "found", profile: PROFILE, stats: STATS }));
    const r = await chesscomLookup("knightowl_88");
    assert.equal(r.value.kind, "found");
    assert.equal(r.value.source, "worker");
    assert.deepEqual(workerBodies, [{ v: 1, username: "knightowl_88", what: "profile+stats" }]);
    await chesscomLookup("knightowl_88");
    assert.equal(workerBodies.length, 1, "cached");
  });

  it("web 403 → fallback too", async () => {
    deps();
    upstream({ "/pub/player/knightowl_88": () => json({}, 403) });
    worker(() => json({ kind: "not_found" }));
    const r = await chesscomLookup("knightowl_88");
    assert.deepEqual(r.value, { kind: "not_found", source: "worker", fallbackStatus: 403 });
    assert.equal(workerBodies.length, 1);
  });

  it("web 404 → not_found without a fallback, and it is cached", async () => {
    const { cache } = deps();
    upstream({});
    worker(() => json({ kind: "found", profile: PROFILE, stats: STATS }));
    assert.deepEqual((await chesscomLookup("nosuchuser")).value, { kind: "not_found", source: "web" });
    assert.equal((await chesscomLookup("nosuchuser")).cache, "hit");
    assert.equal(workerBodies.length, 0);
    assert.equal(cache.size(), 1);
  });

  it("a closed profile (410) is private", async () => {
    deps();
    upstream({ "/pub/player/knightowl_88": () => json({}, 410) });
    assert.equal((await chesscomLookup("knightowl_88")).value.kind, "private");
  });

  it("fallback rate_limited → 429 rate_limited {source: chesscom}, retryAfterSec from the worker; not cached", async () => {
    const { cache } = deps();
    upstream({ "/pub/player/knightowl_88": () => json({}, 429) });
    worker(() => json({ kind: "rate_limited", retryAfterSec: 45 }));
    await assert.rejects(chesscomLookup("knightowl_88"), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "rate_limited");
      assert.equal(e.retryAfterSec, 45);
      assert.deepEqual(e.details, { source: "chesscom" });
      return true;
    });
    assert.equal(cache.size(), 0);
  });

  it("fallback timeout → 502 upstream_unavailable kind timeout", async () => {
    deps();
    upstream({ "/pub/player/knightowl_88": () => json({}, 429) });
    worker(() => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    await assert.rejects(chesscomLookup("knightowl_88"), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "upstream_unavailable");
      assert.equal(e.status, 502);
      assert.equal((e.details as { kind: string }).kind, "timeout");
      assert.equal((e.details as { provider: string }).provider, "chesscom");
      return true;
    });
  });

  it("a worker 5xx or a bad body → 502 kind error; web 5xx → 502 without a fallback, never cached", async () => {
    const { cache } = deps();
    upstream({ "/pub/player/knightowl_88": () => json({}, 429) });
    worker(() => json({ error: "internal" }, 500));
    await assert.rejects(chesscomLookup("knightowl_88"), (e: unknown) => e instanceof ApiError && e.code === "upstream_unavailable");
    restores.pop()!();
    worker(() => json({ kind: "found", profile: { nope: 1 } }));
    await assert.rejects(chesscomLookup("knightowl_88"), (e: unknown) => e instanceof ApiError && e.code === "upstream_unavailable");
    restores.pop()!();
    restores.pop()!();
    upstream({ "/pub/player/knightowl_88": () => json({}, 503) });
    const before = workerBodies.length;
    await assert.rejects(chesscomLookup("knightowl_88"), (e: unknown) => e instanceof ApiError && (e.details as { kind: string }).kind === "error");
    assert.equal(workerBodies.length, before, "no fallback on a 5xx");
    assert.equal(cache.size(), 0);
  });
});

describe("chesscomRecentGames", () => {
  it("the newest month, topped up from the previous one, newest first", async () => {
    deps();
    upstream({
      "/pub/player/knightowl_88/games/archives": () => json(ARCHIVES),
      "/pub/player/knightowl_88/games/2026/10": () => json(OCT),
      "/pub/player/knightowl_88/games/2026/09": () => json(SEP),
    });
    const games = await chesscomRecentGames("knightowl_88");
    assert.equal(games.length, 5);
    const times = games.map((g) => Date.parse(g.endedAt));
    assert.deepEqual([...times].sort((a, b) => b - a), times);
    for (const g of games) assert.ok(["win", "loss", "draw"].includes(g.result));
  });

  it("archives 429 → the worker's archives+month", async () => {
    deps();
    upstream({ "/pub/player/knightowl_88/games/archives": () => json({}, 429) });
    worker(() => json({ kind: "found", profile: PROFILE, archives: ["2026/09", "2026/10"], month: OCT }));
    const games = await chesscomRecentGames("knightowl_88");
    assert.ok(games.length > 0);
    assert.equal((workerBodies[0] as { what: string }).what, "archives+month");
  });
});
