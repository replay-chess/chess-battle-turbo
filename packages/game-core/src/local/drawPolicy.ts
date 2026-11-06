// Bot draw policy and think time (plan 8.15, owner Q11).

import { BOT_DRAW_MAX_EVAL_CP, BOT_DRAW_MIN_OFFER_PLIES, BOT_DRAW_MIN_PLIES, BOT_DRAW_EVAL_NODES } from "../constants";

/** The quick search used to answer a draw offer. */
export const DRAW_EVAL_GO = `go nodes ${BOT_DRAW_EVAL_NODES}`;

/** A draw offer to the bot needs at least two plies. */
export function canOfferDrawToBot(plies: number): boolean {
  return plies >= BOT_DRAW_MIN_OFFER_PLIES;
}

/** Accept iff plies ≥ 60 and |eval| < 30 cp. */
export function botAcceptsDraw(opts: { plies: number; evalCp: number | null }): boolean {
  if (opts.evalCp === null || !Number.isFinite(opts.evalCp)) return false;
  return opts.plies >= BOT_DRAW_MIN_PLIES && Math.abs(opts.evalCp) < BOT_DRAW_MAX_EVAL_CP;
}

/** The answer comes after a random 1.5–2.5 s. `rand` ∈ [0, 1). */
export function drawAnswerDelayMs(rand: number): number {
  return 1500 + Math.max(0, Math.min(1, rand)) * 1000;
}

/**
 * Delay after the search returns: clamp(450 + rand·400 + 150·(legalMoves > 30), 300, min(2000, 0.02 × remaining)).
 * With very little time the upper bound wins (the bot moves fast). Untimed games use 450–850 ms.
 */
export function botThinkDelayMs(opts: { rand: number; legalMoves: number; remainingMs: number | null }): number {
  const r = Math.max(0, Math.min(1, opts.rand));
  if (opts.remainingMs === null) return 450 + r * 400;
  const raw = 450 + r * 400 + (opts.legalMoves > 30 ? 150 : 0);
  const hi = Math.min(2000, 0.02 * Math.max(0, opts.remainingMs));
  return Math.min(Math.max(raw, 300), hi);
}
