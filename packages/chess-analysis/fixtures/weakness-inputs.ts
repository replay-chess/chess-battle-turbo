// Inputs for `computeSideInputs` (phase-06 plan §8.3.2, §12.1, §12.5): one fixture set that pins every call site to
// the same output. CA's weakness-inputs.test.ts checks `computeSideInputs(case) == golden`; the B-W1 backfill's
// integration test (apps/web/scripts/backfill/p06-backfills.int.test.ts) writes these games to Postgres, runs the
// backfill and compares the stored columns with the same golden; the worker's final batch, its heal (WP4) and the J5
// baseline build (WP2) can import the cases and the golden from `@repo/chess-analysis/fixtures/weakness-inputs`.
//
// Cases (rows exactly as `games` / `game_analyses` store them):
//   - the design mock GAME (labels/design-mock.ts, graded by gradeAnalysis with its three pass-2 lines), member White
//     (lost) and member Black (won), as a 10+0 rapid game with a constructed clock record in which White runs short
//     (the mock has no clocks): the only themes come from here, because the CC0 export carries no best moves;
//   - the same GAME from a set-up position (ply 19, Black to move: an odd startPly, no book exit);
//   - real rated Lichess games from `@repo/chess-fixtures/import/source/cc0-pool.json` (CC0): moves, the per-ply clocks
//     (centiseconds → ms, the import mapper's rule: `clocks.slice(0, plies) × 10`), and Lichess's own engine evals,
//     graded by the worker's grader (gradeAnalysis) with the export's opening length as the book. Their best moves are
//     unknown (the export strips them), so their errors carry no themes, but every clock, phase, piece and Win% loss
//     comes from a real game.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gradeAnalysis, type AnalysisInput } from "../src/analysis";
import { INITIAL_FEN } from "../src/board";
import { encodeCp, encodeMate, type Color } from "../src/codec";
import { replaySan, replayUci } from "../src/replay";
import type { MemberResult } from "../src/text/summary";
import type { SideInputs, SideInputsAnalysis, SideInputsGame, SideInputsSide } from "../src/weakness-inputs";
import { gameAnalysisInput } from "./review-inputs";

export interface WeaknessInputCase {
  name: string;
  game: SideInputsGame & { incrementSeconds: number };
  analysis: SideInputsAnalysis;
  side: SideInputsSide;
}

const require = createRequire(import.meta.url);

interface Cc0Raw {
  speed: string;
  status: string;
  moves: string;
  winner?: "white" | "black";
  clocks?: number[];
  analysis?: ({ eval: number } | { mate: number })[];
  opening: { eco: string; name: string; ply: number };
  clock?: { initial: number; increment: number };
}

/** Stockfish's score of the initial position (the CC0 export starts its evals after ply 1). */
export const INITIAL_EVAL_CP = 20;

