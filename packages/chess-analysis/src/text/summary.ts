// The narrated summary (phase-03 plan §8.7 "Summary"): 2–4 sentences, engine facts only.
//
// 1. Accuracy: "You played at {acc} accuracy{; your opponent at {oppAcc}}." and, when one phase is at least 10 points
//    above the game accuracy, "Your {phase} was the strongest part ({phaseAcc})." (the highest such phase).
// 2. Turning point, from the worst moment (moments.ts worstMoment):
//    "The game turned on move {n}, when {playedSan} {fact}." where fact, first match:
//      a MISS                                          → "missed {bestSan}"
//      the member had a forced mate and let it go      → "let a forced mate slip"
//      the move allowed a forced mate                  → "let {Opp} force mate"
//      the opponent's best reply wins material         → "lost {a bishop | a bishop for a pawn | the exchange | …}"
//      otherwise                                        → "missed {bestSan}"
// 3. Close: "{N} moments are worth a second look." ("1 moment is …") / "Nothing big to fix in this one." / for a
//    clean game the member lost, the clean_loss line (clean.ts).
// All accuracies are shown rounded (R-ACC-04).

import type { GradeRule } from "../classify";
import { evalFor, isMateEval, J, moveNo, type Color, type JudgementCode } from "../codec";
import { CLEAN_LOSS_LINE } from "./clean";
import { COLOR_NAME, other, play, replyLoss, sentence, tradePhrase, type Sentence } from "./facts";
import { PHASE_NAMES } from "./phase";

/** A phase must be this many points above the game accuracy to be called the strongest part. */
export const STRONG_PHASE_MARGIN = 10;
export const NOTHING_TO_FIX = "Nothing big to fix in this one.";

export type MemberResult = "win" | "loss" | "draw";

export interface TurningPointInput {
  ply: number;
  startPly: number;
  fenBefore: string;
  member: Color;
  playedUci: string;
  bestUci: string | null;
  /** The opponent's best reply to the played move (UCI), or null when unknown. */
  replyUci: string | null;
  code: JudgementCode;
  rule: GradeRule;
  /** Stored eval after the ply (White POV). */
  evalAfter: number;
}

/** The fact part of the turning-point sentence ("missed Rxf5"). */
export function turningPointFact(t: TurningPointInput): string {
  const bestSan = t.bestUci ? (play(t.fenBefore, t.bestUci)?.move.san ?? null) : null;
  if (t.code === J.MISS && bestSan) return `missed ${bestSan}`;
  if (t.rule === "mate_lost") return "let a forced mate slip";
  const after = evalFor(t.evalAfter, t.member);
  if (isMateEval(after) && after < 0) return `let ${COLOR_NAME[other(t.member)]} force mate`;
  const r = replyLoss(t.fenBefore, t.playedUci, t.replyUci);
  // The whole trade, so a piece the member wins back on the reply's square is named too (regression:
  // turning-point-ignores-recapture, FIX-2).
  const trade = r && r.net >= 1 ? tradePhrase(r.lostPieces, r.gainedPieces) : null;
  if (trade) return `lost ${trade}`;
  if (bestSan) return `missed ${bestSan}`;
  return "let the game slip";
}

/** "The game turned on move 19, when Qd2 missed Rxf5." */
export function turningPointSentence(t: TurningPointInput): string {
  const played = play(t.fenBefore, t.playedUci);
  if (!played) throw new RangeError(`illegal move ${t.playedUci} in ${t.fenBefore}`);
  return `The game turned on move ${moveNo(t.ply, t.startPly)}, when ${played.move.san} ${turningPointFact(t)}.`;
}

export interface SummaryInput {
  /** The member's game accuracy (unrounded; null for a game too short to measure). */
  accuracy: number | null;
  oppAccuracy: number | null;
  /** The member's phase accuracy (−1 = not reached). */
  phaseAccuracy: readonly number[];
  /** The turning-point sentence, when the game has moments. */
  turningPoint: string | null;
  momentsCount: number;
  isClean: boolean;
  result: MemberResult | null;
}

function accuracySentences(s: SummaryInput): string[] {
  if (s.accuracy === null) return [];
  const acc = Math.round(s.accuracy);
  const opp = s.oppAccuracy === null ? "" : `; your opponent at ${Math.round(s.oppAccuracy)}`;
  const out = [`You played at ${acc} accuracy${opp}.`];
  let strongest: { k: number; a: number } | null = null;
  s.phaseAccuracy.forEach((raw, k) => {
    if (raw < 0) return;
    const a = Math.round(raw);
    if (a >= acc + STRONG_PHASE_MARGIN && (!strongest || a > strongest.a)) strongest = { k, a };
  });
  const st = strongest as { k: number; a: number } | null;
  if (st) out.push(`Your ${PHASE_NAMES[st.k]} was the strongest part (${st.a}).`);
  return out;
}

function closeSentence(s: SummaryInput): string {
  if (s.momentsCount === 1) return "1 moment is worth a second look.";
  if (s.momentsCount > 1) return `${s.momentsCount} moments are worth a second look.`;
  if (s.isClean && s.result === "loss") return CLEAN_LOSS_LINE;
  return NOTHING_TO_FIX;
}

/** The summary sentences (≤ 4). */
export function summarySentences(s: SummaryInput): Sentence[] {
  const out = accuracySentences(s);
  if (s.turningPoint) out.push(s.turningPoint);
  out.push(closeSentence(s));
  return out.map(sentence);
}
