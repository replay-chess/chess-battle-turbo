/**
 * Builds the puzzle shards from the CC0 Lichess puzzle dump (phase-05 plan §8.13; README.md next to this file has the
 * exact commands). Runs on a laptop, never in CI; the output goes OUTSIDE the repository (only the manifest and the
 * CI subset are committed).
 *
 *   zstd -dc lichess_db_puzzle.csv.zst | npx tsx scripts/puzzles/build-shards.ts build --out <dir> --source <YYYY-MM-DD>
 *       [--version v1] [--k 250] [--built <YYYY-MM-DD>] [--manifest-copy <path>]
 *     → <dir>/<version>/<theme>/<band>.json and <dir>/<version>/manifest.json
 *   npx tsx scripts/puzzles/build-shards.ts verify --dir <dir>/<version> [--manifest <path>] [--no-replay]
 *     → every file the manifest lists exists with that count, no file it does not list, every line legal
 *   npx tsx scripts/puzzles/build-shards.ts subset --from <dir>/<version> --out <fixtures>/<version>
 *       --themes fork,pin,… --bands 12,13,14,15,16,17,18 --per-shard 60
 *     → the CI shard-server subset (packages/chess-fixtures/puzzles/shards/v1) with its own manifest
 *
 * Filter: Popularity ≥ 80, NbPlays ≥ 300, RatingDeviation ≤ 90, 600 ≤ Rating ≤ 2599, ≤ 15 UCI tokens. Buckets: every
 * SHARD_THEMES key plus `mix` × every band floor(rating / 100) = 6 … 25; the top K by Popularity × ln(NbPlays) (ties
 * by id), each line replayed with chess.js (an illegal one is dropped and the next one moves up). Files are rating
 * ascending. Tuple: `[id, fen, moves, rating, themesMask]`, the mask a JSON number over the manifest's `bits`.
 */
import { MIX_THEME, PUZZLE_BAND_MAX, PUZZLE_BAND_MIN } from "@repo/chess-training/constants";
import { PICKER_THEMES, shardBitsTable } from "@repo/chess-training/themes";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bandOf,
  checkShard,
  manifestPath,
  manifestShards,
  maskOf,
  MAX_MOVE_TOKENS,
  PuzzleManifestSchema,
  replayPuzzle,
  SHARD_FORMAT,
  ShardFileSchema,
  shardPath,
  type PuzzleManifest,
  type ShardFile,
  type ShardTuple,
} from "../../lib/train/puzzle-shards";

/**
 * The shard themes: the picker (plan §8.11, `PICKER_THEMES`: Forks, Pins, Loose pieces, Back rank, Mate in 2,
 * Discovered attack, then More Themes) followed by the Tier-1 tactic and endgame keys a bank card can carry as its
 * primary theme. 30 + `mix`.
 */
export const SHARD_THEMES: readonly string[] = [
  ...PICKER_THEMES,
  "mate",
  "smotheredMate",
  "doubleCheck",
  "exposedKing",
  "kingsideAttack",
  "queensideAttack",
  "promotion",
  "advancedPawn",
  "quietMove",
  "knightEndgame",
  "bishopEndgame",
  "queenEndgame",
  "queenRookEndgame",
];

/**
 * Theme ↔ bit table of the mask: `@repo/chess-training/themes` SHARD_THEME_BITS (WP-B's append-only taxonomy, ≤ 53
 * bits so the mask is an exact JSON number), copied into the manifest. Tags without a bit (the player-level meta tags
 * and the rarest named mates) are reported by `build` and left out of the mask.
 */
export const BITS: Readonly<Record<string, number>> = shardBitsTable();

export const FILTER = {
  popularityMin: 80,
  nbPlaysMin: 300,
  ratingDeviationMax: 90,
  ratingMin: PUZZLE_BAND_MIN * 100,
  ratingMax: PUZZLE_BAND_MAX * 100 + 99,
  movesMax: MAX_MOVE_TOKENS,
} as const;

