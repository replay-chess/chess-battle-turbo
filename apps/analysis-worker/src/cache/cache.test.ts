// The eval cache (phase-03 plan §12.1 `cache.test`, task C4): exact (engine, nodes, multipv) matches only; seed rows
// only when allowed and deep enough; the bypass rules (repeated EPD, half-move ≥ 90, EVAL_CACHE=off); LRU eviction
// with the SQLite tier behind it; the batched SQLite write and the used_at refresh; the trim; the seed merge and the
// first-boot download.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { NO_SECOND } from "@repo/chess-analysis/codec";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { cacheEligible, EvalCache, HALFMOVE_BYPASS, seedAllowed, type CachedEval, type EvalKey } from "./evalcache";
import { applySchema, SEED_ENGINE, SEED_NAME, UPSERT_SQL } from "./schema";
import { ensureSeed } from "./seed";

const EPD = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";
const KEY: EvalKey = { epd: EPD, engine: "sf18-armv8dp-c288c895", nodes: 120_000, multipv: 2 };
const VALUE: CachedEval = { eval: 31, second: 18, best: "e7e5", depth: 17, lines: [{ eval: 31, pv: ["e7e5", "g1f3"] }, { eval: 18, pv: ["c7c5"] }] };

function fresh(opts: { lruMax?: number; flushEvery?: number; now?: () => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wk-cache-"));
  const metrics = new Metrics({ workerId: "t", bootId: "00000000", version: "0", profile: "sf18-v1" }, 0);
  const path = join(dir, "evals.sqlite");
  const cache = EvalCache.open({ path, log: silentLogger, metrics, nowMs: opts.now ?? (() => 1_800_000_000_000), ...opts });
  return { cache, metrics, path, dir };
}

/** Builds a seed file the way scripts/seed-evalcache.ts does. */
function seedFile(dir: string, rows: { epd: string; nodes: number; multipv: number; eval: number; second: number }[], name = SEED_NAME): string {
  const path = join(dir, `${name}.sqlite`);
  const db = new Database(path);
  applySchema(db);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('name', ?)").run(name);
  const ins = db.prepare(UPSERT_SQL);
  for (const r of rows) ins.run({ ...r, engine: SEED_ENGINE, best: "e7e5", depth: 40, lines: JSON.stringify([[r.eval, "e7e5"]]), used_at: 0 });
  db.close();
  return path;
}

describe("eval cache: lookup rules", () => {
  it("hits only on an exact (engine, nodes, multipv) match", () => {
    const { cache } = fresh();
    cache.put(KEY, VALUE);
    assert.deepEqual(cache.get(KEY), { ...VALUE, source: "engine", tier: "memory" });
    assert.equal(cache.get({ ...KEY, nodes: 80_000 }), null, "another node budget");
    assert.equal(cache.get({ ...KEY, multipv: 3 }), null, "another MultiPV");
    assert.equal(cache.get({ ...KEY, engine: "sf18-local" }), null, "another engine build");
    assert.equal(cache.get({ ...KEY, epd: EPD.replace(" b ", " w ") }), null, "another side to move");
    cache.close();
  });

  it("answers from SQLite after the LRU evicted the entry, and from a reopened file", () => {
    const { cache, metrics, path } = fresh({ lruMax: 2 });
    cache.put(KEY, VALUE);
    cache.put({ ...KEY, epd: "a" }, VALUE);
    cache.put({ ...KEY, epd: "b" }, VALUE); // evicts KEY from E1
    cache.flush();
    const hit = cache.get(KEY);
    assert.equal(hit?.tier, "disk");
    assert.equal(metrics.cacheHitsDisk, 1);
    assert.equal(cache.get(KEY)?.tier, "memory", "promoted back into the LRU");
    cache.close();
    const again = EvalCache.open({ path, log: silentLogger, metrics, nowMs: () => 0 });
    assert.deepEqual(again.get(KEY), { ...VALUE, source: "engine", tier: "disk" });
    again.close();
  });

  it("writes in batches of 64 and on flush()", () => {
    const { cache, path } = fresh();
    const count = () => {
      const db = new Database(path, { readonly: true });
      const n = db.prepare("SELECT count(*) FROM evals").pluck().get() as number;
      db.close();
      return n;
    };
    for (let i = 0; i < 63; i++) cache.put({ ...KEY, epd: `p${i}` }, VALUE);
    assert.equal(count(), 0, "buffered");
    cache.put({ ...KEY, epd: "p63" }, VALUE);
    assert.equal(count(), 64, "the 64th put flushed the batch");
    cache.put({ ...KEY, epd: "p64" }, VALUE);
    assert.equal(cache.flush(), 1);
    assert.equal(count(), 65);
    cache.close();
  });

  it("keeps `second` = 32767 (no second move) and null lines", () => {
    const { cache } = fresh({ lruMax: 1 });
    cache.put(KEY, { eval: 0, second: NO_SECOND, best: "e7e5", depth: 1, lines: null });
    cache.put({ ...KEY, epd: "x" }, VALUE);
    cache.flush();
    const hit = cache.get(KEY);
    assert.equal(hit?.second, NO_SECOND);
    assert.equal(hit?.lines, null);
    cache.close();
  });

  it("uses a seed row only when allowed, at least as deep and wide, and never writes one", () => {
    const { cache, dir } = fresh();
    cache.mergeSeed(seedFile(dir, [{ epd: EPD, nodes: 2_500_000, multipv: 2, eval: 25, second: 20 }]));
    assert.equal(cache.get(KEY), null, "not without allowSeed");
    const hit = cache.get(KEY, { allowSeed: true });
    assert.equal(hit?.source, "lichess-db");
    assert.equal(hit?.eval, 25);
    assert.equal(cache.get({ ...KEY, multipv: 3 }, { allowSeed: true }), null, "the seed has 2 lines only");
    assert.equal(cache.get({ ...KEY, nodes: 5_000_000 }, { allowSeed: true }), null, "the seed is shallower");
    assert.throws(() => cache.put({ ...KEY, engine: SEED_ENGINE }, VALUE));
    cache.put(KEY, VALUE);
    assert.equal(cache.get(KEY, { allowSeed: true })?.source, "engine", "an exact engine row wins over the seed");
    cache.close();
  });

  it("bypass rules: repeated EPD, half-move ≥ 90, EVAL_CACHE=off; seed only before ply 20 from the initial position", () => {
    assert.equal(cacheEligible({ enabled: true, seenEarlier: false, halfmoveClock: 0 }), true);
    assert.equal(cacheEligible({ enabled: true, seenEarlier: true, halfmoveClock: 0 }), false);
    assert.equal(cacheEligible({ enabled: true, seenEarlier: false, halfmoveClock: HALFMOVE_BYPASS - 1 }), true);
    assert.equal(cacheEligible({ enabled: true, seenEarlier: false, halfmoveClock: HALFMOVE_BYPASS }), false);
    assert.equal(cacheEligible({ enabled: false, seenEarlier: false, halfmoveClock: 0 }), false);
    assert.equal(seedAllowed({ fromInitialPosition: true, ply: 19 }), true);
    assert.equal(seedAllowed({ fromInitialPosition: true, ply: 20 }), false);
    assert.equal(seedAllowed({ fromInitialPosition: false, ply: 3 }), false);
  });
});

describe("eval cache: maintenance", () => {
  it("refreshes used_at on a disk hit and trims the least recently used rows", () => {
    let now = 1_000_000_000_000;
    const { cache, path } = fresh({ lruMax: 10, now: () => now });
    for (let i = 0; i < 2000; i++) cache.put({ ...KEY, epd: `old${i}` }, VALUE);
    cache.flush();
    now += 86_400_000;
    for (let i = 0; i < 2000; i++) cache.put({ ...KEY, epd: `new${i}` }, VALUE);
    cache.flush();
    now += 86_400_000;
    assert.equal(cache.get({ ...KEY, epd: "old7" })?.tier, "disk");
    cache.flush(); // writes the used_at refresh
    const before = cache.sizeBytes();
    const result = cache.trimTo(Math.floor(before / 2));
    assert.ok(result.deleted > 0);
    assert.ok(result.sizeBytes <= Math.floor(before / 2), `${result.sizeBytes} ≤ ${Math.floor(before / 2)}`);
    const db = new Database(path, { readonly: true });
    const has = (epd: string) => db.prepare("SELECT 1 FROM evals WHERE epd = ?").get(epd) !== undefined;
    assert.equal(has("old7"), true, "recently used survives");
    assert.equal(has("old8"), false, "least recently used goes first");
    assert.equal(has("new1999"), true);
    db.close();
    cache.close();
  });

  it("refuses a seed file of another format or without a name", () => {
    const { cache, dir } = fresh();
    const bad = join(dir, "bad.sqlite");
    const db = new Database(bad);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('format', '0');");
    db.close();
    assert.throws(() => cache.mergeSeed(bad), /format/);
    assert.throws(() => cache.mergeSeed(join(dir, "missing.sqlite")), /missing/);
    cache.close();
  });

  it("refuses to open a file of another cache format", () => {
    const dir = mkdtempSync(join(tmpdir(), "wk-cache-"));
    const path = join(dir, "evals.sqlite");
    const db = new Database(path);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID; INSERT INTO meta VALUES ('format', '9');");
    db.close();
    const metrics = new Metrics({ workerId: "t", bootId: "00000000", version: "0", profile: "sf18-v1" }, 0);
    assert.throws(() => EvalCache.open({ path, log: silentLogger, metrics, nowMs: () => 0 }), /format 9/);
  });

  it("first boot downloads and merges the seed once; later boots skip; a failed download is not fatal", async () => {
    const { cache, dir } = fresh();
    const file = seedFile(dir, [
      { epd: EPD, nodes: 300_000, multipv: 2, eval: 25, second: 20 },
      { epd: "other", nodes: 300_000, multipv: 1, eval: 5, second: NO_SECOND },
    ]);
    const bytes = readFileSync(file);
    let requests = 0;
    const server = createServer((req, res) => {
      requests++;
      if (req.url === "/evalcache/evalcache-seed-v1.sqlite") {
        res.writeHead(200, { "content-type": "application/vnd.sqlite3" });
        res.end(bytes);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.deepEqual(await ensureSeed({ cache, url: `${base}/missing`, log: silentLogger }), { status: "failed" });
      assert.equal(existsSync(`${cache.path}.seed-download`), false, "the partial download is removed");
      const merged = await ensureSeed({ cache, url: `${base}/evalcache/evalcache-seed-v1.sqlite`, log: silentLogger });
      assert.deepEqual(merged, { status: "merged", name: SEED_NAME, inserted: 2 });
      assert.equal(cache.get(KEY, { allowSeed: true })?.eval, 25);
      assert.deepEqual(await ensureSeed({ cache, url: `${base}/evalcache/evalcache-seed-v1.sqlite`, log: silentLogger }), {
        status: "present",
        name: SEED_NAME,
      });
      assert.equal(requests, 2, "the third call never downloads");
    } finally {
      server.close();
      cache.close();
    }
  });
});
