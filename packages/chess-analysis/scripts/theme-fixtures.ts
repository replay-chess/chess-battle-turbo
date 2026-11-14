// Selects the CC0 theme fixtures of the Tier-1 tagger (phase-05 plan §8.11, §12.3):
// `packages/chess-fixtures/puzzles/<theme>.json`, 50 Lichess puzzles that carry the theme and 50 that do not.
//
//   zstd -dc lichess_db_puzzle.csv.zst | pnpm --filter @repo/chess-analysis exec tsx scripts/theme-fixtures.ts \
//     --out ../chess-fixtures/puzzles --source "<url> Last-Modified …"
//
// The selection never looks at what our tagger says (the fixtures are the oracle, not a mirror of the code):
//   1. a fixed hash sample of the dump: FNV-1a 32 of the puzzle id, kept when ≡ 0 (mod SAMPLE_MOD);
//   2. a quality filter on Lichess's own counters: popularity ≥ 80, ≥ 200 plays, rating deviation ≤ 100;
//   3. per theme, the sampled puzzles ordered by FNV-1a 32 of "<id>|<theme>": the first 50 that carry the theme and
//      the first 50 that do not.
// The dump is read from stdin and never stored in the repository; only the selected rows are written.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { TIER1_THEMES } from "../src/themes/index";

export const SAMPLE_MOD = 16;
export const PER_SIDE = 50;
export const QUALITY = { minPopularity: 80, minPlays: 200, maxDeviation: 100 } as const;

/** One fixture row: [PuzzleId, FEN (before the setup move), Moves (setup first), Rating, Themes]. */
export type FixtureRow = [string, string, string, number, string];

export interface ThemeFixture {
  $comment: string;
  theme: string;
  source: string;
  licence: "CC0";
  columns: ["id", "fen", "moves", "rating", "themes"];
  with: FixtureRow[];
  without: FixtureRow[];
}

export function fnv32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Parses one dump line (no quoted commas in this CSV); null for the header or a row the filter drops. */
export function sampleRow(line: string): FixtureRow | null {
  const [id, fen, moves, rating, deviation, popularity, plays, themes] = line.split(",");
  if (!id || !fen || !moves || id === "PuzzleId" || themes === undefined) return null;
  if (fnv32(id) % SAMPLE_MOD !== 0) return null;
  if (Number(popularity) < QUALITY.minPopularity || Number(plays) < QUALITY.minPlays) return null;
  if (Number(deviation) > QUALITY.maxDeviation) return null;
  return [id, fen, moves, Number(rating), themes];
}

export function selectFor(theme: string, rows: readonly FixtureRow[], source: string): ThemeFixture {
  const ordered = [...rows].sort((a, b) => fnv32(`${a[0]}|${theme}`) - fnv32(`${b[0]}|${theme}`) || (a[0] < b[0] ? -1 : 1));
  const has = (r: FixtureRow) => r[4].split(" ").includes(theme);
  return {
    $comment: `Tier-1 tagger oracle for "${theme}" (plan §8.11, §12.3). Selected by packages/chess-analysis/scripts/theme-fixtures.ts without consulting the tagger.`,
    theme,
    source,
    licence: "CC0",
    columns: ["id", "fen", "moves", "rating", "themes"],
    with: ordered.filter(has).slice(0, PER_SIDE),
    without: ordered.filter((r) => !has(r)).slice(0, PER_SIDE),
  };
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const out = arg("--out");
  const source = arg("--source");
  if (!out || !source) throw new Error("usage: theme-fixtures.ts --out <dir> --source <text>");
  const rows: FixtureRow[] = [];
  for await (const line of createInterface({ input: process.stdin })) {
    const r = sampleRow(line);
    if (r) rows.push(r);
  }
  mkdirSync(resolve(out), { recursive: true });
  for (const theme of TIER1_THEMES) {
    const fx = selectFor(theme, rows, source);
    if (fx.with.length < PER_SIDE) throw new Error(`${theme}: only ${fx.with.length} sampled puzzles carry it`);
    writeFileSync(resolve(out, `${theme}.json`), `${JSON.stringify(fx, null, 0).replace(/\],\[/g, "],\n[")}\n`);
    console.log(`${theme}: ${fx.with.length} with, ${fx.without.length} without`);
  }
  console.log(`sampled ${rows.length} puzzles`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
