// Puzzle shard format v1 (phase-05 plan §8.13, §9.3, §11.x theme bitmask).
//
// One shard = the top K CC0 Lichess puzzles of one theme in one 100-point rating band, stored at
// `<base>/<version>/<theme>/<band>.json`; the manifest `<base>/<version>/manifest.json` lists the count of every shard
// and the theme ↔ bit table of the bitmask. The same manifest is committed as
// `@repo/chess-training/puzzles/manifest.v1.json`, so the server knows the counts without a fetch.
//
// Pure and shared: the build script (scripts/puzzles/build-shards.ts), the upload script, the shard loader
// (puzzles.server.ts), the CI shard server (e2e/mocks/puzzle-shards.ts) and the post-deploy smoke
// (scripts/qa/smoke-puzzle-shards.ts) all read shards through these functions. No network, no Node APIs.
//
// The theme bits are `@repo/chess-training/themes` SHARD_THEME_BITS (append-only, ≤ 53 bits so a mask is an exact JSON
// number); the build copies that table into the manifest, and every reader decodes with the manifest's copy.
import { MIX_THEME, PUZZLE_BAND_MAX, PUZZLE_BAND_MIN } from "@repo/chess-training/constants";
import { Chess } from "chess.js";
import { z } from "zod";

export { MIX_THEME, PUZZLE_BAND_MAX, PUZZLE_BAND_MIN };

/** The shard file format; a change of shape is a new format number AND a new version path. */
export const SHARD_FORMAT = 1;
/** The theme mask is a JSON number, so at most 53 bits (`Number.MAX_SAFE_INTEGER`). */
export const MAX_THEME_BITS = 53;
/** Longest solution kept by the build (§8.13): the setup move plus the line, in UCI tokens. */
export const MAX_MOVE_TOKENS = 15;

const PuzzleIdRe = /^[A-Za-z0-9]{5,8}$/;
/** The shard theme part of a path: a Lichess key (`fork`, `mateIn2`, …) or `mix`. Never `rc:*`. */
export const ShardThemeKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,29}$/);
const VersionKey = z.string().regex(/^v[0-9]{1,3}$/);
const UciToken = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** `[lichessId, fen, "setup best reply …", rating, themesMask]` — the plan's tuple (TRN `PuzzleTuple`), rating-ascending. */
export type ShardTuple = [id: string, fen: string, moves: string, rating: number, themes: number];

export const ShardTupleSchema = z.tuple([
  z.string().regex(PuzzleIdRe),
  z.string().min(20).max(100),
  z
    .string()
    .max(120)
    .refine((m) => {
      const tokens = m.split(" ");
      return tokens.length >= 2 && tokens.length <= MAX_MOVE_TOKENS && tokens.every((t) => UciToken.test(t));
    }, "moves must be 2-15 UCI tokens"),
  z.number().int().min(PUZZLE_BAND_MIN * 100).max(PUZZLE_BAND_MAX * 100 + 99),
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
]);

export const ShardFileSchema = z.object({
  v: z.literal(SHARD_FORMAT),
  version: VersionKey,
  theme: ShardThemeKey,
  band: z.number().int().min(PUZZLE_BAND_MIN).max(PUZZLE_BAND_MAX),
  p: z.array(ShardTupleSchema).max(1000),
});
export type ShardFile = z.infer<typeof ShardFileSchema>;

