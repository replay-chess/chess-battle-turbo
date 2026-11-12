// Legend comparison facts (phase-03 plan §8.9, P3-D24): how far a game from a legend position followed the legend.
//
// Inputs: the game's start FEN and its `startPly`, the game's moves (UCI from that FEN), the member's colour, and the
// legend's continuation from the same position (slice.ts `legendLineFrom`).
//
// Walk both lines ply by ply from the start:
// - a ply where both lines play the same move continues the walk; when it is the member's, `matchedPlies` + 1;
// - the first ply that differs is `divergencePly` (an offset from the start, like every P3 ply index), with
//   `divergenceBy` = "user" when it is the member's move and "opponent" otherwise. The walk stops there: a later
//   transposition back into the line is ignored (play-b Q18);
// - when either line runs out first, there is no divergence: the member followed the legend as far as both go.
// `comparedPlies` = the member's plies up to and including the divergence ply (all walked member plies when there
// is none). `userUci/userSan` is the game's move at the divergence (whoever played it), `legendUci/legendSan` the
// legend's. Both lines are stored from the start position, ≤ LEGEND_LINE_MAX_PLIES each.
//
// Every writer (bot `complete`, the A2/A9 lazy insert, the worker) calls this one pure function and inserts with
// `ON CONFLICT DO NOTHING`, so they agree. `evalAtDivergence` is null here; the worker fills it (status READY).
// The result has exactly the fields of `ComparisonFactsV1` (packages/db/src/json/legend.ts).

import { moverAt, type Color } from "../codec";
import { sideToMove } from "../board";
import { playLine, sanOrNull } from "../text/facts";
import type { LegendResult } from "./slice";

/** Longest line a comparison stores per side (CT `LEGEND_LINE_MAX_PLIES`). */
export const LEGEND_LINE_MAX_PLIES = 120;
/** `ComparisonFactsV1.historicalName` is ≤ 40 characters. */
export const HISTORICAL_NAME_MAX = 40;

export interface ComparisonFacts {
  v: 1;
  side: Color;
  historicalName: string;
  startPly: number;
  comparedPlies: number;
  matchedPlies: number;
  divergencePly: number | null;
  divergenceBy: "user" | "opponent" | null;
  userUci: string | null;
  userSan: string | null;
  legendUci: string | null;
  legendSan: string | null;
  legendResult: LegendResult;
  legendTotalMoves: number | null;
  userLineUci: string;
  legendLineUci: string;
  evalAtDivergence: { userWin: number; legendWin: number } | null;
}

export interface CompareInput {
  startFen: string;
  /** games."startPly": the absolute ply of startFen. */
  startPly: number;
  /** The game's moves, UCI from startFen. */
  moves: readonly string[];
  member: Color;
  /** The legend's moves from the same position (UCI). */
  legendUci: readonly string[];
  /** The legend on the member's side ("Morphy"); cut to 40 characters. */
  historicalName: string;
  legendResult: LegendResult;
  legendTotalMoves: number | null;
}

/** The position before ply `k` of a UCI line from `startFen`, or null when the line does not replay that far. */
function fenBefore(startFen: string, uci: readonly string[], k: number): string | null {
  if (k === 0) return startFen;
  const moves = playLine(startFen, uci.slice(0, k));
  return moves.length === k ? (moves[k - 1]!.after as string) : null;
}

/** compareWithLegend (§8.9): the facts row for one member of one legend game. */
export function compareWithLegend(input: CompareInput): ComparisonFacts {
  const startMover = sideToMove(input.startFen);
  const userLine = input.moves.slice(0, LEGEND_LINE_MAX_PLIES);
  const legendLine = input.legendUci.slice(0, LEGEND_LINE_MAX_PLIES);
  const walk = Math.min(input.moves.length, input.legendUci.length);
  let matched = 0;
  let divergence: number | null = null;
  for (let k = 0; k < walk; k++) {
    if (input.moves[k] === input.legendUci[k]) {
      if (moverAt(k, startMover) === input.member) matched++;
      continue;
    }
    divergence = k;
    break;
  }
  const lastCompared = divergence ?? walk - 1;
  let compared = 0;
  for (let k = 0; k <= lastCompared; k++) if (moverAt(k, startMover) === input.member) compared++;

  let userUci: string | null = null;
  let userSan: string | null = null;
  let legendUci: string | null = null;
  let legendSan: string | null = null;
  if (divergence !== null) {
    const fen = fenBefore(input.startFen, input.moves, divergence);
    if (fen === null) throw new RangeError(`the game's moves do not replay up to ply ${divergence}`);
    userUci = input.moves[divergence] as string;
    legendUci = input.legendUci[divergence] as string;
    userSan = sanOrNull(fen, userUci);
    legendSan = sanOrNull(fen, legendUci);
    if (!userSan || !legendSan) throw new RangeError(`a move at the divergence (ply ${divergence}) is not legal`);
  }
  return {
    v: 1,
    side: input.member,
    historicalName: input.historicalName.slice(0, HISTORICAL_NAME_MAX),
    startPly: input.startPly,
    comparedPlies: compared,
    matchedPlies: matched,
    divergencePly: divergence,
    divergenceBy: divergence === null ? null : moverAt(divergence, startMover) === input.member ? "user" : "opponent",
    userUci,
    userSan,
    legendUci,
    legendSan,
    legendResult: input.legendResult,
    legendTotalMoves: input.legendTotalMoves,
    userLineUci: userLine.join(" "),
    legendLineUci: legendLine.join(" "),
    evalAtDivergence: null,
  };
}

/** Plies in a stored line ("" = 0). */
function pliesOf(line: string): number {
  return line === "" ? 0 : line.split(" ").length;
}

/**
 * The member played the legend's moves to the legend's final move: no divergence and both lines end together. The
 * coach line "{move} finished it the way {legend} did" needs this, not just "no divergence" (a game that stopped
 * early, or went on past the legend's record, did not finish it the legend's way).
 *
 * The stored lines are cut at LEGEND_LINE_MAX_PLIES, so two lines that both reach the cap prove nothing about where
 * either one ended: a member who stopped six plies before a 130-ply legend's end stores the same 120 plies as the
 * legend. Only lines shorter than the cap are whole, so only they can show a finish (regression:
 * followed-to-the-end-truncated-lines, FIX-2).
 */
export function followedToTheEnd(f: Pick<ComparisonFacts, "divergencePly" | "userLineUci" | "legendLineUci">): boolean {
  if (f.divergencePly !== null || f.userLineUci === "" || f.userLineUci !== f.legendLineUci) return false;
  return pliesOf(f.legendLineUci) < LEGEND_LINE_MAX_PLIES;
}

/** The member followed the legend for every compared move (no divergence of either side). */
export function followedLegend(f: Pick<ComparisonFacts, "divergencePly" | "comparedPlies">): boolean {
  return f.divergencePly === null && f.comparedPlies > 0;
}
