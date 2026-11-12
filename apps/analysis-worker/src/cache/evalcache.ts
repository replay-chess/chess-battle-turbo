// The eval cache (phase-03 plan P3-D10, §8.12 step 5, task C4): E1 = an in-process LRU (200k entries), E2 = SQLite on
// the worker's volume (`EVAL_CACHE_PATH`), seeded offline from the Lichess CC0 eval DB for opening positions.
//
// Determinism rules (TST X13), applied by the caller through `cacheEligible()` / `seedAllowed()`:
// - a hit counts only when `engine`, `nodes` and `multipv` match the request exactly;
// - or for a `lichess-db` seed row (at least as many nodes and lines) at ply < 20 of a game from the initial position;
// - the cache is bypassed when the EPD occurred earlier in the same game (repetition), when the half-move clock is
//   ≥ 90 (the 50-move rule), and entirely with EVAL_CACHE=off (goldens, §12.4).
//
// Writes are buffered and flushed in one SQLite transaction (every 64 puts, and at checkpoints / job end via
// flush()); a disk hit's `used_at` is refreshed in the same flush. The weekly HOUSEKEEPING slice trims the file to
// EVAL_CACHE_MAX_GB by `used_at` (trimTo()).
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LRUCache } from "lru-cache";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";
import { applySchema, CACHE_FORMAT, SEED_ENGINE, UPSERT_SQL, type EvalRow } from "./schema";

export const LRU_MAX_ENTRIES = 200_000;
export const FLUSH_EVERY = 64;
/** Seed rows are trusted only this early in a game that started from the initial position (§8.12). */
export const SEED_MAX_PLY = 20;
/** At or above this half-move clock the 50-move rule can change the eval: bypass (ARCH §1.9.3). */
export const HALFMOVE_BYPASS = 90;

export interface EvalKey {
  epd: string;
  /** The engine build id ("sf18-armv8dp-c288c895", "fake"); never the seed's. */
  engine: string;
  nodes: number;
  multipv: number;
}

export interface CachedLine {
  /** Stored eval (White POV). */
  eval: number;
  pv: string[];
}

export interface CachedEval {
  /** Stored eval of line 1 (White POV). */
  eval: number;
  /** MultiPV-2 score (White POV), or 32767 when the position has no second legal move. */
  second: number;
  best: string | null;
  depth: number;
  lines: CachedLine[] | null;
}

export interface CacheHit extends CachedEval {
  source: "engine" | "lichess-db";
  tier: "memory" | "disk";
}

/** May this position use the cache at all? */
export function cacheEligible(p: { enabled: boolean; seenEarlier: boolean; halfmoveClock: number }): boolean {
  return p.enabled && !p.seenEarlier && p.halfmoveClock < HALFMOVE_BYPASS;
}

/** May a `lichess-db` seed row answer for this ply? */
export function seedAllowed(p: { fromInitialPosition: boolean; ply: number }): boolean {
  return p.fromInitialPosition && p.ply < SEED_MAX_PLY;
}

function encodeLines(lines: readonly CachedLine[] | null): string | null {
  return lines ? JSON.stringify(lines.map((l) => [l.eval, l.pv.join(" ")])) : null;
}

function decodeLines(text: string | null): CachedLine[] | null {
  if (!text) return null;
  const raw = JSON.parse(text) as [number, string][];
  return raw.map(([e, pv]) => ({ eval: e, pv: pv ? pv.split(" ") : [] }));
}

const keyOf = (k: EvalKey) => `${k.engine}|${k.nodes}|${k.multipv}|${k.epd}`;
const seedKeyOf = (k: EvalKey) => `${SEED_ENGINE}>=${k.nodes}|${k.multipv}|${k.epd}`;

export interface EvalCacheOptions {
  path: string;
  log: Logger;
  metrics: Metrics;
  nowMs: () => number;
  lruMax?: number;
  flushEvery?: number;
}

