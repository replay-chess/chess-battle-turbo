// Board facts the grader reads straight from a FEN: piece placement, material, EPD (phase-03 plan §8.1, §8.4).
// Pure string work: no move generation (see.ts and replay.ts use chess.js for that).

import type { Color } from "./codec";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface Piece {
  type: PieceType;
  color: Color;
}

/** Material values of the sacrifice check and SEE (§8.4: 1/3/3/5/9; the king is never captured). */
export const PIECE_VALUE: Readonly<Record<PieceType, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** EPD = the first four FEN fields (placement, side to move, castling, en passant); keys caches, book, repetition. */
export function epdOf(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new RangeError(`invalid FEN ${JSON.stringify(fen)}`);
  return parts.slice(0, 4).join(" ");
}

export function sideToMove(fen: string): Color {
  const stm = fen.trim().split(/\s+/)[1];
  if (stm !== "w" && stm !== "b") throw new RangeError(`invalid FEN ${JSON.stringify(fen)}`);
  return stm;
}

/** True when the FEN is the standard initial position (placement, side, castling and en passant all equal). */
export function isInitialPosition(fen: string): boolean {
  return epdOf(fen) === epdOf(INITIAL_FEN);
}

/** Placement field → 64 squares (index a1 = 0, h1 = 7, a8 = 56), `null` for empty. */
export function placement(fen: string): (Piece | null)[] {
  const field = fen.trim().split(/\s+/)[0] ?? "";
  const ranks = field.split("/");
  if (ranks.length !== 8) throw new RangeError(`invalid FEN placement ${JSON.stringify(field)}`);
  const squares: (Piece | null)[] = new Array<Piece | null>(64).fill(null);
  ranks.forEach((row, r) => {
    const rank = 7 - r;
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (!"pnbrqk".includes(lower) || file > 7) throw new RangeError(`invalid FEN placement ${JSON.stringify(field)}`);
      squares[file + 8 * rank] = { type: lower as PieceType, color: ch === lower ? "b" : "w" };
      file++;
    }
    if (file !== 8) throw new RangeError(`invalid FEN placement ${JSON.stringify(field)}`);
  });
  return squares;
}

/** Material of each side (1/3/3/5/9). */
export function material(fen: string): { w: number; b: number } {
  const m = { w: 0, b: 0 };
  for (const p of placement(fen)) if (p) m[p.color] += PIECE_VALUE[p.type];
  return m;
}

/** Material balance from `side`'s point of view (own − opponent's). */
export function materialBalance(fen: string, side: Color): number {
  const m = material(fen);
  return side === "w" ? m.w - m.b : m.b - m.w;
}
