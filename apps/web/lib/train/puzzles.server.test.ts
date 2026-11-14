// puzzles.server.ts (phase-05 plan §9.3, §7.3 W2, §8.6): the shard loader against the CI shard server
// (e2e/mocks/puzzle-shards.ts serving packages/chess-fixtures/puzzles/shards), and selectPuzzleBatch (WP-B's
// selectPuzzles over these shards: bands, widening, mix fallback, exclusion queries, session ids, rating order, due
// cards) on synthetic shards whose ratings the cases control. Nothing reaches R2.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError } from "@/lib/api/api-error";
import { startPuzzleShardServer } from "@/e2e/mocks/puzzle-shards";
import { puzzleWindow, type PuzzlePickItem } from "@repo/chess-training/session";
import { shardBitsTable } from "@repo/chess-training/themes";
import {
  availableNear,
  bandsFor,
  committedManifest,
  getShard,
  getShards,
  hasShardTheme,
  MIX_THEME,
  primaryThemeOf,
  PUZZLE_EXCLUSION_MAX_IDS,
  puzzlesEnabled,
  resetShardCache,
  selectPuzzleBatch,
  SHARD_LRU_MAX,
  SHARD_RETRY_DELAY_MS,
  shardCacheSize,
  shardConfig,
  shardThemes,
  solverColor,
  toPuzzleSnapshot,
  toShardPuzzle,
  type ShardDeps,
} from "./puzzles.server";
import { maskHas, PuzzleManifestSchema, type PuzzleManifest, type ShardTuple } from "./puzzle-shards";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/chess-fixtures/puzzles/shards");
const fixtureManifest = PuzzleManifestSchema.parse(JSON.parse(readFileSync(path.join(FX, "v1/manifest.json"), "utf8")));

type Captured = { counts: Record<string, string>[]; messages: string[]; sleeps: number[]; spans: string[] };

function stubDeps(over: Partial<ShardDeps> & { captured: Captured }): Partial<ShardDeps> {
  const { captured, ...rest } = over;
  return {
    telemetry: {
      startSpan: (name, _attrs, fn) => {
        captured.spans.push(name);
        return fn();
      },
      distribution: () => undefined,
      count: (_name, attrs) => void captured.counts.push(attrs),
      captureMessage: (message) => void captured.messages.push(message),
    },
    sleep: async (ms) => {
      captured.sleeps.push(ms);
    },
    perf: () => performance.now(),
    timeoutMs: 2500,
    ...rest,
  };
}

const newCaptured = (): Captured => ({ counts: [], messages: [], sleeps: [], spans: [] });

/** Fresh puzzles of a pick, in order. */
const fresh = (items: readonly PuzzlePickItem[]) => items.flatMap((i) => (i.source === "shard" ? [i.puzzle] : []));

describe("the committed manifest", () => {
  it("is valid, v1, with 30 shard themes plus mix", () => {
    const m = committedManifest();
    assert.equal(m.version, "v1");
    assert.equal(shardThemes(m).length, 30);
    assert.ok(m.themes[MIX_THEME]);
    assert.deepEqual(shardThemes(m).slice(0, 6), ["fork", "pin", "hangingPiece", "backRankMate", "mateIn2", "discoveredAttack"]);
  });

  it("is what the CI subset was cut from: same version and bits, every subset shard no larger", () => {
    const m = committedManifest();
    assert.equal(fixtureManifest.version, m.version);
    assert.deepEqual(fixtureManifest.bits, m.bits);
    for (const [theme, bands] of Object.entries(fixtureManifest.themes)) {
      for (const [band, n] of Object.entries(bands)) assert.ok(n <= (m.themes[theme]?.[band] ?? 0), `${theme}/${band}`);
    }
  });

  it("decodes masks with the taxonomy's bits: every manifest bit is the same bit in SHARD_THEME_BITS (append-only)", () => {
    const table = shardBitsTable();
    for (const [key, bit] of Object.entries(committedManifest().bits)) assert.equal(table[key], bit, key);
  });

  it("answers availableNear from the counts of the step-0 window's bands", () => {
    const m = committedManifest();
    const bands = bandsFor(puzzleWindow(1512, 0), "fork", m);
    assert.deepEqual(bands, [14, 15, 16]);
    assert.equal(availableNear("fork", 1512, m), bands.reduce((n, b) => n + (m.themes.fork?.[String(b)] ?? 0), 0));
    assert.equal(availableNear("rc:recapture", 1512, m), 0);
    assert.equal(hasShardTheme("rc:recapture", m), false);
    assert.equal(hasShardTheme(MIX_THEME, m), false);
    assert.equal(hasShardTheme("pin", m), true);
  });
});