let pool: Cc0Raw[] | null = null;
function cc0Pool(): Cc0Raw[] {
  pool ??= (JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/import/source/cc0-pool.json"), "utf8")) as { games: Cc0Raw[] }).games;
  return pool;
}

function resultOf(color: Color, winner: Cc0Raw["winner"]): { db: SideInputsSide["result"]; member: MemberResult } {
  if (!winner) return { db: "DRAW", member: "draw" };
  const won = (winner === "white") === (color === "w");
  return won ? { db: "WIN", member: "win" } : { db: "LOSS", member: "loss" };
}

const TIME_CLASS: Readonly<Record<string, string>> = { bullet: "BULLET", blitz: "BLITZ", rapid: "RAPID", classical: "CLASSICAL" };

/** One CC0 pool game as the import would store it and the worker would grade it (book = the export's opening length). */
export interface Cc0Game {
  index: number;
  /** The grading input (members to be filled by the caller). */
  input: AnalysisInput;
  /** games."moveClocksMs" (the import mapper's rule: centiseconds × 10, one per ply), or [] without a full record. */
  moveClocksMs: number[];
  initialTimeSeconds: number;
  incrementSeconds: number;
  /** games."timeClass" */
  timeClass: string | null;
  winner: "white" | "black" | null;
  /** The export's status (mate, resign, outoftime, draw, timeout, …). */
  status: string;
  eco: string;
}

/** CC0 pool game `index` with every eval present (throws for a game whose analysis is incomplete). */
export function cc0Game(index: number): Cc0Game {
  const g = cc0Pool()[index];
  if (!g) throw new RangeError(`no CC0 pool game ${index}`);
  const replay = replaySan(INITIAL_FEN, g.moves.trim().split(/\s+/));
  const n = replay.uci.length;
  const evals = [encodeCp(INITIAL_EVAL_CP)];
  for (const a of g.analysis ?? []) evals.push("mate" in a ? encodeMate(a.mate > 0 ? "w" : "b", Math.abs(a.mate)) : encodeCp(a.eval));
  // A game that ends in mate has no eval for the mated position: the terminal score (codec.ts, n = 0).
  if (evals.length === n && replay.final.checkmate) evals.push(encodeMate(n % 2 === 1 ? "w" : "b", 0));
  if (evals.length !== n + 1) throw new RangeError(`CC0 game ${index} has ${evals.length - 1} evals for ${n} plies`);
  const book = new Set(replay.epds.slice(1, g.opening.ply + 1));
  return {
    index,
    input: {
      startFen: INITIAL_FEN,
      startPly: 0,
      moves: replay.uci,
      evals,
      second: [],
      best: new Array<number>(n).fill(0),
      isBook: (epd) => book.has(epd),
      members: [],
    },
    moveClocksMs: g.clocks && g.clocks.length >= n ? g.clocks.slice(0, n).map((cs) => cs * 10) : [],
    initialTimeSeconds: g.clock?.initial ?? 0,
    incrementSeconds: g.clock?.increment ?? 0,
    timeClass: TIME_CLASS[g.speed] ?? null,
    winner: g.winner ?? null,
    status: g.status,
    eco: g.opening.eco,
  };
}

/** Indexes of the CC0 pool games with a complete eval record and a full clock record (the usable real games). */
export function cc0TimedIndexes(): number[] {
  const out: number[] = [];
  cc0Pool().forEach((_, i) => {
    try {
      if (cc0Game(i).moveClocksMs.length > 0) out.push(i);
    } catch {
      // incomplete analysis: not usable as a graded game
    }
  });
  return out;
}

/** One CC0 pool game as stored rows, graded as the worker grades a game with Lichess evals. */
export function cc0Case(index: number, color: Color): WeaknessInputCase {
  const c = cc0Game(index);
  const result = resultOf(color, c.winner ?? undefined);
  const graded = gradeAnalysis({ ...c.input, members: [{ side: color, result: result.member }] });
  return {
    name: `cc0-${index}-${color}`,
    game: {
      startingFen: c.input.startFen,
      startPly: 0,
      moves: c.input.moves.join(" "),
      moveClocksMs: c.moveClocksMs,
      initialTimeSeconds: c.initialTimeSeconds,
      incrementSeconds: c.incrementSeconds,
      timeClass: c.timeClass,
    },
    analysis: {
      evals: c.input.evals,
      best: c.input.best,
      judgements: graded.judgements,
      lines: graded.lines,
      middlegamePly: graded.division.middlegamePly,
      endgamePly: graded.division.endgamePly,
    },
    side: { color, result: result.db },
  };
}

/**
 * The constructed clock record of the design GAME as 10+0 (ms after each ply): White spends steadily and is under a
 * minute from ply 34 on; Black keeps 4–6 minutes.
 */
export function designClocks(plies: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < plies; i++) {
    const move = Math.floor(i / 2);
    out.push(i % 2 === 0 ? Math.max(5_000, 590_000 - move * 32_000) : Math.max(240_000, 595_000 - move * 13_000));
  }
  return out;
}

function designCase(color: Color, from = 0): WeaknessInputCase {
  const base = gameAnalysisInput();
  const members = [{ side: color, result: (color === "w" ? "loss" : "win") as MemberResult }];
  // From a set-up position: the FEN before ply `from`, every array re-based to offset 0, no book (not the initial
  // position), the pass-2 lines re-keyed.
  const input: AnalysisInput =
    from === 0
      ? { ...base, members }
      : {
          ...base,
          startFen: replayUci(base.startFen, base.moves).fens[from] as string,
          startPly: from,
          moves: base.moves.slice(from),
          evals: base.evals.slice(from),
          second: base.second.slice(from),
          best: base.best.slice(from),
          lines: Object.fromEntries(
            Object.entries(base.lines ?? {})
              .filter(([p]) => Number(p) >= from)
              .map(([p, l]) => [Number(p) - from, l]),
          ),
          isBook: () => false,
          members,
        };
  const graded = gradeAnalysis(input);
  const n = input.moves.length;
  return {
    name: from === 0 ? `design-game-${color}` : `design-from-${from}-${color}`,
    game: {
      startingFen: input.startFen,
      startPly: input.startPly,
      moves: input.moves.join(" "),
      moveClocksMs: designClocks(n),
      initialTimeSeconds: 600,
      incrementSeconds: 0,
      timeClass: "RAPID",
    },
    analysis: {
      evals: input.evals,
      best: input.best,
      judgements: graded.judgements,
      lines: graded.lines,
      middlegamePly: graded.division.middlegamePly,
      endgamePly: graded.division.endgamePly,
    },
    side: { color, result: color === "w" ? "LOSS" : "WIN" },
  };
}

/** The CC0 games used (index, member colour): rapid, blitz 3+3 with a long endgame under a minute, bullet, a draw. */
export const CC0_CASES: readonly (readonly [number, Color])[] = [
  [0, "b"],
  [5, "w"],
  [3, "w"],
  [17, "w"],
  [30, "b"],
  [44, "w"],
];

/** Every fixture case, in a fixed order (the golden file's order). */
export function weaknessInputCases(): WeaknessInputCase[] {
  return [designCase("w"), designCase("b"), designCase("b", 19), ...CC0_CASES.map(([i, c]) => cc0Case(i, c))];
}

/** The golden outputs, by case name (fixtures/weakness-inputs.golden.json; regenerate only with a reviewed --update). */
export function weaknessInputsGolden(): Record<string, SideInputs> {
  return JSON.parse(readFileSync(new URL("./weakness-inputs.golden.json", import.meta.url), "utf8")) as Record<string, SideInputs>;
}
