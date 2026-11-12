// The clean game's best decision and the clean-loss line (phase-03 plan §8.6).
//
//   bestDecision  "Your best decision: {move}{suffix}." with move = "16.Qb8+" (move number and SAN) and suffix:
//                 a BRILLIANT after which the member has a forced mate → ", a sacrifice that forced mate";
//                 any other BRILLIANT → ", a sound sacrifice" (the BRILLIANT reason, §8.4);
//                 a GREAT → ", the only move that held";
//                 otherwise nothing.
//   clean_loss    "You kept the balance; the result came from elsewhere." for a clean game the member lost (no
//                 moment to learn from, yet the result went the other way: a flag, a late resignation).
// For the Opera fixture: "Your best decision: 16.Qb8+, a sacrifice that forced mate."

import { evalFor, isMateEval, J, moveLabel, type Color, type JudgementCode } from "../codec";

export const CLEAN_LOSS_LINE = "You kept the balance; the result came from elsewhere.";
/** ReviewContentV1 `bestDecision` is ≤ 200 characters. */
export const BEST_DECISION_MAX = 200;

export interface BestDecisionInput {
  /** Ply offset of the best decision (moments.ts bestPly). */
  ply: number;
  startPly: number;
  san: string;
  code: JudgementCode;
  /** Stored eval after the ply (White POV). */
  evalAfter: number;
  member: Color;
}

/** "16.Qb8+": the move label and SAN of a ply. */
export function moveText(ply: number, startPly: number, san: string): string {
  return `${moveLabel(ply, startPly)}${san}`;
}

export function bestDecisionText(b: BestDecisionInput): string {
  const after = evalFor(b.evalAfter, b.member);
  const suffix =
    b.code === J.BRILLIANT
      ? isMateEval(after) && after > 0
        ? ", a sacrifice that forced mate"
        : ", a sound sacrifice"
      : b.code === J.GREAT
        ? ", the only move that held"
        : "";
  return `Your best decision: ${moveText(b.ply, b.startPly, b.san)}${suffix}.`;
}