describe("config", () => {
  it("reads the base URL and version, and refuses a version the manifest does not describe", () => {
    assert.deepEqual(shardConfig({ PUZZLE_SHARD_BASE_URL: "http://127.0.0.1:4012/puzzles/", PUZZLES_VERSION: "v1" }, fixtureManifest), {
      baseUrl: "http://127.0.0.1:4012/puzzles",
      version: "v1",
    });
    assert.throws(
      () => shardConfig({ PUZZLE_SHARD_BASE_URL: "http://x/puzzles", PUZZLES_VERSION: "v2" }, fixtureManifest),
      (e: unknown) => e instanceof ApiError && e.code === "not_configured",
    );
    assert.throws(() => shardConfig({}, fixtureManifest), (e: unknown) => e instanceof ApiError && e.code === "not_configured");
  });

  it("treats PUZZLES_ENABLED=off as the kill switch", () => {
    assert.equal(puzzlesEnabled({}), true);
    assert.equal(puzzlesEnabled({ PUZZLES_ENABLED: "off" }), false);
  });
});

describe("getShard against the CI shard server", () => {
  let server: Awaited<ReturnType<typeof startPuzzleShardServer>>;
  let captured: Captured;
  let deps: Partial<ShardDeps>;

  before(async () => {
    server = await startPuzzleShardServer({ port: 0, dir: FX });
  });
  after(() => server.close());
  beforeEach(async () => {
    resetShardCache();
    server.requests.length = 0;
    await fetch(`${server.origin}/__faults`, { method: "DELETE" });
    captured = newCaptured();
    deps = stubDeps({
      captured,
      env: { PUZZLE_SHARD_BASE_URL: server.baseUrl, PUZZLES_VERSION: "v1" },
      manifest: fixtureManifest,
      fetch: globalThis.fetch,
    });
  });
  const fault = (body: Record<string, unknown>) =>
    fetch(`${server.origin}/__faults`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("fetches a shard cold, then answers from the LRU without a request", async () => {
    const cold = await getShard("fork", 15, deps);
    assert.equal(cold.tuples.length, fixtureManifest.themes.fork?.["15"]);
    assert.ok(cold.tuples.every((t) => maskHas(t[4], "fork", fixtureManifest.bits)));
    const warm = await getShard("fork", 15, deps);
    assert.equal(warm, cold);
    assert.deepEqual(server.requests.map((r) => r.path), ["/puzzles/v1/fork/15.json"]);
    assert.deepEqual(captured.counts, [{ result: "miss" }, { result: "hit" }]);
    assert.deepEqual(captured.spans, ["shard.fetch"]);
    assert.equal(shardCacheSize(), 1);
  });

  it("shares one request between concurrent misses, and fetches two bands in parallel", async () => {
    const [a, b, c] = await Promise.all([getShard("pin", 14, deps), getShard("pin", 14, deps), getShard("pin", 14, deps)]);
    assert.equal(a, b);
    assert.equal(b, c);
    const shards = await getShards("pin", [15, 16], deps);
    assert.deepEqual(shards.map((s) => s.band), [15, 16]);
    assert.equal(server.requests.length, 3);
  });

  it("returns an empty shard without a request for a band the manifest does not list", async () => {
    const s = await getShard("fork", 20, deps);
    assert.deepEqual(s.tuples, []);
    assert.equal(server.requests.length, 0);
  });

  it("retries once after 200 ms", async () => {
    await fault({ match: "/fork/14\\.json$", status: 503, times: 1 });
    const s = await getShard("fork", 14, deps);
    assert.ok(s.tuples.length > 0);
    assert.deepEqual(server.requests.map((r) => r.status), [503, 200]);
    assert.deepEqual(captured.sleeps, [SHARD_RETRY_DELAY_MS]);
  });

  it("answers 502 upstream_unavailable after the retry fails, and caches nothing", async () => {
    await fault({ match: "/mateIn2/16\\.json$", status: 500, times: 2 });
    await assert.rejects(getShard("mateIn2", 16, deps), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "upstream_unavailable");
      assert.equal(e.status, 502);
      assert.deepEqual(e.details, { provider: "puzzles", kind: "error", shard: "mateIn2/16" });
      return true;
    });
    assert.deepEqual(captured.messages, ["train.shard.unavailable"]);
    assert.equal(shardCacheSize(), 0);
    // The server recovered: the next build fetches again.
    assert.ok((await getShard("mateIn2", 16, deps)).tuples.length > 0);
  });

  it("times out a slow shard server (kind timeout)", async () => {
    await fault({ match: "/backRankMate/15\\.json$", delayMs: 400, times: 2 });
    await assert.rejects(getShard("backRankMate", 15, { ...deps, timeoutMs: 100 }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "upstream_unavailable");
      assert.equal(e.details?.kind, "timeout");
      return true;
    });
  });

  it("rejects a body that is not the shard the path names", async () => {
    const wrong: typeof fetch = async (input, init) => fetch(String(input).replace("/pin/14.json", "/fork/14.json"), init);
    await assert.rejects(getShard("pin", 14, { ...deps, fetch: wrong }), (e: unknown) => e instanceof ApiError && e.code === "upstream_unavailable");
  });

  it("selects real fixture puzzles for a 1512 member: window [1412, 1662], rating ascending, one exclusion round", async () => {
    const asked: string[][] = [];
    const r = await selectPuzzleBatch(
      { theme: "fork", rating: 1512, count: 10, seed: 7, exclude: async (ids) => (asked.push(ids), []) },
      deps,
    );
    assert.equal(r.theme, "fork");
    assert.equal(r.widened, null);
    const picked = fresh(r.items);
    assert.equal(picked.length, 10);
    assert.ok(picked.every((t) => t[3] >= 1412 && t[3] <= 1662 && maskHas(t[4], "fork", fixtureManifest.bits)));
    assert.deepEqual(picked.map((t) => t[3]), picked.map((t) => t[3]).sort((a, b) => a - b));
    assert.equal(asked.length, 1);
    const again = await selectPuzzleBatch({ theme: "fork", rating: 1512, count: 10, seed: 7 }, deps);
    assert.deepEqual(fresh(again.items).map((t) => t[0]), picked.map((t) => t[0]));
    const p = toShardPuzzle(picked[0] as ShardTuple, fixtureManifest);
    assert.ok(p.themes.includes("fork"));
    assert.deepEqual(toPuzzleSnapshot(p, primaryThemeOf(p, "fork")), [p.id, p.fen, p.moves, p.rating, "fork"]);
    assert.deepEqual(new Set(server.requests.map((q) => q.path)), new Set([14, 15, 16].map((b) => `/puzzles/v1/fork/${b}.json`)));
  });

  it("answers 502 when a shard of the batch stays down", async () => {
    await fault({ match: "/pin/15\\.json$", status: 503, times: 2 });
    await assert.rejects(
      selectPuzzleBatch({ theme: "pin", rating: 1512, count: 10, seed: 1 }, deps),
      (e: unknown) => e instanceof ApiError && e.code === "upstream_unavailable",
    );
  });
});

