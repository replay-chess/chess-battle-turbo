// The game-over coach line (phase-03 plan §8.7 "Game-over coach line", COV C-02): one sentence, ≤ 160 characters,
// shown on the result card. First match:
//   1. a legend game the member played exactly as the legend did, to the legend's last move:
//      "{finalMove} finished it the way {legend} did in {year}." ("…the way Morphy did." without a year);
//   2. the game has moments: the turning-point sentence (summary.ts);
//   3. a clean game: the best-decision sentence (clean.ts), or the clean-loss line when there is none and the member
//      lost;
//   4. "Nothing big to fix in this one."
// A candidate longer than COACH_LINE_MAX falls through to the next rule.

import { CLEAN_LOSS_LINE, moveText } from "./clean";
import { NOTHING_TO_FIX, type MemberResult } from "./summary";

export const COACH_LINE_MAX = 160;

export interface CoachLineInput {
  /** Set only when the member's moves equal the legend's to the legend's final move (legend/compare.ts). */
  legendFinish: { name: string; year: number | null; ply: number; startPly: number; san: string } | null;
  turningPoint: string | null;
  isClean: boolean;
  bestDecision: string | null;
  result: MemberResult | null;
}

export function coachLineText(c: CoachLineInput): string {
  const candidates: (string | null)[] = [];
  if (c.legendFinish) {
    const l = c.legendFinish;
    const when = l.year === null ? "" : ` in ${l.year}`;
    candidates.push(`${moveText(l.ply, l.startPly, l.san)} finished it the way ${l.name} did${when}.`);
  }
  candidates.push(c.turningPoint);
  if (c.isClean) candidates.push(c.bestDecision ?? (c.result === "loss" ? CLEAN_LOSS_LINE : null));
  for (const s of candidates) if (s && s.length <= COACH_LINE_MAX) return s;
  return NOTHING_TO_FIX;
}
