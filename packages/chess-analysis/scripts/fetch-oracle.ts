/**
 * Pulls the accuracy oracle (phase-03 plan §8.2 R-ACC-05, §12.4): 30 Lichess games with Lichess's own server
 * analysis (per-ply evals, judgements, per-player accuracy and phase accuracy, and the opening/middlegame/endgame
 * division), written as one normalised JSON file per game to `packages/chess-analysis/fixtures/oracle/<id>.json`.
 *
 * Run once (and only again if the set changes); the files are committed and the tests never touch the network:
 *
 *   pnpm --filter @repo/chess-analysis exec tsx scripts/fetch-oracle.ts [--out <dir>]
 *
 * One polite request: `POST https://lichess.org/api/games/export/_ids` with the 30 ids below and
 * `evals=true&accuracy=true&division=true` (no auth; Lichess game data is public, CC0). Player names are dropped
 * from the fixtures; the game id and URL are kept for provenance.
 *
 * How the 30 were chosen (2026-11-11): analysed, rated, standard-chess games from the public game exports of five
 * accounts (players rated 1405 to 3254), picked for spread before any of our numbers were computed: 14 rapid,
 * 7 bullet, 5 classical, 4 blitz; 14 resignations, 9 checkmates (4 of them with a final `mate: 0` entry, 5 without),
 * 3 flag falls, 3 draws and an insufficient-material claim; games with long mate-score stretches (SnXhGC57,
 * zR8HRccT, HmLzqg5C, 5VvNDqqZ); accuracies from 44 to 99; 29 to 156 plies. Two of them (fuI5l6LA, GEKQhN74) were
 * added because they contain moves whose accuracy is close to 0, which is what settles the harmonic-mean [V] item
 * in `src/accuracy.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORACLE_IDS = [
  // super-GM blitz and bullet
  "HqjDTU4A",
  "iVshKPMF",
  "J3C5rR4Z",
  "zR8HRccT",
  "HmLzqg5C",
  "kAdOQKeh",
  "SnXhGC57",
  "nrmBGiQF",
  // ~2500 rapid and bullet
  "QqDoLuA7",
  "YWrZlfyf",
  "0E2JOKCO",
  "41EMOt8L",
  "7yb6UNWK",
  "X2J8gPrP",
  "sGkL5ayA",
  // ~2150 rapid and classical
  "h4x2lOaa",
  "yiaANwAB",
  "Pa2jfVb8",
  "agENlnZZ",
  "uCbgMiAk",
  "fPm2xBUC",
  "5VvNDqqZ",
  "v82exr7y",
  // ~1900 rapid
  "6LZ7Bh1M",
  "IzXB1W8s",
  "NHgJXyIM",
  "jH5ZP7YC",
  "RXT4AKA8",
  // ~1800 blitz with near-zero move accuracies
  "fuI5l6LA",
  "GEKQhN74",
] as const;

export const ORACLE_QUERY = "evals=true&accuracy=true&division=true&opening=true&clocks=false&literate=false";

export type OracleJudgement = "Inaccuracy" | "Mistake" | "Blunder";

/** One analysis entry: the eval of the position AFTER the ply (White POV), as Lichess publishes it. */
export type OracleEval = ({ eval: number } | { mate: number }) & { best?: string; judgment?: OracleJudgement };

export interface OraclePlayer {
  rating: number;
  accuracy: number;
  acpl: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
  phases: { opening?: number; middlegame?: number; endgame?: number };
}

export interface OracleGame {
  id: string;
  url: string;
  source: string;
  speed: string;
  status: string;
  winner: "white" | "black" | null;
  /** SAN moves from the initial position. */
  moves: string[];
  /** `analysis[k]` = the position after ply k. A game ending in mate may omit the final entry. */
  analysis: OracleEval[];
  players: { white: OraclePlayer; black: OraclePlayer };
  /** Lichess division in plies; a missing key means "not reached". */
  division: { middle?: number; end?: number };
}

interface RawPlayer {
  rating?: number;
  analysis?: {
    accuracy?: number;
    acpl?: number;
    inaccuracy?: number;
    mistake?: number;
    blunder?: number;
    phases?: OraclePlayer["phases"];
  };
}