export class EvalCache {
  private readonly db: Database.Database;
  private readonly lru: LRUCache<string, CachedEval & { source: CacheHit["source"] }>;
  private readonly pending = new Map<string, EvalRow>();
  private readonly touched = new Map<string, Pick<EvalRow, "epd" | "engine" | "nodes" | "multipv">>();
  private readonly flushEvery: number;
  private readonly stmts: {
    get: Database.Statement;
    seed: Database.Statement;
    upsert: Database.Statement;
    touch: Database.Statement;
  };
  private closed = false;

  private constructor(
    private readonly opts: EvalCacheOptions,
    db: Database.Database,
  ) {
    this.db = db;
    this.lru = new LRUCache({ max: opts.lruMax ?? LRU_MAX_ENTRIES });
    this.flushEvery = opts.flushEvery ?? FLUSH_EVERY;
    this.stmts = {
      get: db.prepare(
        "SELECT eval, second, best, depth, lines FROM evals WHERE epd = ? AND engine = ? AND nodes = ? AND multipv = ?",
      ),
      seed: db.prepare(
        `SELECT eval, second, best, depth, lines, nodes, multipv FROM evals
          WHERE epd = ? AND engine = '${SEED_ENGINE}' AND nodes >= ? AND multipv >= ?
          ORDER BY nodes DESC LIMIT 1`,
      ),
      upsert: db.prepare(UPSERT_SQL),
      touch: db.prepare("UPDATE evals SET used_at = ? WHERE epd = ? AND engine = ? AND nodes = ? AND multipv = ?"),
    };
  }

  /** Opens (or creates) the cache file. Throws when the file is not an eval cache of this format. */
  static open(opts: EvalCacheOptions): EvalCache {
    mkdirSync(dirname(opts.path), { recursive: true });
    const db = new Database(opts.path);
    try {
      applySchema(db);
    } catch (error) {
      db.close();
      throw error;
    }
    return new EvalCache(opts, db);
  }

  get path(): string {
    return this.opts.path;
  }

  /** A cached search for exactly this key, or (with `allowSeed`) a seed row at least as deep. */
  get(key: EvalKey, options: { allowSeed?: boolean } = {}): CacheHit | null {
    const k = keyOf(key);
    const memory = this.lru.get(k);
    if (memory) {
      this.opts.metrics.cacheHitsMemory++;
      return { ...memory, tier: "memory" };
    }
    const row = this.stmts.get.get(key.epd, key.engine, key.nodes, key.multipv) as EvalRow | undefined;
    if (row) {
      const value = { ...this.fromRow(row), source: "engine" as const };
      this.lru.set(k, value);
      this.touched.set(k, { epd: key.epd, engine: key.engine, nodes: key.nodes, multipv: key.multipv });
      this.opts.metrics.cacheHitsDisk++;
      return { ...value, tier: "disk" };
    }
    if (options.allowSeed) {
      const sk = seedKeyOf(key);
      const seedMemory = this.lru.get(sk);
      if (seedMemory) {
        this.opts.metrics.cacheHitsMemory++;
        return { ...seedMemory, tier: "memory" };
      }
      const seed = this.stmts.seed.get(key.epd, key.nodes, key.multipv) as EvalRow | undefined;
      if (seed) {
        const value = { ...this.fromRow(seed), source: "lichess-db" as const };
        this.lru.set(sk, value);
        this.touched.set(sk, { epd: key.epd, engine: SEED_ENGINE, nodes: seed.nodes, multipv: seed.multipv });
        this.opts.metrics.cacheHitsDisk++;
        return { ...value, tier: "disk" };
      }
    }
    this.opts.metrics.cacheMisses++;
    return null;
  }

  put(key: EvalKey, value: CachedEval): void {
    if (key.engine === SEED_ENGINE) throw new Error("the worker never writes seed rows");
    const k = keyOf(key);
    this.lru.set(k, { ...value, source: "engine" });
    this.pending.set(k, {
      epd: key.epd,
      engine: key.engine,
      nodes: key.nodes,
      multipv: key.multipv,
      eval: value.eval,
      second: value.second,
      best: value.best,
      depth: value.depth,
      lines: encodeLines(value.lines),
      used_at: this.nowSec(),
    });
    if (this.pending.size >= this.flushEvery) this.flush();
  }

