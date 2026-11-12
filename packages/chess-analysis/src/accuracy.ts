// Move and game accuracy (phase-03 plan §8.2; R-ACC-01…05). Re-implemented from the published Lichess "Accuracy"
// description under the clean-room rules (constants from documentation; the open points below were settled by
// measurement against Lichess's published numbers, not by reading their code).
//
// Inputs are Win% values (winpct.ts). A game's series has one White-POV Win% per position 0 … plies, so position 0
// (before the first ply) is part of it.
//
// [V] items, resolved with the oracle (`accuracy.oracle.test.ts`, 30 Lichess games in `fixtures/oracle/`) and the
// 68 other analysed games pulled while choosing them: 196 player accuracies in all, measured 2026-11-11.
//
// 1. Series start. The series starts at position 0, the position BEFORE the first ply, so White's first move is
//    graded like every other move. Lichess does not publish the eval of position 0; any small opening value fits
//    (15 or 20 cp: 196/196 round to Lichess's integer; 0 cp: 183/196). Leaving position 0 out shifts every window
//    by one ply: 39/196 round differently and 5 are off by more than 1. When the eval of position 0 is unknown
//    (Lichess-eval imports, the oracle), use `START_POSITION_EVAL` (15 cp).
// 2. Harmonic mean with tiny or zero move accuracies. The plan's draft treated 0 as 0.01. The data says otherwise:
//    every move accuracy enters the harmonic mean floored at 1 (`HARMONIC_FLOOR`). Floor 1: 196/196 within ±0.5;
//    floor 0.01 (or excluding zeros): 4 players off by 7–14 points (games fuI5l6LA, GEKQhN74, H7KbchCO, whose
//    worst moves score 0.03–0.43); floor 0.5: off by up to 5.7; floor 2: off by up to 7.2. The weighted mean uses
//    the raw values (flooring it too changes nothing measurable).
// 3. Volatility weight: the population standard deviation (÷ N) of each window. The sample deviation (÷ N − 1)
//    misses ±1 on 7 of the first 96 players measured.
//
// Phase accuracy (R-ACC-02) follows the plan: `gameAccuracy` re-run on each phase slice. Lichess publishes its own
// phase numbers too and computes them differently; on the oracle our slices round to Lichess's value on 101 of 162
// phase figures (128 within ±1). Nothing depends on matching them; the division itself matches exactly (divider.ts).
//
// Display rule (R-ACC-04): accuracy is shown as Math.round() and only once the analysis is DONE.

import type { Color } from "./codec";
import { moverAt } from "./codec";

export const ACC_A = 103.1668100711649;
export const ACC_B = 0.04354415386753951;
export const ACC_C = 3.166924740191411;
/** The published "+1 uncertainty bonus". */
export const ACC_BONUS = 1;
/** Floor of a move accuracy inside the harmonic mean ([V] item 2). */
export const HARMONIC_FLOOR = 1;
/** Window size bounds: floor(plies / 10) clamped to [2, 8]. */
export const WINDOW_MIN = 2;
export const WINDOW_MAX = 8;
/** Volatility weight bounds (Win% standard deviation of a window). */
export const WEIGHT_MIN = 0.5;
export const WEIGHT_MAX = 12;
/** Centipawns of the initial position when no engine eval of it exists ([V] item 1). */
export const START_POSITION_EVAL = 15;
/** Phase accuracy of a phase the player made fewer than 2 moves in (R-ACC-02): "not reached". */
export const PHASE_NOT_REACHED = -1;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Accuracy of one move from the mover's Win% before and after it (mover POV), ∈ [0, 100]. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const d = winBefore - winAfter;
  return clamp(ACC_A * Math.exp(-ACC_B * d) - ACC_C + ACC_BONUS, 0, 100);
}

function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation ([V] item 3). */
export function stddev(xs: readonly number[]): number {
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / xs.length);
}

/** Window size for a series of `positions` Win% values (plies = positions − 1). */
export function windowSize(positions: number): number {
  return clamp(Math.floor((positions - 1) / 10), WINDOW_MIN, WINDOW_MAX);
}

