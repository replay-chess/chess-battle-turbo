// One-line reason per graded ply (phase-03 plan §8.4 "Reason templates", R-CLS-08): the `curReason` the move list
// shows next to the badge ("19.Qd2 · Miss. Missed Rxf5, which wins a bishop.").
//
//   Book        "Known opening theory."
//   Forced      "The only legal move."
//   Best        "The engine’s top choice."
//   Excellent   "Almost as good as the engine’s move, {bestSan}."
//   Good        "Fine; {bestSan} was a little better."
//   Great       "The only move that keeps {the win | the draw | the hold}."
//   Brilliant   "A sound sacrifice."
//   Inaccuracy / Mistake / Blunder   "Engine preferred {bestSan}."
//   Miss        "Missed {bestSan}{, which wins a {piece} | , a mate in {n}}."
//   ungraded    "Not graded yet. Still analysing this move."
//
// GREAT's object comes from the outcome class the move keeps (classify.ts OUTCOME_CLASS): Win% ≥ 70 "the win";
// 40 ≤ Win% < 70 "the draw"; below 40 (still ≥ 30, or it would not be GREAT) "the hold". When the best move is
// unknown (Lichess-eval imports) the templates drop the SAN rather than invent one. INTERESTING is never emitted in
// GRADING_VERSION 1 (P3-D15) but keeps a text so a later version needs no template change.
//
// Pure apart from chess.js: the web can build the same line on the client from the review payload.

import type { PieceType } from "../board";
import { evalFor, J, mateMoves, type Color, type JudgementCode } from "../codec";
import { OUTCOME_CLASS } from "../classify";
import { APOS, article, exchangeGain, PIECE_NAME, play } from "./facts";

/** Win% from which GREAT reads "keeps the draw" instead of "keeps the hold". */
export const GREAT_DRAW_FROM = 40;

export type MissGain = { kind: "piece"; piece: PieceType } | { kind: "mate"; moves: number };

export interface ReasonInput {
  code: JudgementCode;
  /** SAN of the engine's best move in the position before the ply; null when unknown. */
  bestSan: string | null;
  /** The mover's Win% before the ply (GREAT's object). */
  winBefore?: number;
  /** What the missed move would have won (MISS). */
  miss?: MissGain | null;
}

export const UNGRADED_REASON = "Not graded yet. Still analysing this move.";

function greatObject(winBefore: number | undefined): string {
  const w = winBefore ?? 50;
  if (w >= OUTCOME_CLASS.WIN_FROM) return "the win";
  if (w >= GREAT_DRAW_FROM) return "the draw";
  return "the hold";
}

/** The reason line of one ply. */
export function reasonText(r: ReasonInput): string {
  const best = r.bestSan;
  switch (r.code) {
    case J.UNGRADED:
      return UNGRADED_REASON;
    case J.BOOK:
      return "Known opening theory.";
    case J.FORCED:
      return "The only legal move.";
    case J.BEST:
      return `The engine${APOS}s top choice.`;
    case J.EXCELLENT:
      return best
        ? `Almost as good as the engine${APOS}s move, ${best}.`
        : `Almost as good as the engine${APOS}s move.`;
    case J.GOOD:
      return best ? `Fine; ${best} was a little better.` : "Fine; the engine had a slightly better move.";
    case J.GREAT:
      return `The only move that keeps ${greatObject(r.winBefore)}.`;
    case J.BRILLIANT:
      return "A sound sacrifice.";
    case J.INTERESTING:
      return "An interesting try.";
    case J.INACCURACY:
    case J.MISTAKE:
    case J.BLUNDER:
      return best ? `Engine preferred ${best}.` : "The engine had a better move.";
    case J.MISS: {
      if (!best) return "Missed a chance here.";
      const m = r.miss;
      if (m?.kind === "mate") return `Missed ${best}, a mate in ${m.moves}.`;
      if (m?.kind === "piece") return `Missed ${best}, which wins ${article(PIECE_NAME[m.piece])}.`;
      return `Missed ${best}.`;
    }
    default:
      throw new RangeError(`invalid JudgementCode ${String(r.code)}`);
  }
}

/**
 * What playing `bestUci` would have gained, for MISS: a forced mate when the stored eval before the ply is a mate
 * for the mover, else the piece the move wins outright (a capture that comes out ahead in the exchange), else null.
 */
export function missGain(fenBefore: string, bestUci: string | null, evalBefore: number, mover: Color): MissGain | null {
  const mine = evalFor(evalBefore, mover);
  const n = mateMoves(mine);
  if (n !== null && mine > 0 && n > 0) return { kind: "mate", moves: n };
  if (!bestUci) return null;
  const p = play(fenBefore, bestUci);
  if (!p?.move.captured) return null;
  const gain = exchangeGain(fenBefore, bestUci) ?? 0;
  return gain > 0 ? { kind: "piece", piece: p.move.captured as PieceType } : null;
}

/** The full reason input of one ply from the position, the stored best move and evals. */
export function plyReason(args: {
  code: JudgementCode;
  fenBefore: string;
  bestUci: string | null;
  evalBefore: number;
  mover: Color;
  winBefore: number;
}): string {
  const bestSan = args.bestUci ? (play(args.fenBefore, args.bestUci)?.move.san ?? null) : null;
  const miss = args.code === J.MISS ? missGain(args.fenBefore, args.bestUci, args.evalBefore, args.mover) : null;
  return reasonText({ code: args.code, bestSan, winBefore: args.winBefore, miss });
}