export const DEFAULT_K = 250;
/** Extra rows kept per bucket so an illegal line can be replaced without a second pass over the dump. */
const SPARE = 16;
const HEADER = ["PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity", "NbPlays", "Themes"] as const;

export type Row = { id: string; fen: string; moves: string; rating: number; themes: string[]; score: number };

/** Column indexes of the header (extra trailing columns such as GameUrl, OpeningTags, DailyDate are ignored). */
export function headerIndex(line: string): Record<(typeof HEADER)[number], number> {
  const cols = line.trim().split(",");
  const idx = {} as Record<(typeof HEADER)[number], number>;
  for (const name of HEADER) {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`the dump header has no ${name} column: ${line.slice(0, 200)}`);
    idx[name] = i;
  }
  return idx;
}

/** One CSV line → a row that passes the filter, or null. The Lichess CSV has no quoted commas. */
export function parseRow(line: string, idx: Record<(typeof HEADER)[number], number>): Row | null {
  const c = line.split(",");
  const id = c[idx.PuzzleId] ?? "";
  const fen = c[idx.FEN] ?? "";
  const moves = (c[idx.Moves] ?? "").trim();
  const rating = Number(c[idx.Rating]);
  const rd = Number(c[idx.RatingDeviation]);
  const popularity = Number(c[idx.Popularity]);
  const plays = Number(c[idx.NbPlays]);
  if (!/^[A-Za-z0-9]{5,8}$/.test(id) || !fen) return null;
  if (!(popularity >= FILTER.popularityMin && plays >= FILTER.nbPlaysMin && rd <= FILTER.ratingDeviationMax)) return null;
  if (!(Number.isInteger(rating) && rating >= FILTER.ratingMin && rating <= FILTER.ratingMax)) return null;
  const tokens = moves.split(" ");
  if (tokens.length < 2 || tokens.length > FILTER.movesMax) return null;
  const themes = (c[idx.Themes] ?? "").trim().split(" ").filter(Boolean);
  return { id, fen, moves, rating, themes, score: popularity * Math.log(plays) };
}

/** Higher score first, then the smaller id (deterministic). */
export function better(a: Row, b: Row): boolean {
  return a.score !== b.score ? a.score > b.score : a.id < b.id;
}

/** Bounded min-heap keeping the best `cap` rows. */
export class TopK {
  private readonly heap: Row[] = [];
  constructor(private readonly cap: number) {}

  push(row: Row): void {
    const h = this.heap;
    if (h.length < this.cap) {
      h.push(row);
      this.up(h.length - 1);
    } else if (better(row, h[0] as Row)) {
      h[0] = row;
      this.down(0);
    }
  }

  /** Best first. */
  sorted(): Row[] {
    return this.heap.slice().sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  }

  get size(): number {
    return this.heap.length;
  }

  private up(i: number): void {
    const h = this.heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!better(h[p] as Row, h[i] as Row)) break;
      [h[p], h[i]] = [h[i] as Row, h[p] as Row];
      i = p;
    }
  }

  private down(i: number): void {
    const h = this.heap;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && better(h[m] as Row, h[l] as Row)) m = l;
      if (r < h.length && better(h[m] as Row, h[r] as Row)) m = r;
      if (m === i) return;
      [h[m], h[i]] = [h[i] as Row, h[m] as Row];
      i = m;
    }
  }
}

export type BuildStats = { lines: number; kept: number; illegal: string[]; unknownTags: Map<string, number> };

