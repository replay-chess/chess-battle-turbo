// The moment's question (phase-03 plan §8.7 "Moment ask"): "Move {n}. {threatFact?} What would you play?"
//
// threatFact, first match (all facts from chess.js on the position before the member's move):
// 1. The opponent's last move put the moved piece on a square from which it attacks one of the member's pieces
//    that is under-protected (undefended, attacked more often than defended, or attacked by a cheaper piece):
//    "{Opp}’s {piece} on {sq} is eyeing your {piece} on {sq}." The most valuable such target is named.
// 2. The member can win material right now (a capture that comes out ahead in the exchange), i.e. the opponent's
//    last move left something hanging: "{Opp} just played {san}. Something was available here."
// 3. Otherwise, from the member's Win% before the move: above 60 "You are better here.", below 40 "You are under
//    pressure.", else "The position is still close."
//
// {Opp} is the opponent's colour ("Black’s knight"), as on the design board. A moment at the first ply of a game
// (no previous move) skips 1 and 2.

import { Chess, type Square } from "chess.js";
import type { PieceType } from "../board";
import type { Color } from "../codec";
import {
  APOS,
  attackersOf,
  COLOR_NAME,
  exchangeGain,
  other,
  PIECE_NAME,
  piecesOf,
  underProtected,
  value,
} from "./facts";

/** Win% bands of the fallback sentence. */
export const ASK_BETTER_ABOVE = 60;
export const ASK_PRESSURE_BELOW = 40;
/** ReviewContentV1 moments[].ask is ≤ 300 characters. */
export const ASK_MAX = 300;

export interface AskInput {
  /** The position before the member's move (the member is to move). */
  fenBefore: string;
  /** The opponent's previous move (UCI, played from the position before it), or null at the first ply. */
  lastMove: { uci: string; san: string } | null;
  /** Move number of the member's move (§8.1 moveNo). */
  moveNo: number;
  /** The member's Win% before the move. */
  winBefore: number;
}

function threat(chess: Chess, member: Color, lastTo: Square): string | null {
  const opp = other(member);
  const mover = chess.get(lastTo);
  if (!mover || mover.color !== opp) return null;
  let target: { sq: Square; type: PieceType } | null = null;
  for (const p of piecesOf(chess, member)) {
    if (p.type === "k") continue;
    if (!attackersOf(chess, p.sq, opp).includes(lastTo)) continue;
    if (!underProtected(chess, p.sq, member)) continue;
    if (!target || value(p.type) > value(target.type)) target = p;
  }
  if (!target) return null;
  return (
    `${COLOR_NAME[opp]}${APOS}s ${PIECE_NAME[mover.type as PieceType]} on ${lastTo} ` +
    `is eyeing your ${PIECE_NAME[target.type]} on ${target.sq}.`
  );
}

function hasWinningCapture(chess: Chess, fen: string): boolean {
  return chess
    .moves({ verbose: true })
    .some(
      (m) => (m.captured || m.isEnPassant()) && (exchangeGain(fen, `${m.from}${m.to}${m.promotion ?? ""}`) ?? 0) > 0,
    );
}

/** The situation sentence of the ask (without "Move n." and the question). */
export function threatFact(input: AskInput): string {
  const chess = new Chess(input.fenBefore);
  const member = chess.turn();
  if (input.lastMove) {
    const t = threat(chess, member, input.lastMove.uci.slice(2, 4) as Square);
    if (t) return t;
    if (hasWinningCapture(chess, input.fenBefore)) {
      return `${COLOR_NAME[other(member)]} just played ${input.lastMove.san}. Something was available here.`;
    }
  }
  if (input.winBefore > ASK_BETTER_ABOVE) return "You are better here.";
  if (input.winBefore < ASK_PRESSURE_BELOW) return "You are under pressure.";
  return "The position is still close.";
}

/** "Move 19. Black just played Bg3. Something was available here. What would you play?" */
export function askText(input: AskInput): string {
  return `Move ${input.moveNo}. ${threatFact(input)} What would you play?`;
}