// ---------------------------------------------------------------------------
// Selection rules on synthetic shards

const FEN = "6k1/5p1p/4p3/4q3/3nN3/2Q3P1/PP3P1P/6K1 w - - 2 37";
let serial = 0;
type Spec = Record<string, Record<number, number[]>>;

/** A manifest + a fetch that serves `spec` (theme → band → ratings) as v1 shards. */
function synthetic(spec: Spec, bits: Record<string, number> = { fork: 0, pin: 1 }) {
  const files = new Map<string, ShardTuple[]>();
  const themes: Record<string, Record<string, number>> = {};
  for (const [theme, bands] of Object.entries(spec)) {
    for (const [band, ratings] of Object.entries(bands)) {
      const mask = theme === MIX_THEME ? 1 : 2 ** (bits[theme] ?? 0);
      const tuples = ratings
        .slice()
        .sort((a, b) => a - b)
        .map((rating): ShardTuple => [`s${(serial++).toString(36).padStart(5, "0")}`, FEN, "e4d2 d4e2", rating, mask]);
      files.set(`${theme}/${band}`, tuples);
      (themes[theme] ??= {})[band] = tuples.length;
    }
  }
  const manifest: PuzzleManifest = PuzzleManifestSchema.parse({
    version: "v1",
    format: 1,
    built: "2026-11-13",
    source: "2026-11-01",
    license: "CC0",
    k: 1000,
    filter: { popularityMin: 80, nbPlaysMin: 300, ratingDeviationMax: 90, ratingMin: 600, ratingMax: 2599, movesMax: 15 },
    themes,
    bits,
    files: files.size,
    puzzles: [...files.values()].reduce((n, t) => n + t.length, 0),
    unique: [...files.values()].reduce((n, t) => n + t.length, 0),
  });
  const requests: string[] = [];
  const doFetch: typeof fetch = async (input) => {
    const m = /\/v1\/([^/]+)\/(\d+)\.json$/.exec(String(input));
    const key = m ? `${m[1]}/${m[2]}` : "";
    requests.push(key);
    const p = files.get(key);
    if (!p) return new Response("missing", { status: 404 });
    return Response.json({ v: 1, version: "v1", theme: m?.[1], band: Number(m?.[2]), p });
  };
  const ids = (theme: string) => [...files.entries()].filter(([k]) => k.startsWith(`${theme}/`)).flatMap(([, t]) => t.map((x) => x[0]));
  return { manifest, doFetch, requests, ids };
}