/**
 * Volatility weight of each move of the series (index i = the move from position i to i + 1). The first w − 2
 * moves reuse the first window, then the window slides one position per move, so there is exactly one weight per
 * move.
 */
export function volatilityWeights(series: readonly number[]): number[] {
  const n = series.length;
  if (n < 2) return [];
  const w = windowSize(n);
  const first = series.slice(0, w);
  const out: number[] = [];
  for (let k = 0; k < Math.max(0, w - 2); k++) out.push(clamp(stddev(first), WEIGHT_MIN, WEIGHT_MAX));
  for (let i = 0; i + w <= n; i++) out.push(clamp(stddev(series.slice(i, i + w)), WEIGHT_MIN, WEIGHT_MAX));
  // A series shorter than the window (n < w) still needs one weight per move.
  while (out.length < n - 1) out.push(clamp(stddev(series), WEIGHT_MIN, WEIGHT_MAX));
  return out.slice(0, n - 1);
}

/**
 * Game accuracy of `color` from a White-POV Win% series (positions 0 … plies). `startMover` is the side to move in
 * position 0. Returns `null` when the series has fewer than 3 positions or the colour made no move.
 */
export function gameAccuracy(series: readonly number[], color: Color, startMover: Color): number | null {
  const n = series.length;
  if (n < 3) return null;
  const weights = volatilityWeights(series);
  let wSum = 0;
  let wAcc = 0;
  let invSum = 0;
  let count = 0;
  for (let i = 0; i < n - 1; i++) {
    if (moverAt(i, startMover) !== color) continue;
    const s0 = series[i] as number;
    const s1 = series[i + 1] as number;
    const acc = color === "w" ? moveAccuracy(s0, s1) : moveAccuracy(100 - s0, 100 - s1);
    const wt = weights[i] as number;
    wSum += wt;
    wAcc += acc * wt;
    invSum += 1 / Math.max(acc, HARMONIC_FLOOR);
    count++;
  }
  if (count === 0) return null;
  return (wAcc / wSum + count / invSum) / 2;
}

/** Number of moves `color` made in the plies [from, to) of a game whose position 0 has `startMover` to move. */
function movesBy(color: Color, startMover: Color, from: number, to: number): number {
  let c = 0;
  for (let i = from; i < to; i++) if (moverAt(i, startMover) === color) c++;
  return c;
}

/**
 * The position range [from, to] of each phase (opening, middlegame, endgame) of a game with `plies` plies: opening =
 * [0, middlegamePly], middlegame = [middlegamePly, endgamePly], endgame = [endgamePly, plies]. A phase the game never
 * reached is [0, 0]. Shared by `phaseAccuracy` and the phase line (text/phase.ts), so both read the same slices.
 */
export function phaseBounds(
  plies: number,
  division: { middlegamePly: number | null; endgamePly: number | null },
): [[number, number], [number, number], [number, number]] {
  const mid = division.middlegamePly;
  const end = division.endgamePly;
  return [[0, mid ?? end ?? plies], mid === null ? [0, 0] : [mid, end ?? plies], end === null ? [0, 0] : [end, plies]];
}

/**
 * Accuracy per phase (R-ACC-02): opening = positions [0, middlegamePly], middlegame = [middlegamePly, endgamePly],
 * endgame = [endgamePly, plies] (a phase's last position is the next phase's first, so every move belongs to exactly
 * one phase). `gameAccuracy` re-runs on each slice. A phase in which `color` made fewer than 2 moves (including a
 * phase the game never reached) is `PHASE_NOT_REACHED`.
 */
export function phaseAccuracy(
  series: readonly number[],
  color: Color,
  startMover: Color,
  division: { middlegamePly: number | null; endgamePly: number | null },
): [number, number, number] {
  return phaseBounds(series.length - 1, division).map(([from, to]) => {
    if (to - from < 1 || movesBy(color, startMover, from, to) < 2) return PHASE_NOT_REACHED;
    const acc = gameAccuracy(series.slice(from, to + 1), color, moverAt(from, startMover));
    return acc ?? PHASE_NOT_REACHED;
  }) as [number, number, number];
}
