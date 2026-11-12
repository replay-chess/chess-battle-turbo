// The eval cache's SQLite schema (phase-03 plan P3-D10, §8.12 step 5), shared by the worker's cache (E2) and the
// offline seed builder (scripts/seed-evalcache.ts) so a seed file can be ATTACHed and merged as is.
//
// One row per (EPD, engine, nodes, MultiPV). Scores are stored like `game_analyses.evals` (CA/src/codec.ts): White
// POV, cp clamped ±9999, mate in n = sign·(30000 − n); `second` = the MultiPV-2 score or 32767 (no second move).
// `lines` is JSON `[[eval, "uci uci …"], …]` per MultiPV line (pass 2 needs the PVs). `used_at` (epoch seconds)
// drives the weekly trim to EVAL_CACHE_MAX_GB.
import type Database from "better-sqlite3";

/** Bumped when the table layout changes; a seed file of another format is refused. */
export const CACHE_FORMAT = "1";
/** `engine` of the rows seeded from the Lichess CC0 eval DB. */
export const SEED_ENGINE = "lichess-db";
/** The seed file's name (meta `name`), its R2 key and the default file name. */
export const SEED_NAME = "evalcache-seed-v1";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS evals (
  epd     TEXT    NOT NULL,
  engine  TEXT    NOT NULL,
  nodes   INTEGER NOT NULL,
  multipv INTEGER NOT NULL,
  eval    INTEGER NOT NULL,
  second  INTEGER NOT NULL,
  best    TEXT,
  depth   INTEGER NOT NULL,
  lines   TEXT,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (epd, engine, nodes, multipv)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS evals_used_at ON evals (used_at);
`;

/** Opens/creates the schema. A new file gets incremental auto-vacuum so the trim can give pages back. */
export function applySchema(db: Database.Database): void {
  const fresh = (db.pragma("page_count", { simple: true }) as number) === 0;
  if (fresh) db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA_SQL);
  const format = db.prepare("SELECT value FROM meta WHERE key = 'format'").pluck().get() as string | undefined;
  if (format === undefined) db.prepare("INSERT INTO meta (key, value) VALUES ('format', ?)").run(CACHE_FORMAT);
  else if (format !== CACHE_FORMAT) throw new Error(`eval cache format ${format} is not ${CACHE_FORMAT}`);
}

export interface EvalRow {
  epd: string;
  engine: string;
  nodes: number;
  multipv: number;
  eval: number;
  second: number;
  best: string | null;
  depth: number;
  lines: string | null;
  used_at: number;
}

export const UPSERT_SQL = `INSERT OR REPLACE INTO evals (epd, engine, nodes, multipv, eval, second, best, depth, lines, used_at)
VALUES (@epd, @engine, @nodes, @multipv, @eval, @second, @best, @depth, @lines, @used_at)`;