/** Streams the CSV lines into the buckets. */
export async function collect(lines: AsyncIterable<string>, k: number): Promise<{ buckets: Map<string, TopK>; stats: BuildStats }> {
  const noBit = SHARD_THEMES.filter((t) => !(t in BITS));
  if (noBit.length) throw new Error(`shard themes without a bit in @repo/chess-training/themes: ${noBit.join(", ")}`);
  const buckets = new Map<string, TopK>();
  const stats: BuildStats = { lines: 0, kept: 0, illegal: [], unknownTags: new Map() };
  const shardSet = new Set<string>(SHARD_THEMES);
  let idx: ReturnType<typeof headerIndex> | null = null;
  const add = (theme: string, band: number, row: Row) => {
    const key = `${theme}/${band}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = new TopK(k + SPARE)));
    b.push(row);
  };
  for await (const line of lines) {
    if (!line) continue;
    if (!idx) {
      idx = headerIndex(line);
      continue;
    }
    stats.lines += 1;
    const row = parseRow(line, idx);
    if (!row) continue;
    stats.kept += 1;
    const band = bandOf(row.rating);
    add(MIX_THEME, band, row);
    for (const t of row.themes) {
      if (shardSet.has(t)) add(t, band, row);
      if (!(t in BITS)) stats.unknownTags.set(t, (stats.unknownTags.get(t) ?? 0) + 1);
    }
  }
  if (!idx) throw new Error("empty input: pipe the decompressed dump into this script");
  return { buckets, stats };
}

/** Top K legal rows per bucket → shard files (rating ascending) and the manifest. */
export function finish(
  buckets: Map<string, TopK>,
  options: { version: string; k: number; built: string; source: string },
  stats: BuildStats,
): { files: ShardFile[]; manifest: PuzzleManifest } {
  const legal = new Map<string, boolean>();
  const files: ShardFile[] = [];
  const themes: Record<string, Record<string, number>> = {};
  const unique = new Set<string>();
  const order = [...SHARD_THEMES, MIX_THEME];
  for (const theme of order) {
    for (let band = PUZZLE_BAND_MIN; band <= PUZZLE_BAND_MAX; band++) {
      const bucket = buckets.get(`${theme}/${band}`);
      if (!bucket) continue;
      const rows: Row[] = [];
      for (const row of bucket.sorted()) {
        if (rows.length === options.k) break;
        let ok = legal.get(row.id);
        if (ok === undefined) {
          ok = replayPuzzle(row.fen, row.moves).ok;
          legal.set(row.id, ok);
          if (!ok) stats.illegal.push(row.id);
        }
        if (ok) rows.push(row);
      }
      if (!rows.length) continue;
      rows.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));
      const p: ShardTuple[] = rows.map((r) => [r.id, r.fen, r.moves, r.rating, maskOf(r.themes, BITS)]);
      for (const r of rows) unique.add(r.id);
      files.push({ v: SHARD_FORMAT, version: options.version, theme, band, p });
      (themes[theme] ??= {})[String(band)] = p.length;
    }
  }
  const manifest = PuzzleManifestSchema.parse({
    version: options.version,
    format: SHARD_FORMAT,
    built: options.built,
    source: options.source,
    license: "CC0 1.0 (Lichess puzzle database, https://database.lichess.org/#puzzles)",
    k: options.k,
    filter: FILTER,
    themes,
    bits: BITS,
    files: files.length,
    puzzles: files.reduce((n, f) => n + f.p.length, 0),
    unique: unique.size,
  });
  return { files, manifest };
}

/** Shard JSON: one tuple per line, so a diff of the committed subset stays readable. */
export function serialiseShard(file: ShardFile): string {
  const head = JSON.stringify({ v: file.v, version: file.version, theme: file.theme, band: file.band }).slice(0, -1);
  return `${head},"p":[\n${file.p.map((t) => JSON.stringify(t)).join(",\n")}\n]}\n`;
}

/** Pretty JSON with one line per theme's band counts (≈ 10 KB for 31 themes × 20 bands). */
export function serialiseManifest(manifest: PuzzleManifest): string {
  const inline = (o: unknown) => JSON.stringify(o).replace(/":/g, '": ').replace(/,"/g, ', "');
  const themes = Object.entries(manifest.themes).map(([t, bands]) => `    ${JSON.stringify(t)}: ${inline(bands)}`);
  const pretty = JSON.stringify({ ...manifest, themes: "__THEMES__", bits: "__BITS__" }, null, 2);
  return `${pretty
    .replace('"__THEMES__"', `{\n${themes.join(",\n")}\n  }`)
    .replace('"__BITS__"', inline(manifest.bits))}\n`;
}

export function writeBuild(outRoot: string, files: ShardFile[], manifest: PuzzleManifest): void {
  for (const file of files) {
    const target = path.join(outRoot, shardPath(file.version, file.theme, file.band));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, serialiseShard(file));
  }
  const target = path.join(outRoot, manifestPath(manifest.version));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, serialiseManifest(manifest));
}

export function readManifest(file: string): PuzzleManifest {
  return PuzzleManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function readShard(file: string): ShardFile {
  return ShardFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Every error of a version directory (`<root>/<version>`) against its manifest. Empty = valid. */
export function verifyDir(versionDir: string, options: { replay: boolean; manifest?: PuzzleManifest } = { replay: true }): string[] {
  const manifest = options.manifest ?? readManifest(path.join(versionDir, "manifest.json"));
  const version = path.basename(versionDir);
  const errors: string[] = [];
  if (manifest.version !== version) errors.push(`manifest version ${manifest.version} ≠ directory ${version}`);
  const listed = new Set<string>();
  const ids = new Set<string>();
  let puzzles = 0;
  for (const { theme, band } of manifestShards(manifest)) {
    const rel = `${theme}/${band}.json`;
    listed.add(rel);
    const file = path.join(versionDir, rel);
    if (!existsSync(file)) {
      errors.push(`${rel}: missing`);
      continue;
    }
    let shard: ShardFile;
    try {
      shard = readShard(file);
    } catch (e) {
      errors.push(`${rel}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    const check = checkShard(shard, { version: manifest.version, theme, band }, manifest, { replay: options.replay });
    if (!check.ok) errors.push(...check.errors);
    puzzles += shard.p.length;
    for (const t of shard.p) ids.add(t[0]);
  }
  for (const theme of existsSync(versionDir) ? readdirSync(versionDir) : []) {
    const dir = path.join(versionDir, theme);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (!listed.has(`${theme}/${f}`)) errors.push(`${theme}/${f}: not in the manifest`);
  }
  if (puzzles !== manifest.puzzles) errors.push(`files hold ${puzzles} puzzles, manifest says ${manifest.puzzles}`);
  if (ids.size !== manifest.unique) errors.push(`files hold ${ids.size} distinct ids, manifest says ${manifest.unique}`);
  return errors;
}