export const PuzzleManifestSchema = z
  .object({
    version: VersionKey,
    format: z.literal(SHARD_FORMAT),
    /** Build date (UTC, YYYY-MM-DD). */
    built: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** The dump's date (its Last-Modified, UTC). */
    source: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    license: z.string(),
    /** Top K per shard. */
    k: z.number().int().min(1).max(1000),
    filter: z.object({
      popularityMin: z.number().int(),
      nbPlaysMin: z.number().int(),
      ratingDeviationMax: z.number().int(),
      ratingMin: z.number().int(),
      ratingMax: z.number().int(),
      movesMax: z.number().int(),
    }),
    /** theme → band ("6" … "25") → puzzles in that file. A band with no puzzles has no key and no file. */
    themes: z.record(ShardThemeKey, z.record(z.string().regex(/^[0-9]{1,2}$/), z.number().int().min(1).max(1000))),
    /** Lichess theme key → bit (0 … 63) of the bitmask. `rc:*` keys never have a bit. */
    bits: z.record(ShardThemeKey, z.number().int().min(0).max(MAX_THEME_BITS - 1)),
    files: z.number().int().min(0),
    puzzles: z.number().int().min(0),
    unique: z.number().int().min(0),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<number>();
    for (const [key, bit] of Object.entries(m.bits)) {
      if (key === MIX_THEME) ctx.addIssue({ code: "custom", message: "mix has no bit", path: ["bits", key] });
      if (seen.has(bit)) ctx.addIssue({ code: "custom", message: `bit ${bit} used twice`, path: ["bits", key] });
      seen.add(bit);
    }
    let files = 0;
    let puzzles = 0;
    for (const [theme, bands] of Object.entries(m.themes)) {
      if (theme !== MIX_THEME && !(theme in m.bits)) {
        ctx.addIssue({ code: "custom", message: `shard theme ${theme} has no bit`, path: ["themes", theme] });
      }
      for (const [band, n] of Object.entries(bands)) {
        const b = Number(band);
        if (b < PUZZLE_BAND_MIN || b > PUZZLE_BAND_MAX) {
          ctx.addIssue({ code: "custom", message: `band ${band} out of range`, path: ["themes", theme, band] });
        }
        if (n > m.k) ctx.addIssue({ code: "custom", message: `more than k puzzles`, path: ["themes", theme, band] });
        files += 1;
        puzzles += n;
      }
    }
    if (files !== m.files) ctx.addIssue({ code: "custom", message: `files ${m.files} ≠ ${files} listed`, path: ["files"] });
    if (puzzles !== m.puzzles) ctx.addIssue({ code: "custom", message: `puzzles ${m.puzzles} ≠ ${puzzles} listed`, path: ["puzzles"] });
  });
export type PuzzleManifest = z.infer<typeof PuzzleManifestSchema>;

/** `floor(rating / 100)`, not clamped (callers clamp to the manifest's bands). */
export function bandOf(rating: number): number {
  return Math.floor(rating / 100);
}

/** `<version>/<theme>/<band>.json` (relative to the base URL / build root). */
export function shardPath(version: string, theme: string, band: number): string {
  return `${version}/${theme}/${band}.json`;
}

/** `<version>/manifest.json`. */
export function manifestPath(version: string): string {
  return `${version}/manifest.json`;
}

/** The bands (as numbers, ascending) of one theme that have a file. */
export function manifestBands(manifest: PuzzleManifest, theme: string): number[] {
  const bands = manifest.themes[theme];
  return bands ? Object.keys(bands).map(Number).sort((a, b) => a - b) : [];
}

/** Puzzles in one shard per the manifest (0 = no file). */
export function manifestCount(manifest: PuzzleManifest, theme: string, band: number): number {
  return manifest.themes[theme]?.[String(band)] ?? 0;
}

/** Every `(theme, band)` the manifest lists, in theme then band order. */
export function manifestShards(manifest: PuzzleManifest): { theme: string; band: number; count: number }[] {
  return Object.keys(manifest.themes).flatMap((theme) =>
    manifestBands(manifest, theme).map((band) => ({ theme, band, count: manifestCount(manifest, theme, band) })),
  );
}

// ---------------------------------------------------------------------------
// Bitmask (≤ 53 bits: plain arithmetic, since bitwise operators truncate to 32 bits)

const hasBit = (mask: number, bit: number) => Math.floor(mask / 2 ** bit) % 2 === 1;

