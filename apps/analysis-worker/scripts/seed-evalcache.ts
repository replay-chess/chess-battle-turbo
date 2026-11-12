// Builds the eval-cache seed (phase-03 plan §7.8, P3-D10, task C4) on the owner's laptop, once:
//
//   tsx scripts/seed-evalcache.ts --input lichess_db_eval.jsonl.zst --out evalcache-seed-v1.sqlite
//                                 [--openings <dir of *.tsv>] [--min-knodes 120] [--limit-lines N] [--force]
//
// Input: the Lichess CC0 eval dump (https://database.lichess.org/#evals), one JSON object per line:
//   {"fen":"<board side castling ep>","evals":[{"pvs":[{"cp":31,"line":"e2e4 e7e5 …"},{"mate":-3,"line":"…"}],
//    "knodes":12345,"depth":40}, …]}
// scores are White POV. `.zst` is decompressed with node:zlib, `-` reads stdin (e.g. `zstd -dc … | … --input -`).
//
// Kept: positions on the `openings` lines (apps/web/public/openings/*.tsv, the same Lichess CC0 dataset the DB seed
// loads) plus the initial position, with an evaluation of ≥ 120 knodes. Per position the deepest evaluation with at
// least two lines is kept (one line if that is all there is). Rows are written in the worker's cache schema with
// engine `lichess-db`, nodes = knodes × 1000 and multipv = the number of lines, so the worker merges the file as is
// (EvalCache.mergeSeed) and uses a row only at ply < 20 of games from the initial position (§8.12).
//
// FENs are compared as EPDs normalised by chess.js (the worker's own convention, CA/src/board.ts epdOf), so an
// en-passant field the two sources write differently cannot cause a miss. A cheap board+side prefilter keeps the
// full dump (hundreds of millions of lines) to one regex per line.
import { createReadStream, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createZstdDecompress } from "node:zlib";
import Database from "better-sqlite3";
import { Chess } from "chess.js";
import { epdOf, INITIAL_FEN } from "@repo/chess-analysis/board";
import { parseOpeningsTsv, replayOpening } from "@repo/chess-analysis/book";
import { encodeCp, encodeMate, NO_SECOND } from "@repo/chess-analysis/codec";
import { applySchema, SEED_ENGINE, SEED_NAME, UPSERT_SQL, type EvalRow } from "../src/cache/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OPENINGS_DIR = resolve(HERE, "../../web/public/openings");
export const DEFAULT_MIN_KNODES = 120;
const MAX_LINES_KEPT = 5;
const FEN_PREFIX = /^\{"fen":"([^"]+)"/;

export interface SeedArgs {
  input: string;
  out: string;
  openings: string;
  minKnodes: number;
  limitLines: number | null;
  force: boolean;
}

export function parseArgs(argv: readonly string[]): SeedArgs {
  const args: Partial<SeedArgs> = { openings: DEFAULT_OPENINGS_DIR, minKnodes: DEFAULT_MIN_KNODES, limitLines: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--input") args.input = value();
    else if (a === "--out") args.out = value();
    else if (a === "--openings") args.openings = value();
    else if (a === "--min-knodes") args.minKnodes = Number(value());
    else if (a === "--limit-lines") args.limitLines = Number(value());
    else if (a === "--force") args.force = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.input || !args.out) throw new Error("usage: --input <lichess_db_eval.jsonl[.zst]|-> --out <file.sqlite>");
  if (!Number.isInteger(args.minKnodes) || args.minKnodes! < 1) throw new Error("--min-knodes must be a positive integer");
  return args as SeedArgs;
}

/** EPDs along every opening line, plus the initial position. */
export function openingEpds(dir: string): Set<string> {
  const epds = new Set<string>([epdOf(INITIAL_FEN)]);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsv")).sort()) {
    for (const line of parseOpeningsTsv(readFileSync(join(dir, file), "utf8"))) {
      for (const epd of replayOpening(line.pgn).epds) epds.add(epd);
    }
  }
  return epds;
}

/** The chess.js-normalised EPD of a Lichess FEN (4 fields), or null when chess.js refuses it. */
export function normaliseEpd(fen: string): string | null {
  try {
    return epdOf(new Chess(`${fen.trim().split(/\s+/).slice(0, 4).join(" ")} 0 1`).fen());
  } catch {
    return null;
  }
}

interface LichessPv {
  cp?: number;
  mate?: number;
  line?: string;
}
interface LichessEval {
  pvs?: LichessPv[];
  knodes?: number;
  depth?: number;
}