const range = (from: number, n: number, step = 1) => Array.from({ length: n }, (_, i) => from + i * step);

describe("selectPuzzleBatch rules", () => {
  beforeEach(() => resetShardCache());
  const depsFor = (s: ReturnType<typeof synthetic>) =>
    stubDeps({ captured: newCaptured(), env: { PUZZLE_SHARD_BASE_URL: "http://shards.test/puzzles" }, manifest: s.manifest, fetch: s.doFetch });

  it("stays in [R − 100, R + 150] when 15 candidates remain, reading only the bands that window touches", async () => {
    const s = synthetic({ fork: { 13: range(1300, 20, 5), 14: range(1420, 10, 5), 15: range(1500, 10, 10), 17: range(1700, 20) }, mix: { 15: range(1500, 50) } });
    const r = await selectPuzzleBatch({ theme: "fork", rating: 1512, count: 10, seed: 1 }, depsFor(s));
    assert.equal(r.theme, "fork");
    assert.equal(r.widened, null);
    assert.ok(fresh(r.items).every((t) => t[3] >= 1412 && t[3] <= 1662));
    assert.equal(fresh(r.items).length, 10);
    assert.deepEqual([...new Set(s.requests)].sort(), ["fork/14", "fork/15"]);
  });

  it("widens by ±100 per step until 15 candidates remain and reports the band-rounded window", async () => {
    const s = synthetic({ fork: { 13: range(1320, 12, 5), 15: range(1500, 5) }, mix: { 15: range(1500, 50) } });
    const r = await selectPuzzleBatch({ theme: "fork", rating: 1512, count: 10, seed: 2 }, depsFor(s));
    assert.equal(r.theme, "fork");
    assert.deepEqual(r.widened, { from: 1300, to: 1800 });
    const picked = fresh(r.items);
    assert.equal(picked.length, 10);
    assert.deepEqual(picked.map((t) => t[3]), picked.map((t) => t[3]).sort((a, b) => a - b));
  });

  it("falls back to mix when the theme stays short after widening", async () => {
    const s = synthetic({ fork: { 15: range(1500, 5) }, mix: { 14: range(1450, 30), 15: range(1500, 30) } });
    const r = await selectPuzzleBatch({ theme: "fork", rating: 1512, count: 10, seed: 3 }, depsFor(s));
    assert.equal(r.theme, MIX_THEME);
    assert.deepEqual(r.widened, { from: 1400, to: 1700 });
    assert.equal(fresh(r.items).length, 10);
  });

  it("goes straight to mix for a theme without shards (rc:*), with no shard request for it", async () => {
    const s = synthetic({ fork: { 15: range(1500, 30) }, mix: { 15: range(1500, 30) } });
    const r = await selectPuzzleBatch({ theme: "rc:recapture", rating: 1512, count: 5, seed: 4 }, depsFor(s));
    assert.equal(r.theme, MIX_THEME);
    assert.deepEqual(r.widened, { from: 1400, to: 1700 });
    assert.deepEqual([...new Set(s.requests)], ["mix/15"]);
  });

  it("gives a plain mix request no widening note", async () => {
    const s = synthetic({ mix: { 15: range(1500, 30) } });
    const r = await selectPuzzleBatch({ theme: MIX_THEME, rating: 1512, count: 5, seed: 5 }, depsFor(s));
    assert.equal(r.theme, MIX_THEME);
    assert.equal(r.widened, null);
  });

  it("returns what there is when even mix runs short", async () => {
    const s = synthetic({ fork: { 15: range(1500, 3) }, mix: { 15: range(1500, 2) } });
    const r = await selectPuzzleBatch({ theme: "fork", rating: 1512, count: 10, seed: 6 }, depsFor(s));
    // mix has even fewer: the theme's own widest pool is kept.
    assert.equal(r.theme, "fork");
    assert.equal(fresh(r.items).length, 3);
    assert.notEqual(r.widened, null);
  });

  it("leaves out recently attempted ids (one query for the step-0 shards) and ids already in the session", async () => {
    const s = synthetic({ fork: { 14: range(1412, 88), 15: range(1500, 100), 16: range(1600, 63) }, mix: { 15: range(1500, 10) } });
    const all = s.ids("fork");
    const calls: string[][] = [];
    const seen = new Set(all.filter((_, i) => i % 2 === 0));
    const sessionIds = new Set(all.filter((_, i) => i % 3 === 1));
    const r = await selectPuzzleBatch(
      {
        theme: "fork",
        rating: 1512,
        count: 10,
        seed: 8,
        sessionIds,
        exclude: async (ids) => {
          calls.push(ids);
          return ids.filter((id) => seen.has(id));
        },
      },
      depsFor(s),
    );
    assert.equal(calls.length, 1);
    assert.equal((calls[0] ?? []).length, 251);
    const picked = fresh(r.items);
    assert.equal(picked.length, 10);
    assert.ok(picked.every((t) => !seen.has(t[0]) && !sessionIds.has(t[0])));
    assert.equal(r.widened, null);
  });

  it("splits an exclusion round into queries of at most 500 ids", async () => {
    const s = synthetic({ fork: { 14: range(1412, 700, 0.125).map(Math.floor) }, mix: { 15: range(1500, 10) } });
    const calls: string[][] = [];
    await selectPuzzleBatch({ theme: "fork", rating: 1499, count: 10, seed: 9, exclude: async (ids) => (calls.push(ids), []) }, depsFor(s));
    assert.deepEqual(calls.map((c) => c.length), [PUZZLE_EXCLUSION_MAX_IDS, 200]);
    assert.equal(new Set(calls.flat()).size, 700);
  });

  it("asks about a widening band when it loads, before its ids can be picked", async () => {
    const s = synthetic({ fork: { 13: range(1320, 20, 4), 15: range(1500, 5) }, mix: { 15: range(1500, 50) } });
    const band13 = new Set(s.ids("fork").slice(0, 20));
    const calls: string[][] = [];
    const r = await selectPuzzleBatch(
      {
        theme: "fork",
        rating: 1512,
        count: 10,
        seed: 10,
        exclude: async (ids) => {
          calls.push(ids);
          return ids.filter((id) => band13.has(id)).slice(0, 10);
        },
      },
      depsFor(s),
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(new Set(calls[1]), band13);
    const excluded = new Set([...band13].filter((id) => calls[1]?.includes(id)).slice(0, 10));
    assert.ok(fresh(r.items).every((t) => !excluded.has(t[0])));
    assert.deepEqual(r.widened, { from: 1300, to: 1800 });
  });

  it("interleaves due PUZZLE-deck cards every third slot (WP-B's rule, through the loader)", async () => {
    const s = synthetic({ fork: { 15: range(1500, 40) }, mix: { 15: range(1500, 10) } });
    const due = [0, 1, 2, 3].map((i) => ({ key: `p_due${i}x`, puzzleId: `due${i}x`, rating: 1500, due: new Date(Date.UTC(2026, 10, 10, i)) }));
    const r = await selectPuzzleBatch({ theme: "fork", rating: 1512, count: 10, seed: 11, dueCards: due }, depsFor(s));
    assert.equal(r.items.length, 10);
    assert.deepEqual(
      r.items.map((i, n) => (i.source === "card" ? n : -1)).filter((n) => n >= 0),
      [2, 5, 8],
    );
  });

  it("evicts the least recently used shard beyond 50", async () => {
    const spec: Spec = { fork: {}, pin: {}, mix: {} };
    for (let b = 6; b <= 25; b++) for (const t of ["fork", "pin", "mix"]) (spec[t] as Record<number, number[]>)[b] = [b * 100];
    const s = synthetic(spec);
    const deps = depsFor(s);
    const keys = ["fork", "pin", "mix"].flatMap((t) => range(6, 20).map((b) => [t, b] as const)).slice(0, SHARD_LRU_MAX + 1);
    for (const [t, b] of keys) await getShard(t, b, deps);
    assert.equal(shardCacheSize(), SHARD_LRU_MAX);
    const before = s.requests.length;
    await getShard("fork", 6, deps); // the first one in, evicted by the 51st
    await getShard("mix", 6, deps); // still cached
    assert.equal(s.requests.length, before + 1);
  });
});

describe("helpers", () => {
  it("solverColor is the side not to move in the Lichess FEN", () => {
    assert.equal(solverColor(FEN), "b");
    assert.equal(solverColor("4rk2/p1q5/1p3Q1b/8/1p5N/2P1p3/P3P3/2K5 b - - 0 43"), "w");
  });

  it("primaryThemeOf keeps the requested theme, else the taxonomy's primary theme, else mix", () => {
    assert.equal(primaryThemeOf({ themes: ["fork", "pin"] }, "pin"), "pin");
    assert.equal(primaryThemeOf({ themes: ["pin", "fork", "short"] }, MIX_THEME), "fork");
    assert.equal(primaryThemeOf({ themes: ["short", "crushing"] }, "skewer"), MIX_THEME);
  });
});
