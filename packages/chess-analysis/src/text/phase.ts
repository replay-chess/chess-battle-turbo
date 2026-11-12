// The phase line (phase-03 plan §8.7 "Phase line"): one token per phase, joined with " · ", first letter upper case:
// "Opening equal · middlegame lost the thread · endgame not reached".
//
// Per phase, from the member's phase accuracy a (accuracy.ts `phaseAccuracy`, −1 = not reached) and the Win% swing
// s = Win% at the phase's last position − Win% at its first position (member POV), first match:
//   not reached   "{phase} not reached"
//   s ≤ −25       "{phase} lost the thread"
//   s ≥ +25       "{phase} won it"
//   a ≥ 90        "{phase} solid"
//   a ≥ 75        "{phase} equal"
//   else          "{phase} slipped"
// The accuracy compared is the rounded one the screens show. The phase slices are `phaseBounds` (accuracy.ts), the
// same ones phase accuracy is computed on.

import { PHASE_NOT_REACHED, phaseBounds } from "../accuracy";
import type { Color } from "../codec";

export const PHASE_NAMES = ["opening", "middlegame", "endgame"] as const;
export const PHASE_SWING = 25;
export const PHASE_SOLID_FROM = 90;
export const PHASE_EQUAL_FROM = 75;
/** ReviewContentV1 `phaseLine` is ≤ 120 characters. */
export const PHASE_LINE_MAX = 120;

export interface PhaseLineInput {
  /** White-POV Win% per position 0 … plies (winpct.ts winSeries). */
  series: readonly number[];
  division: { middlegamePly: number | null; endgamePly: number | null };
  /** The member's phase accuracy (accuracy.ts phaseAccuracy; −1 = not reached). */
  phaseAccuracy: readonly [number, number, number] | readonly number[];
  side: Color;
}

function token(name: string, acc: number, swing: number): string {
  if (acc === PHASE_NOT_REACHED) return `${name} not reached`;
  if (swing <= -PHASE_SWING) return `${name} lost the thread`;
  if (swing >= PHASE_SWING) return `${name} won it`;
  const a = Math.round(acc);
  if (a >= PHASE_SOLID_FROM) return `${name} solid`;
  if (a >= PHASE_EQUAL_FROM) return `${name} equal`;
  return `${name} slipped`;
}

/** The Win% swing of each phase from the member's point of view (0 for a phase not reached). */
export function phaseSwings(input: Omit<PhaseLineInput, "phaseAccuracy">): [number, number, number] {
  const mine = (i: number) => {
    const w = input.series[i] as number;
    return input.side === "w" ? w : 100 - w;
  };
  return phaseBounds(input.series.length - 1, input.division).map(([from, to]) =>
    to > from ? mine(to) - mine(from) : 0,
  ) as [number, number, number];
}

export function phaseLine(input: PhaseLineInput): string {
  const swings = phaseSwings(input);
  const tokens = PHASE_NAMES.map((name, k) => token(name, input.phaseAccuracy[k] ?? PHASE_NOT_REACHED, swings[k]!));
  const line = tokens.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