/** The mask of a list of Lichess theme keys; keys without a bit are ignored. */
export function maskOf(themes: Iterable<string>, bits: Readonly<Record<string, number>>): number {
  const set = new Set<number>();
  for (const key of themes) {
    const bit = bits[key];
    if (bit !== undefined) set.add(bit);
  }
  let mask = 0;
  for (const bit of set) mask += 2 ** bit;
  return mask;
}

/** The theme keys whose bit is set, in bit order. */
export function themesOfMask(mask: number, bits: Readonly<Record<string, number>>): string[] {
  return Object.entries(bits)
    .filter(([, bit]) => hasBit(mask, bit))
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key);
}

export function maskHas(mask: number, theme: string, bits: Readonly<Record<string, number>>): boolean {
  const bit = bits[theme];
  return bit !== undefined && hasBit(mask, bit);
}

/** True when the mask sets a bit the table does not name. */
export function maskHasUnknownBits(mask: number, bits: Readonly<Record<string, number>>): boolean {
  return mask !== maskOf(themesOfMask(mask, bits), bits);
}

// ---------------------------------------------------------------------------
// Chess

/**
 * The side that solves: Lichess's FEN is the position BEFORE the opponent's setup move (the first token), so the
 * solver is the side NOT to move in the FEN.
 */
export function solverColor(fen: string): "w" | "b" {
  return fen.split(" ")[1] === "w" ? "b" : "w";
}

export type ReplayResult = { ok: true; finalFen: string } | { ok: false; ply: number; reason: string };

/** Replays the setup move and the solution with chess.js; every token must be legal. */
export function replayPuzzle(fen: string, moves: string): ReplayResult {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch (e) {
    return { ok: false, ply: 0, reason: `bad fen: ${(e as Error).message}` };
  }
  const tokens = moves.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    const uci = tokens[i] ?? "";
    if (!UciToken.test(uci)) return { ok: false, ply: i, reason: `bad uci ${JSON.stringify(uci)}` };
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length === 5 ? uci[4] : undefined });
    } catch {
      return { ok: false, ply: i, reason: `illegal ${uci}` };
    }
  }
  return { ok: true, finalFen: chess.fen() };
}

export type ShardCheck = { ok: true } | { ok: false; errors: string[] };

/**
 * Checks one parsed shard file against its path and the manifest: header, count, band, theme bit, unique ids,
 * rating-ascending order and (when `replay`) a legal line for every puzzle.
 */
export function checkShard(
  file: ShardFile,
  expected: { version: string; theme: string; band: number },
  manifest: PuzzleManifest,
  options: { replay: boolean } = { replay: true },
): ShardCheck {
  const errors: string[] = [];
  const where = `${expected.theme}/${expected.band}`;
  if (file.version !== expected.version) errors.push(`${where}: version ${file.version} ≠ ${expected.version}`);
  if (file.theme !== expected.theme) errors.push(`${where}: theme ${file.theme}`);
  if (file.band !== expected.band) errors.push(`${where}: band ${file.band}`);
  const count = manifestCount(manifest, expected.theme, expected.band);
  if (file.p.length !== count) errors.push(`${where}: ${file.p.length} puzzles, manifest says ${count}`);
  const ids = new Set<string>();
  let last = -Infinity;
  for (const [id, fen, moves, rating, mask] of file.p) {
    if (ids.has(id)) errors.push(`${where}: duplicate ${id}`);
    ids.add(id);
    if (bandOf(rating) !== expected.band) errors.push(`${where}: ${id} rating ${rating} outside the band`);
    if (rating < last) errors.push(`${where}: ${id} breaks the rating order`);
    last = rating;
    if (expected.theme !== MIX_THEME && !maskHas(mask, expected.theme, manifest.bits)) {
      errors.push(`${where}: ${id} lacks the ${expected.theme} bit`);
    }
    if (maskHasUnknownBits(mask, manifest.bits)) errors.push(`${where}: ${id} sets bits the manifest does not name`);
    if (options.replay) {
      const r = replayPuzzle(fen, moves);
      if (!r.ok) errors.push(`${where}: ${id} ply ${r.ply}: ${r.reason}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
