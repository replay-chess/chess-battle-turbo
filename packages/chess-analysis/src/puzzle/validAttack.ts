// Is the best move of a position a real, unique find? (phase-05 plan §8.1 steps 2–3, research R-PZL-04/06/07.)
//
// Re-implemented clean-room from the published description of how Lichess judges a puzzle move (the AGPL puzzler is
// never opened; CLEANROOM.md "P5"): a move is a puzzle move when it is the only good move. With winning chances
// wc ∈ [−1, 1] (winpct.ts, mover's point of view):
//
//   - no second legal move                                → valid (nothing to choose between);
//   - best mates in 1: valid when the second move also mates in 1 (any mate solves, so the other mates join
//     `accept`) or the second move's wc ≤ MATE_IN_1_SECOND_MAX (0.6);
//   - otherwise valid when gap = wc(best) − wc(second) > UNIQUENESS_GAP (T = 0.5, the looser "find the best move"
//     bound of R-PZL-04).
//
// A valid attack becomes a scored puzzle only when it also wins: the mover is at least PUZZLE_MIN_CP (+200) after the
// best move, or has a forced mate. Two more rules keep a position a review position instead (step 3): fewer than two
// legal moves (nothing to find), and "too winning": the mover was already above TOO_WINNING_CP (+300) before the
// opponent's previous move (or already had a forced mate there) while the best move now mates nothing (the opponent's
// error did not create the chance).
//
// Inputs are stored evals (codec.ts: White POV, centipawns or a mate score; `second` may be NO_SECOND).

import { evalFor, hasSecond, isMateEval, mateMoves, type Color } from "../codec";
import { winningChances } from "../winpct";

/** T: the winning-chances gap between the best and the second move that makes the best move unique. */
export const UNIQUENESS_GAP = 0.5;
/** A mate in 1 stays a puzzle while the second move keeps the mover at most this much winning chance. */
export const MATE_IN_1_SECOND_MAX = 0.6;
/** A scored puzzle leaves the solver at least this many centipawns up (or mating). */
export const PUZZLE_MIN_CP = 200;
/** Above this (before the opponent's previous move, no mate in sight) the position is "too winning" for a puzzle. */
export const TOO_WINNING_CP = 300;

export interface AttackInput {
  /** Stored eval of the position (= the eval after the best move), White POV. */
  best: number;
  /** MultiPV-2 score of the position, White POV, or NO_SECOND. */
  second: number;
  /** The side to move (the attacker). */
  mover: Color;
}

/** True when the stored eval is a mate for `side` (side mates). */
export function matesFor(e: number, side: Color): boolean {
  const own = evalFor(e, side);
  return isMateEval(own) && own > 0;
}

/** Mate in exactly `n` moves for `side`. */
function mateInFor(e: number, side: Color, n: number): boolean {
  return matesFor(e, side) && mateMoves(e) === n;
}

/** wc(best) − wc(second) from the mover's point of view; null when there is no second legal move. */
export function uniquenessGap(input: AttackInput): number | null {
  if (!hasSecond(input.second)) return null;
  return winningChances(evalFor(input.best, input.mover)) - winningChances(evalFor(input.second, input.mover));
}

/** The best move is the only good move (see the header). */
export function validAttack(input: AttackInput): boolean {
  if (!hasSecond(input.second)) return true;
  if (mateInFor(input.best, input.mover, 1)) {
    if (mateInFor(input.second, input.mover, 1)) return true;
    return winningChances(evalFor(input.second, input.mover)) <= MATE_IN_1_SECOND_MAX;
  }
  const gap = uniquenessGap(input);
  return gap !== null && gap > UNIQUENESS_GAP;
}

/** The mover wins after the best move: ≥ +200 cp or a forced mate for the mover. */
export function winsEnough(best: number, mover: Color): boolean {
  if (matesFor(best, mover)) return true;
  const own = evalFor(best, mover);
  return !isMateEval(own) && own >= PUZZLE_MIN_CP;
}

export interface PuzzleCheckInput extends AttackInput {
  /** Legal moves in the position. */
  legalCount: number;
  /** Stored eval of the position before the opponent's previous move (White POV), or null when there is none. */
  evalBeforeSetup: number | null;
}

export type PuzzleVerdict =
  | { isPuzzle: true; gap: number | null }
  | { isPuzzle: false; gap: number | null; reason: "few_legal_moves" | "not_unique" | "not_winning" | "too_winning" };

/** §8.1 steps 2–3: a scored puzzle, or a review position and why. `gap` is stored as `uniquenessGap`. */
export function puzzleVerdict(input: PuzzleCheckInput): PuzzleVerdict {
  const gap = uniquenessGap(input);
  if (input.legalCount < 2) return { isPuzzle: false, gap, reason: "few_legal_moves" };
  if (!validAttack(input)) return { isPuzzle: false, gap, reason: "not_unique" };
  if (!winsEnough(input.best, input.mover)) return { isPuzzle: false, gap, reason: "not_winning" };
  if (input.evalBeforeSetup !== null && !matesFor(input.best, input.mover)) {
    const before = evalFor(input.evalBeforeSetup, input.mover);
    const alreadyWinning = isMateEval(before) ? before > 0 : before > TOO_WINNING_CP;
    if (alreadyWinning) return { isPuzzle: false, gap, reason: "too_winning" };
  }
  return { isPuzzle: true, gap };
}
