/**
 * Board geometry (P2 plan §4.5.1): squares, display positions for both
 * orientations, FEN placement parsing and the piece diff that drives the slide
 * animation. Pure, no DOM; unit-tested in geometry.test.ts.
 */
import type { FileChar, PieceCode, PieceType, RankChar, Side, Sq } from "./types";

export const FILES: readonly FileChar[] = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** All 64 squares, a8..h8, a7..h1 (FEN order). */
export const SQUARES: readonly Sq[] = (() => {
  const out: Sq[] = [];
  for (let r = 8; r >= 1; r--) for (const f of FILES) out.push(`${f}${r as RankChar}`);
  return out;
})();

export const PIECE_NAMES: Record<PieceType, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

export function isSq(v: unknown): v is Sq {
  return typeof v === "string" && /^[a-h][1-8]$/.test(v);
}

export function fileIndex(sq: Sq): number {
  return sq.charCodeAt(0) - 97;
}

export function rankOf(sq: Sq): number {
  return sq.charCodeAt(1) - 48;
}

export function makeSq(file: number, rank: number): Sq | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]!}${rank as RankChar}`;
}

/** 0..63 in FEN order (a8 = 0, h1 = 63). */
export function sqToIndex(sq: Sq): number {
  return (8 - rankOf(sq)) * 8 + fileIndex(sq);
}

export function indexToSq(i: number): Sq {
  return SQUARES[i]!;
}

export function isDarkSquare(sq: Sq): boolean {
  return (fileIndex(sq) + rankOf(sq)) % 2 === 1;
}

/** Display column and row (0..7, top-left origin) for an orientation. */
export function displayPos(sq: Sq, orientation: Side): { col: number; row: number } {
  const f = fileIndex(sq);
  const r = rankOf(sq);
  return orientation === "w" ? { col: f, row: 8 - r } : { col: 7 - f, row: r - 1 };
}

export function squareAtDisplay(col: number, row: number, orientation: Side): Sq | null {
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return orientation === "w" ? makeSq(col, 8 - row) : makeSq(7 - col, row + 1);
}

/** Square under a point given as fractions of the board box (0..1). Outside → null. */
export function squareAtPoint(fx: number, fy: number, orientation: Side): Sq | null {
  if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) return null;
  return squareAtDisplay(Math.floor(fx * 8), Math.floor(fy * 8), orientation);
}

/** Top-left corner of a square in % of the board. */
export function squarePct(sq: Sq, orientation: Side): { left: number; top: number } {
  const { col, row } = displayPos(sq, orientation);
  return { left: col * 12.5, top: row * 12.5 };
}

/** Centre of a square in ArrowLayer units (viewBox 0 0 800 800, one square = 100). */
export function squareCenter(sq: Sq, orientation: Side): { x: number; y: number } {
  const { col, row } = displayPos(sq, orientation);
  return { x: col * 100 + 50, y: row * 100 + 50 };
}

/** Square order for rendering the grid: display rows top to bottom, columns left to right. */
export function displayRows(orientation: Side): Sq[][] {
  const rows: Sq[][] = [];
  for (let row = 0; row < 8; row++) {
    const cells: Sq[] = [];
    for (let col = 0; col < 8; col++) cells.push(squareAtDisplay(col, row, orientation)!);
    rows.push(cells);
  }
  return rows;
}

/** Keyboard step on the visual grid (ArrowUp moves up the screen in either orientation). */
export function stepSquare(sq: Sq, key: string, orientation: Side): Sq {
  const { col, row } = displayPos(sq, orientation);
  const d: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  const step = d[key];
  if (!step) return sq;
  return squareAtDisplay(col + step[0], row + step[1], orientation) ?? sq;
}

// ── FEN placement ──────────────────────────────────────────────────────────────────────────

export type Placement = ReadonlyMap<Sq, PieceCode>;

export function placementKey(fen: string): string {
  return String(fen ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Piece placement of a FEN. Malformed input yields the squares it could read. */
export function parsePlacement(fen: string): Map<Sq, PieceCode> {
  const out = new Map<Sq, PieceCode>();
  const rows = placementKey(fen).split("/");
  for (let r = 0; r < 8 && r < rows.length; r++) {
    let file = 0;
    for (const ch of rows[r]!) {
      if (file > 7) break;
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (!"kqrbnp".includes(lower)) continue;
      const sq = makeSq(file, 8 - r);
      if (sq) out.set(sq, `${ch === lower ? "b" : "w"}${lower as PieceType}`);
      file++;
    }
  }
  return out;
}

export function sideToMove(fen: string): Side {
  return String(fen ?? "").trim().split(/\s+/)[1] === "b" ? "b" : "w";
}

export function pieceColor(p: PieceCode): Side {
  return p[0] as Side;
}

export function pieceType(p: PieceCode): PieceType {
  return p[1] as PieceType;
}

/** "White knight". */
export function pieceName(p: PieceCode): string {
  return `${pieceColor(p) === "w" ? "White" : "Black"} ${PIECE_NAMES[pieceType(p)]}`;
}

/** A pawn moving onto its last rank. */
export function isPromotionMove(placement: Placement, from: Sq, to: Sq): boolean {
  const p = placement.get(from);
  if (!p || pieceType(p) !== "p") return false;
  return rankOf(to) === (pieceColor(p) === "w" ? 8 : 1);
}

/** "e2e4", "e7e8q". Null when the text is not UCI. */
export function parseUci(text: string): { from: Sq; to: Sq; promotion?: "q" | "r" | "b" | "n" } | null {
  const m = /^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/i.exec(text.trim());
  if (!m) return null;
  const from = m[1]!.toLowerCase() as Sq;
  const to = m[2]!.toLowerCase() as Sq;
  const promotion = m[3]?.toLowerCase() as "q" | "r" | "b" | "n" | undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

// ── Piece diff (stable ids for the slide) ──────────────────────────────────────────────────

export interface PlacedPiece {
  id: string;
  piece: PieceCode;
  sq: Sq;
}

export interface DiffedPiece extends PlacedPiece {
  /** Where the piece slides from; absent = it did not move. */
  from?: Sq;
  /** The piece shown during the slide when it changes on arrival (promotion: the pawn). */
  fromPiece?: PieceCode;
}

export interface PieceDiff {
  pieces: DiffedPiece[];
  /** Pieces that left the board (captures, including the en passant pawn): they fade out. */
  removed: PlacedPiece[];
}

/** Initial ids: one per piece, named after its first square. */
export function placedPieces(fen: string): PlacedPiece[] {
  const out: PlacedPiece[] = [];
  for (const [sq, piece] of parsePlacement(fen)) out.push({ id: `${piece}@${sq}`, piece, sq });
  return out;
}

const dist = (a: Sq, b: Sq) => Math.abs(fileIndex(a) - fileIndex(b)) + Math.abs(rankOf(a) - rankOf(b));

/**
 * Matches the pieces of `prev` to the placement of `nextFen` and keeps their ids,
 * so the view can slide the ones that moved. `move` (the last move, if known)
 * decides ambiguous cases: castling moves the rook too (matched as the nearest
 * rook), en passant removes the pawn beside the target, and a promotion keeps
 * the pawn's id with `fromPiece` = the pawn. `gen` makes ids of new pieces unique.
 */
export function diffPieces(
  prev: string | readonly PlacedPiece[],
  nextFen: string,
  move?: { from: Sq; to: Sq } | null,
  gen = 0,
): PieceDiff {
  const before = typeof prev === "string" ? placedPieces(prev) : prev;
  const wants = [...parsePlacement(nextFen)].map(([sq, piece]) => ({ sq, piece }));
  const taken = new Set<number>();
  const result = new Map<number, DiffedPiece>();

  // 1. Unchanged squares.
  wants.forEach((w, wi) => {
    const j = before.findIndex((q, qi) => !taken.has(qi) && q.piece === w.piece && q.sq === w.sq);
    if (j >= 0) {
      taken.add(j);
      result.set(wi, { ...before[j]!, sq: w.sq });
    }
  });

  // 2. The known move (also a promotion: same colour, pawn → piece).
  if (move) {
    const wi = wants.findIndex((w, i) => !result.has(i) && w.sq === move.to);
    const j = before.findIndex((q, qi) => !taken.has(qi) && q.sq === move.from);
    if (wi >= 0 && j >= 0) {
      const w = wants[wi]!;
      const q = before[j]!;
      if (q.piece === w.piece) {
        taken.add(j);
        result.set(wi, { id: q.id, piece: w.piece, sq: w.sq, from: q.sq });
      } else if (pieceColor(q.piece) === pieceColor(w.piece) && pieceType(q.piece) === "p") {
        taken.add(j);
        result.set(wi, { id: q.id, piece: w.piece, sq: w.sq, from: q.sq, fromPiece: q.piece });
      }
    }
  }

  // 3. Same piece, nearest square (the castling rook, unhinted moves, multi-ply jumps).
  wants.forEach((w, wi) => {
    if (result.has(wi)) return;
    let best = -1;
    let bestD = Infinity;
    before.forEach((q, qi) => {
      if (taken.has(qi) || q.piece !== w.piece) return;
      const d = dist(q.sq, w.sq);
      if (d < bestD) {
        bestD = d;
        best = qi;
      }
    });
    if (best >= 0) {
      taken.add(best);
      const q = before[best]!;
      result.set(wi, { id: q.id, piece: w.piece, sq: w.sq, from: q.sq });
    }
  });

  // 4. A pawn of the same colour that vanished: an unhinted promotion.
  wants.forEach((w, wi) => {
    if (result.has(wi)) return;
    let best = -1;
    let bestD = Infinity;
    before.forEach((q, qi) => {
      if (taken.has(qi) || q.piece !== `${pieceColor(w.piece)}p`) return;
      const d = dist(q.sq, w.sq);
      if (d <= 2 && d < bestD) {
        bestD = d;
        best = qi;
      }
    });
    if (best >= 0) {
      taken.add(best);
      const q = before[best]!;
      result.set(wi, { id: q.id, piece: w.piece, sq: w.sq, from: q.sq, fromPiece: q.piece });
    }
  });

  // 5. New pieces (a setup change): appear without a slide.
  const pieces: DiffedPiece[] = wants.map(
    (w, wi) => result.get(wi) ?? { id: `${w.piece}@${w.sq}#${gen}`, piece: w.piece, sq: w.sq },
  );
  const removed = before.filter((_, qi) => !taken.has(qi));
  return { pieces, removed };
}