/** The CI subset of a full build: `perShard` puzzles of each shard, evenly spread over its (rating-ascending) list. */
export function subsetOf(
  fromDir: string,
  options: { themes: string[]; bands: number[]; perShard: number },
): { files: ShardFile[]; manifest: PuzzleManifest } {
  const full = readManifest(path.join(fromDir, "manifest.json"));
  const files: ShardFile[] = [];
  const themes: Record<string, Record<string, number>> = {};
  const unique = new Set<string>();
  for (const theme of options.themes) {
    for (const band of options.bands) {
      const n = full.themes[theme]?.[String(band)];
      if (!n) throw new Error(`${theme}/${band} is not in the full build`);
      const shard = readShard(path.join(fromDir, theme, `${band}.json`));
      const step = shard.p.length / Math.min(options.perShard, shard.p.length);
      const p = Array.from({ length: Math.min(options.perShard, shard.p.length) }, (_, i) => shard.p[Math.floor(i * step)] as ShardTuple);
      for (const t of p) unique.add(t[0]);
      files.push({ ...shard, p });
      (themes[theme] ??= {})[String(band)] = p.length;
    }
  }
  const manifest = PuzzleManifestSchema.parse({
    ...full,
    themes,
    files: files.length,
    puzzles: files.reduce((n, f) => n + f.p.length, 0),
    unique: unique.size,
  });
  return { files, manifest };
}

