// Win% from a stored eval (phase-03 plan §8.1, §8.2; the published Lichess "Accuracy" description, re-implemented
// under the clean-room rules: the constant and the curve come from the published documentation, not from code).
//
// Input is always a stored eval (codec.ts): centipawns, or a mate score sign·(30000 − n). Mates count as ±1000 cp
// and centipawns are clamped to ±1000 (R-ENG-02), so Win% ∈ [2.46, 97.54].

import { MATE_THRESHOLD, NO_SECOND } from "./codec";

export const WIN_K = 0.00368208;
/** The centipawn clamp of the Win% curve (and the value a mate counts as). */
export const WIN_CP_CLAMP = 1000;

/** Stored eval → the centipawns the Win% curve sees: mate → ±1000, centipawns clamped to ±1000. */
export function cpOf(e: number): number {
  if (!Number.isFinite(e) || e === NO_SECOND) throw new RangeError(`not an eval: ${e}`);
  if (Math.abs(e) >= MATE_THRESHOLD) return Math.sign(e) * WIN_CP_CLAMP;
  return Math.max(-WIN_CP_CLAMP, Math.min(WIN_CP_CLAMP, e));
}

/** Winning chances ∈ [−1, 1] of a stored eval (same POV as the eval). */
export function winningChances(e: number): number {
  return 2 / (1 + Math.exp(-WIN_K * cpOf(e))) - 1;
}

/** Win% ∈ [2.46, 97.54] of a stored eval (same POV as the eval). */
export function winPct(e: number): number {
  return 50 + 50 * winningChances(e);
}

/** Win% series (White POV) of a list of stored evals (White POV). */
export function winSeries(evals: readonly number[]): number[] {
  return evals.map(winPct);
}
