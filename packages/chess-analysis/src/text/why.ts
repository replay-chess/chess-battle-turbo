// The moment's explanation (phase-03 plan §8.7 "Moment why"): 1–3 sentences, each a fact from the engine line, the
// game or the stored arrays. Never invented: every SAN is produced by playing the move with chess.js in its
// position, every number comes from the evals.
//
// 1. What the engine's move does (the best line, pass 2):
//    - the position was a forced mate for the member: "{bestSan} starts a forced mate in {n}." ("{bestSan} is mate."
//      for a mate in 1);
//    - the move captures and comes out ahead in the exchange: "{bestSan} wins the {piece} on {sq}.";
//    - otherwise its plan fact (intent.ts): "{bestSan} protects the bishop on e3."
// 2. What the played move allowed, from the opponent's best reply to it (the stored best move of the next
//    position): "After {playedSan}, {replySan} {wins material | leaves you with doubled pawns | gives a check}."
//    Material = the member is net down ≥ 1 once the exchange on the reply's square settles; doubled pawns = the
//    reply captures, the member's cheapest recapture is a pawn, and it doubles a file. Omitted when none applies.
// 3. The cost: "You lose about {d} win% points, so this is {…}." with an inaccuracy → "an inaccuracy, not a
//    disaster"; a mistake → "a mistake"; a blunder → "a blunder", or "the move that decided the game" only when all
//    three facts support it: the member went on to lose the game, the position was not already lost before the move
//    (Win% before ≥ 30) and it is lost after it (Win% after < 30). A member who later won or drew is never told a
//    move decided the game. A miss → "a missed chance". When the member had a forced mate and let it go (the
//    mate-lost rule), the sentence says so instead: "You had a forced mate here and let it slip, so this is {…}."

import { Chess, type Move, type Square } from "chess.js";
import type { PieceType } from "../board";
import type { GradeRule } from "../classify";
import { OUTCOME_CLASS } from "../classify";
import { evalFor, J, mateMoves, type Color, type JudgementCode } from "../codec";
import type { IntentResult } from "../intent";
import type { MemberResult } from "./summary";
import { doubledFiles, exchangeGain, PIECE_NAME, play, replyLoss, sentence, type Sentence, value } from "./facts";

export interface WhyInput {
  fenBefore: string;
  member: Color;
  playedUci: string;
  bestUci: string;
  /** Stored eval of the position before the move (White POV). */
  evalBefore: number;
  /** The opponent's best reply to the played move (UCI), or null when unknown. */
  replyUci: string | null;
  code: JudgementCode;
  rule: GradeRule;
  loss: number;
  /** The member's Win% before and after the move. */
  winBefore: number;
  winAfter: number;
  /** How the game ended for the member (null = unknown, e.g. a game still being imported). */
  result: MemberResult | null;
  intent: IntentResult;
}

function bestLineSentence(w: WhyInput): string {
  const best = play(w.fenBefore, w.bestUci);
  if (!best) throw new RangeError(`illegal move ${w.bestUci} in ${w.fenBefore}`);
  const san = best.move.san;
  const mine = evalFor(w.evalBefore, w.member);
  const n = mateMoves(mine);
  if (n !== null && mine > 0 && n > 0) return n === 1 ? `${san} is mate.` : `${san} starts a forced mate in ${n}.`;
  if (best.move.captured && (exchangeGain(w.fenBefore, w.bestUci) ?? 0) > 0) {
    return `${san} wins the ${PIECE_NAME[best.move.captured as PieceType]} on ${capturedSquare(best.move)}.`;
  }
  return `${san} ${w.intent.fact}.`;
}

/** The square of the piece a capture takes: the target square, except en passant (the target's file, the mover's rank). */
export function capturedSquare(m: Move): Square {
  return m.isEnPassant() ? (`${m.to[0]}${m.from[1]}` as Square) : m.to;
}

/** Whether a blunder may be called "the move that decided the game" (see the header, step 3). */
export function decidedTheGame(w: Pick<WhyInput, "result" | "winBefore" | "winAfter">): boolean {
  return w.result === "loss" && w.winBefore >= OUTCOME_CLASS.HOLD_FROM && w.winAfter < OUTCOME_CLASS.HOLD_FROM;
}

/** The member's cheapest recapture on `sq` in `fen` (member to move), as UCI, or null. */
function cheapestRecapture(fen: string, sq: Square): string | null {
  const chess = new Chess(fen);
  let best: { uci: string; v: number } | null = null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== sq || !m.captured) continue;
    const v = value(m.piece);
    if (!best || v < best.v) best = { uci: `${m.from}${m.to}${m.promotion ?? ""}`, v };
  }
  return best?.uci ?? null;
}

function consequenceSentence(w: WhyInput): string | null {
  const r = replyLoss(w.fenBefore, w.playedUci, w.replyUci);
  if (!r || !w.replyUci) return null;
  const played = play(w.fenBefore, w.playedUci);
  if (!played) return null;
  const head = `After ${played.move.san}, ${r.replySan}`;
  if (r.net >= 1) return `${head} wins material.`;
  const reply = play(played.chess.fen(), w.replyUci);
  if (reply?.move.captured) {
    const afterReply = reply.chess.fen();
    const recapture = cheapestRecapture(afterReply, reply.move.to);
    const rc = recapture ? play(afterReply, recapture) : null;
    if (rc && rc.move.piece === "p" && doubledFiles(rc.chess.fen(), w.member) > doubledFiles(w.fenBefore, w.member)) {
      return `${head} leaves you with doubled pawns.`;
    }
  }
  if (r.check) return `${head} gives a check.`;
  return null;
}

function costSentence(w: WhyInput): string {
  const verdict =
    w.code === J.INACCURACY
      ? "an inaccuracy, not a disaster"
      : w.code === J.MISTAKE
        ? "a mistake"
        : w.code === J.MISS
          ? "a missed chance"
          : decidedTheGame(w)
            ? "the move that decided the game"
            : "a blunder";
  if (w.rule === "mate_lost") return `You had a forced mate here and let it slip, so this is ${verdict}.`;
  const d = Math.round(w.loss);
  return `You lose about ${d} win% ${d === 1 ? "point" : "points"}, so this is ${verdict}.`;
}

/** The "why" sentences of one moment (1–3). */
export function whySentences(w: WhyInput): Sentence[] {
  const out = [bestLineSentence(w)];
  const c = consequenceSentence(w);
  if (c) out.push(c);
  out.push(costSentence(w));
  return out.map(sentence);
}