// ---------------------------------------------------------------------------
// CLI

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function need(argv: string[], name: string): string {
  const v = arg(argv, name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "build") {
    const out = path.resolve(need(argv, "out"));
    if (isInside(out, REPO_ROOT)) throw new Error(`--out ${out} is inside the repository; the full build (≈ 20 MB) is never committed`);
    const source = need(argv, "source");
    const built = arg(argv, "built") ?? new Date().toISOString().slice(0, 10);
    if (!dateRe.test(source) || !dateRe.test(built)) throw new Error("--source and --built are YYYY-MM-DD");
    const version = arg(argv, "version") ?? "v1";
    const k = Number(arg(argv, "k") ?? DEFAULT_K);
    const input = arg(argv, "input");
    const stream = input ? createReadStream(input) : process.stdin;
    if (!input && process.stdin.isTTY) throw new Error("pipe the dump: zstd -dc lichess_db_puzzle.csv.zst | npx tsx … build …");
    const started = Date.now();
    const { buckets, stats } = await collect(createInterface({ input: stream, crlfDelay: Infinity }), k);
    const { files, manifest } = finish(buckets, { version, k, built, source }, stats);
    writeBuild(out, files, manifest);
    const copy = arg(argv, "manifest-copy");
    if (copy) writeFileSync(path.resolve(copy), serialiseManifest(manifest));
    console.log(
      `read ${stats.lines} puzzles, ${stats.kept} pass the filter; wrote ${manifest.files} files, ${manifest.puzzles} tuples ` +
        `(${manifest.unique} distinct) to ${path.join(out, version)} in ${Math.round((Date.now() - started) / 1000)} s`,
    );
    if (stats.illegal.length) console.log(`dropped ${stats.illegal.length} illegal lines: ${stats.illegal.slice(0, 20).join(" ")}`);
    if (stats.unknownTags.size) {
      console.log(`tags without a bit: ${[...stats.unknownTags].map(([t, n]) => `${t} ${n}`).join(", ")}`);
    }
    const errors = verifyDir(path.join(out, version), { replay: false, manifest });
    for (const e of errors) console.error(e);
    return errors.length ? 1 : 0;
  }
  if (cmd === "verify") {
    const dir = path.resolve(need(argv, "dir"));
    const m = arg(argv, "manifest");
    const errors = verifyDir(dir, { replay: !argv.includes("--no-replay"), manifest: m ? readManifest(path.resolve(m)) : undefined });
    for (const e of errors) console.error(e);
    const manifest = m ? readManifest(path.resolve(m)) : readManifest(path.join(dir, "manifest.json"));
    console.log(errors.length ? `${errors.length} errors` : `ok: ${manifest.files} files, ${manifest.puzzles} puzzles, counts match the manifest`);
    return errors.length ? 1 : 0;
  }
  if (cmd === "subset") {
    const from = path.resolve(need(argv, "from"));
    const out = path.resolve(need(argv, "out"));
    const themes = need(argv, "themes").split(",").filter(Boolean);
    const bands = need(argv, "bands").split(",").map(Number);
    const perShard = Number(arg(argv, "per-shard") ?? 60);
    const { files, manifest } = subsetOf(from, { themes, bands, perShard });
    if (path.basename(out) !== manifest.version) throw new Error(`--out must end in /${manifest.version}`);
    writeBuild(path.dirname(out), files, manifest);
    const errors = verifyDir(out, { replay: true });
    for (const e of errors) console.error(e);
    console.log(`subset: ${manifest.files} files, ${manifest.puzzles} puzzles → ${out}`);
    return errors.length ? 1 : 0;
  }
  console.error("usage: build-shards.ts build|verify|subset … (see scripts/puzzles/README.md)");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exit(2);
    },
  );
}