function encodePv(pv: LichessPv): number | null {
  if (typeof pv.cp === "number" && Number.isFinite(pv.cp)) return encodeCp(pv.cp);
  if (typeof pv.mate === "number" && Number.isInteger(pv.mate) && pv.mate !== 0) {
    try {
      return encodeMate(pv.mate > 0 ? "w" : "b", Math.abs(pv.mate));
    } catch {
      return null;
    }
  }
  return null;
}

/** The row for one dump entry, or null when no evaluation qualifies. */
export function rowFor(epd: string, evals: readonly LichessEval[], minKnodes: number): EvalRow | null {
  const usable = evals
    .filter((e) => Number.isFinite(e.knodes) && (e.knodes ?? 0) >= minKnodes && Array.isArray(e.pvs) && e.pvs.length > 0)
    .sort((a, b) => Number((b.pvs?.length ?? 0) >= 2) - Number((a.pvs?.length ?? 0) >= 2) || (b.knodes ?? 0) - (a.knodes ?? 0));
  for (const e of usable) {
    const pvs = e.pvs!.slice(0, MAX_LINES_KEPT);
    const scores = pvs.map(encodePv);
    if (scores.some((s) => s === null)) continue;
    const lines = pvs.map((p, i) => [scores[i]!, (p.line ?? "").trim()] as const);
    const best = lines[0]![1].split(" ")[0] || null;
    return {
      epd,
      engine: SEED_ENGINE,
      nodes: Math.round(e.knodes! * 1000),
      multipv: pvs.length,
      eval: scores[0]!,
      // Meaningful only with multipv ≥ 2 (the worker matches a seed row only when it has the lines it asks for).
      second: scores[1] ?? NO_SECOND,
      best,
      depth: Math.max(0, Math.round(e.depth ?? 0)),
      lines: JSON.stringify(lines),
      used_at: 0,
    };
  }
  return null;
}

function openInput(path: string): NodeJS.ReadableStream {
  if (path === "-") return process.stdin;
  const file = createReadStream(path);
  return path.endsWith(".zst") ? file.pipe(createZstdDecompress()) : file;
}

export interface SeedReport {
  linesRead: number;
  candidates: number;
  written: number;
  targetEpds: number;
}

export async function buildSeed(args: SeedArgs, log: (msg: string) => void = (m) => process.stderr.write(`${m}\n`)): Promise<SeedReport> {
  if (existsSync(args.out)) {
    if (!args.force) throw new Error(`${args.out} exists (pass --force to replace it)`);
    rmSync(args.out);
  }
  const targets = openingEpds(args.openings);
  const prefixes = new Set([...targets].map((e) => e.split(" ").slice(0, 2).join(" ")));
  log(`seed: ${targets.size} target EPDs from ${args.openings}`);

  const db = new Database(args.out);
  applySchema(db);
  const upsert = db.prepare(UPSERT_SQL);
  const pending: EvalRow[] = [];
  const flush = db.transaction((rows: EvalRow[]) => {
    for (const r of rows) upsert.run(r);
  });

  const report: SeedReport = { linesRead: 0, candidates: 0, written: 0, targetEpds: targets.size };
  const rl = createInterface({ input: openInput(args.input), crlfDelay: Infinity });
  for await (const line of rl) {
    report.linesRead++;
    if (args.limitLines !== null && report.linesRead > args.limitLines) break;
    if (report.linesRead % 10_000_000 === 0) log(`seed: ${report.linesRead} lines, ${report.written} rows`);
    const m = FEN_PREFIX.exec(line);
    if (!m) continue;
    const fen = m[1]!;
    if (!prefixes.has(fen.split(" ").slice(0, 2).join(" "))) continue;
    const epd = normaliseEpd(fen);
    if (!epd || !targets.has(epd)) continue;
    report.candidates++;
    let entry: { evals?: LichessEval[] };
    try {
      entry = JSON.parse(line) as { evals?: LichessEval[] };
    } catch {
      continue;
    }
    const row = rowFor(epd, entry.evals ?? [], args.minKnodes);
    if (!row) continue;
    pending.push(row);
    report.written++;
    if (pending.length >= 1_000) flush(pending.splice(0));
  }
  flush(pending.splice(0));
  const meta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  meta.run("name", SEED_NAME);
  meta.run("source", "lichess_db_eval.jsonl (Lichess, CC0)");
  meta.run("built_at", new Date().toISOString());
  meta.run("min_knodes", String(args.minKnodes));
  meta.run("rows", String(db.prepare("SELECT count(*) FROM evals").pluck().get()));
  db.exec("VACUUM");
  db.close();
  log(`seed: wrote ${report.written} rows (${report.candidates} candidates, ${report.linesRead} lines read) to ${args.out}`);
  return report;
}

const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  buildSeed(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`seed-evalcache failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
