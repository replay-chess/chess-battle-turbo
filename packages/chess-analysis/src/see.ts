// Static exchange evaluation (phase-03 plan §8.4, task A4): the material the side to move can win by capturing on
// one square and letting the exchange run, each side always recapturing with its least valuable piece and free to
// stop when continuing would lose material.
//
// Built on chess.js legal moves rather than attack bitboards, so pins, x-rays (a slider behind the first capturer)
// and king captures into defended squares are handled by the move generator. Values: 1/3/3/5/9 (board.ts); a pawn
// capturing onto the last rank promotes to a queen and gains the difference. En passant captures are not part of an
// exchange on the target square (the captured pawn is elsewhere) and are ignored.

import { Chess, type Move, type Square } from "chess.js";
import { PIECE_VALUE, type PieceType } from "./board";

function leastValuableCapture(chess: Chess, sq: Square): Move | null {
  let best: Move | null = null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== sq || !m.captured || m.isEnPassant()) continue;
    if (m.promotion && m.promotion !== "q") continue;
    if (!best || PIECE_VALUE[m.piece as PieceType] < PIECE_VALUE[best.piece as PieceType]) best = m;
  }
  return best;
}

function seeOn(chess: Chess, sq: Square): number {
  const m = leastValuableCapture(chess, sq);
  if (!m) return 0;
  const captured = PIECE_VALUE[m.captured as PieceType];
  const promo = m.promotion ? PIECE_VALUE.q - PIECE_VALUE.p : 0;
  chess.move(m);
  const reply = seeOn(chess, sq);
  chess.undo();
  return Math.max(0, captured + promo - reply);
}

/** Material the side to move wins (≥ 0) by starting an exchange on `square` in `fen`. 0 when it cannot capture. */
export function see(fen: string, square: string): number {
  return seeOn(new Chess(fen), square as Square);
}

/** The settled exchange on one square: its value (as `see`) and the piece captured at each step, side to move first. */
export interface SeeExchange {
  value: number;
  /** Captured piece types in order; even indexes are the side to move's captures, odd ones the opponent's. */
  captures: PieceType[];
}

function exchangeOn(chess: Chess, sq: Square): SeeExchange {
  const m = leastValuableCapture(chess, sq);
  if (!m) return { value: 0, captures: [] };
  const captured = PIECE_VALUE[m.captured as PieceType];
  const promo = m.promotion ? PIECE_VALUE.q - PIECE_VALUE.p : 0;
  chess.move(m);
  const reply = exchangeOn(chess, sq);
  chess.undo();
  const gain = captured + promo - reply.value;
  // The side to move stops rather than start an exchange that does not win material (the same choice as `seeOn`).
  if (gain <= 0) return { value: 0, captures: [] };
  return { value: gain, captures: [m.captured as PieceType, ...reply.captures] };
}

/**
 * The exchange `see` evaluates, with the pieces each side takes: what the side to move wins on `square` and the
 * captures of the line both sides play when each recaptures with its least valuable piece and stops when continuing
 * would lose material. `see(fen, sq) === seeExchange(fen, sq).value`.
 */
export function seeExchange(fen: string, square: string): SeeExchange {
  return exchangeOn(new Chess(fen), square as Square);
}