  /** Writes the buffered rows and `used_at` refreshes in one transaction. Returns the rows written. */
  flush(): number {
    if (this.closed || (this.pending.size === 0 && this.touched.size === 0)) return 0;
    const rows = [...this.pending.values()];
    const touched = [...this.touched.values()];
    const now = this.nowSec();
    this.db.transaction(() => {
      for (const row of rows) this.stmts.upsert.run(row);
      for (const t of touched) this.stmts.touch.run(now, t.epd, t.engine, t.nodes, t.multipv);
    })();
    this.pending.clear();
    this.touched.clear();
    return rows.length;
  }

  /** Bytes in use (pages minus the free list). */
  sizeBytes(): number {
    const pageSize = this.db.pragma("page_size", { simple: true }) as number;
    const pages = this.db.pragma("page_count", { simple: true }) as number;
    const free = this.db.pragma("freelist_count", { simple: true }) as number;
    return (pages - free) * pageSize;
  }

  rowCount(): number {
    return this.db.prepare("SELECT count(*) FROM evals").pluck().get() as number;
  }

  /** Deletes the least recently used rows until the file is ≤ maxBytes, then returns the freed pages. */
  trimTo(maxBytes: number): { deleted: number; sizeBytes: number } {
    this.flush();
    let deleted = 0;
    const del = this.db.prepare(
      `DELETE FROM evals WHERE (epd, engine, nodes, multipv) IN
         (SELECT epd, engine, nodes, multipv FROM evals ORDER BY used_at LIMIT ?)`,
    );
    for (let guard = 0; guard < 1000 && this.sizeBytes() > maxBytes; guard++) {
      const rows = this.rowCount();
      if (rows === 0) break;
      deleted += del.run(Math.max(1, Math.ceil(rows / 10))).changes;
    }
    this.db.pragma("incremental_vacuum");
    if (deleted > 0) this.lru.clear();
    this.opts.log.info("eval cache trimmed", { deleted, sizeBytes: this.sizeBytes() });
    return { deleted, sizeBytes: this.sizeBytes() };
  }

  meta(key: string): string | null {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").pluck().get(key) as string | undefined) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  /**
   * Merges a seed file (built by scripts/seed-evalcache.ts) into this cache: only `lichess-db` rows, existing rows
   * win. Refuses a file that is not an eval cache of this format or has no `name`.
   */
  mergeSeed(seedPath: string): { name: string; inserted: number } {
    if (!existsSync(seedPath)) throw new Error("seed file missing");
    const check = new Database(seedPath, { readonly: true, fileMustExist: true });
    let name: string;
    try {
      const meta = (k: string) => check.prepare("SELECT value FROM meta WHERE key = ?").pluck().get(k) as string | undefined;
      const format = meta("format");
      if (format !== CACHE_FORMAT) throw new Error(`seed format ${String(format)} is not ${CACHE_FORMAT}`);
      const seedName = meta("name");
      if (!seedName || !/^[a-z0-9-]{1,64}$/.test(seedName)) throw new Error("seed file has no valid name");
      name = seedName;
    } finally {
      check.close();
    }
    this.flush();
    this.db.prepare("ATTACH DATABASE ? AS seed").run(seedPath);
    try {
      const inserted = this.db.transaction(() => {
        const info = this.db
          .prepare(
            `INSERT OR IGNORE INTO evals (epd, engine, nodes, multipv, eval, second, best, depth, lines, used_at)
             SELECT epd, engine, nodes, multipv, eval, second, best, depth, lines, ? FROM seed.evals
              WHERE engine = '${SEED_ENGINE}'`,
          )
          .run(this.nowSec());
        this.setMeta("seed", name);
        return info.changes;
      })();
      return { name, inserted };
    } finally {
      this.db.prepare("DETACH DATABASE seed").run();
    }
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.db.close();
  }

  private fromRow(row: Pick<EvalRow, "eval" | "second" | "best" | "depth" | "lines">): CachedEval {
    return { eval: row.eval, second: row.second, best: row.best, depth: row.depth, lines: decodeLines(row.lines) };
  }

  private nowSec(): number {
    return Math.floor(this.opts.nowMs() / 1000);
  }
}