interface RawGame {
  id: string;
  variant?: string;
  speed?: string;
  status?: string;
  winner?: "white" | "black";
  initialFen?: string;
  moves?: string;
  analysis?: Array<{ eval?: number; mate?: number; best?: string; judgment?: { name?: string } }>;
  players?: { white?: RawPlayer; black?: RawPlayer };
  division?: { middle?: number; end?: number };
}

function player(p: RawPlayer | undefined, id: string, side: string): OraclePlayer {
  const a = p?.analysis;
  if (!p || typeof p.rating !== "number" || !a || typeof a.accuracy !== "number") {
    throw new Error(`${id}: ${side} has no rating or accuracy (is the game analysed?)`);
  }
  return {
    rating: p.rating,
    accuracy: a.accuracy,
    acpl: a.acpl ?? 0,
    inaccuracy: a.inaccuracy ?? 0,
    mistake: a.mistake ?? 0,
    blunder: a.blunder ?? 0,
    phases: a.phases ?? {},
  };
}

/** Raw Lichess export → the committed fixture shape (no player names). Throws on anything the tests cannot use. */
export function normalizeGame(raw: RawGame, fetchedOn: string): OracleGame {
  if (raw.variant !== "standard" || raw.initialFen) throw new Error(`${raw.id}: not a standard game from move 1`);
  const moves = (raw.moves ?? "").split(" ").filter(Boolean);
  const analysis = (raw.analysis ?? []).map((x, k): OracleEval => {
    const base: OracleEval =
      typeof x.eval === "number"
        ? { eval: x.eval }
        : typeof x.mate === "number"
          ? { mate: x.mate }
          : (() => {
              throw new Error(`${raw.id}: analysis entry ${k} has neither eval nor mate`);
            })();
    if (x.best) base.best = x.best;
    const j = x.judgment?.name;
    if (j === "Inaccuracy" || j === "Mistake" || j === "Blunder") base.judgment = j;
    else if (j !== undefined) throw new Error(`${raw.id}: unknown judgement ${j}`);
    return base;
  });
  if (moves.length === 0 || analysis.length < moves.length - 1 || analysis.length > moves.length) {
    throw new Error(`${raw.id}: ${analysis.length} evals for ${moves.length} plies`);
  }
  return {
    id: raw.id,
    url: `https://lichess.org/${raw.id}`,
    source: `Lichess game export (public game data, CC0), ${ORACLE_QUERY}, fetched ${fetchedOn}`,
    speed: raw.speed ?? "unknown",
    status: raw.status ?? "unknown",
    winner: raw.winner ?? null,
    moves,
    analysis,
    players: { white: player(raw.players?.white, raw.id, "white"), black: player(raw.players?.black, raw.id, "black") },
    division: {
      ...(raw.division?.middle !== undefined ? { middle: raw.division.middle } : {}),
      ...(raw.division?.end !== undefined ? { end: raw.division.end } : {}),
    },
  };
}

/** Pretty JSON with one analysis entry per line (readable diffs, compact files). */
export function serializeGame(g: OracleGame): string {
  const { analysis, moves, ...rest } = g;
  const head = JSON.stringify({ ...rest, moves: moves.join(" ") }, null, 2).replace(/\n}$/, "");
  const body = analysis.map((a) => `    ${JSON.stringify(a)}`).join(",\n");
  return `${head},\n  "analysis": [\n${body}\n  ]\n}\n`;
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outArg = process.argv.indexOf("--out");
  const out = outArg > 0 ? path.resolve(process.argv[outArg + 1] ?? "") : path.resolve(here, "../fixtures/oracle");
  const res = await fetch(`https://lichess.org/api/games/export/_ids?${ORACLE_QUERY}`, {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "text/plain",
      "User-Agent": "replay-chess-oracle-fetch/1.0",
    },
    body: ORACLE_IDS.join(","),
  });
  if (!res.ok) throw new Error(`Lichess answered ${res.status}`);
  const lines = (await res.text()).trim().split("\n").filter(Boolean);
  const fetchedOn = new Date().toISOString().slice(0, 10);
  const games = lines.map((l) => normalizeGame(JSON.parse(l) as RawGame, fetchedOn));
  const missing = ORACLE_IDS.filter((id) => !games.some((g) => g.id === id));
  if (missing.length) throw new Error(`missing from the export: ${missing.join(", ")}`);
  mkdirSync(out, { recursive: true });
  for (const g of games) writeFileSync(path.join(out, `${g.id}.json`), serializeGame(g));
  console.log(`wrote ${games.length} oracle games to ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
