// Thin wrapper over chess.js 1.4 (plan 8): UCI parsing, replay, legal and premove destinations, SAN.
// Sessions are always rebuilt by REPLAYING moves from the start FEN (never by loading a later FEN), so threefold
// repetition keeps its history (socket audit §10).

import { Chess, validateFen, type Move, type PieceSymbol, type Square } from "chess.js";
import { INITIAL_FEN } from "../constants";
import type { Side } from "../machine/types";

export type { Move, PieceSymbol, Square };
export { Chess };

export const FILES = "abcdefgh";
export const SQUARES: readonly Square[] = Array.from({ length: 64 }, (_, i) => {
  const file = FILES[i % 8]!;
  const rank = 8 - Math.floor(i / 8);
  return `${file}${rank}` as Square;
});

export interface UciMove {
  from: Square;
  to: Square;
  promotion?: "q" | "r" | "b" | "n";
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function parseUci(uci: string): UciMove | null {
  const m = UCI_RE.exec(uci);
  if (!m) return null;
  const out: UciMove = { from: m[1] as Square, to: m[2] as Square };
  if (m[3]) out.promotion = m[3] as UciMove["promotion"];
  return out;
}

export function toUci(m: { from: string; to: string; promotion?: string | undefined }): string {
  return `${m.from}${m.to}${m.promotion ?? ""}`;
}

/** "" → []; the wire and DB store moves as one space-separated string. */
export function splitMoves(moves: string | readonly string[]): string[] {
  if (Array.isArray(moves)) return [...moves];
  const s = (moves as string).trim();
  return s ? s.split(/\s+/) : [];
}

export function joinMoves(moves: readonly string[]): string {
  return moves.join(" ");
}

export function isValidFen(fen: string): boolean {
  try {
    return validateFen(fen).ok;
  } catch {
    return false;
  }
}

export function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

export function fullmoveOf(fen: string): number {
  const n = Number.parseInt(fen.split(" ")[5] ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Plan 8.19: `startPly = 2·(fullmove − 1) + (side === "b" ? 1 : 0)`. */
export function startPlyOf(fen: string): number {
  return 2 * (fullmoveOf(fen) - 1) + (sideToMove(fen) === "b" ? 1 : 0);
}

export function isInitialFen(fen: string): boolean {
  return fen.trim() === INITIAL_FEN;
}

/** Applies one UCI move; returns null (and leaves the board unchanged) when it is illegal or malformed. */
export function applyUci(chess: Chess, uci: string): Move | null {
  const m = parseUci(uci);
  if (!m) return null;
  try {
    return chess.move(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });
  } catch {
    return null;
  }
}

export type ReplayResult =
  | { ok: true; chess: Chess; sans: string[]; history: Move[] }
  | { ok: false; index: number; uci: string; reason: "bad_fen" | "illegal" };

/** Replays `moves` from `startFen`. `index` is the 0-based position of the first illegal move. */
export function replay(startFen: string, moves: string | readonly string[]): ReplayResult {
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return { ok: false, index: -1, uci: "", reason: "bad_fen" };
  }
  const list = splitMoves(moves);
  const sans: string[] = [];
  const history: Move[] = [];
  for (let i = 0; i < list.length; i++) {
    const uci = list[i]!;
    const mv = applyUci(chess, uci);
    if (!mv) return { ok: false, index: i, uci, reason: "illegal" };
    sans.push(mv.san);
    history.push(mv);
  }
  return { ok: true, chess, sans, history };
}

/** SAN list for a legal UCI line; throws on an illegal move (use `replay` to inspect failures). */
export function sanLine(startFen: string, moves: string | readonly string[]): string[] {
  const r = replay(startFen, moves);
  if (!r.ok) throw new Error(`illegal move ${r.uci} at index ${r.index}`);
  return r.sans;
}

export function fenAfter(startFen: string, moves: string | readonly string[]): string {
  const r = replay(startFen, moves);
  if (!r.ok) throw new Error(`illegal move ${r.uci} at index ${r.index}`);
  return r.chess.fen();
}

/** Converts a SAN line to UCI (design fixtures and legend prefixes are SAN). */
export function sanToUci(startFen: string, sans: readonly string[]): string[] {
  const chess = new Chess(startFen);
  return sans.map((san) => {
    const mv = chess.move(san);
    return toUci(mv);
  });
}

/** Legal destinations per origin square, for the board's move dots. */
export function legalDests(chess: Chess): Map<Square, Square[]> {
  const out = new Map<Square, Square[]>();
  for (const mv of chess.moves({ verbose: true })) {
    const list = out.get(mv.from);
    if (list) {
      if (!list.includes(mv.to)) list.push(mv.to);
    } else out.set(mv.from, [mv.to]);
  }
  return out;
}

/** True when moving the piece on `from` to `to` is a pawn reaching the last rank (the picker must open). */
export function isPromotionMove(fen: string, from: string, to: string): boolean {
  const board = parsePlacement(fen);
  const p = board.get(from);
  if (!p || p.type !== "p") return false;
  return (p.color === "w" && to[1] === "8") || (p.color === "b" && to[1] === "1");
}

export interface BoardPiece {
  color: Side;
  type: PieceSymbol;
}

/** Placement field → square map (no validation beyond the 8×8 shape). */
export function parsePlacement(fen: string): Map<string, BoardPiece> {
  const out = new Map<string, BoardPiece>();
  const rows = (fen.split(" ")[0] ?? "").split("/");
  for (let r = 0; r < 8; r++) {
    const row = rows[r] ?? "";
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const sq = `${FILES[f]}${8 - r}`;
      const lower = ch.toLowerCase() as PieceSymbol;
      out.set(sq, { color: ch === lower ? "b" : "w", type: lower });
      f++;
    }
  }
  return out;
}

export const fileIdx = (sq: string): number => sq.charCodeAt(0) - 97;
export const rankIdx = (sq: string): number => Number(sq[1]) - 1;
export const sqAt = (file: number, rank: number): string | null =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8 ? `${FILES[file]}${rank + 1}` : null;

const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;
const KING_STEPS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;
const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Premove targets (plan 8.18): pseudo-legal patterns for `side`'s pieces after a null move by the opponent, with
 * checks ignored and every square reachable by the piece's pattern allowed (pieces may move away or be captured
 * before the premove fires), the way Lichess/chessground does it. Includes castling squares while the rights exist.
 */
export function premoveDests(fen: string, side: Side): Map<Square, Square[]> {
  const board = parsePlacement(fen);
  const castling = fen.split(" ")[2] ?? "-";
  const out = new Map<Square, Square[]>();
  for (const [sq, p] of board) {
    if (p.color !== side) continue;
    const f = fileIdx(sq);
    const r = rankIdx(sq);
    const dests = new Set<string>();
    const add = (df: number, dr: number) => {
      const t = sqAt(f + df, r + dr);
      if (t) dests.add(t);
    };
    switch (p.type) {
      case "n":
        for (const [df, dr] of KNIGHT_STEPS) add(df, dr);
        break;
      case "k": {
        for (const [df, dr] of KING_STEPS) add(df, dr);
        const home = side === "w" ? "e1" : "e8";
        if (sq === home) {
          const rank = side === "w" ? "1" : "8";
          if (castling.includes(side === "w" ? "K" : "k")) dests.add(`g${rank}`);
          if (castling.includes(side === "w" ? "Q" : "q")) dests.add(`c${rank}`);
        }
        break;
      }
      case "p": {
        const dir = side === "w" ? 1 : -1;
        add(0, dir);
        if ((side === "w" && r === 1) || (side === "b" && r === 6)) add(0, 2 * dir);
        add(-1, dir);
        add(1, dir);
        break;
      }
      default: {
        const dirs = p.type === "r" ? ROOK_DIRS : p.type === "b" ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
        for (const [df, dr] of dirs) for (let k = 1; k < 8; k++) add(df * k, dr * k);
      }
    }
    if (dests.size) out.set(sq as Square, [...dests] as Square[]);
  }
  return out;
}

/** True when `uci` is a premove pattern for `side` in `fen` (used before queueing one). */
export function isPremovePattern(fen: string, side: Side, uci: string): boolean {
  const m = parseUci(uci);
  if (!m) return false;
  return premoveDests(fen, side).get(m.from)?.includes(m.to) ?? false;
}

// ── Position cache ──
// The server reducer applies one move per input; replaying the whole game each time would cost O(plies). The cache
// hands out the Chess instance for (startFen, moves) and takes it back after the move, keyed by the full line, so a
// reused old state simply misses and replays (correct, just slower). Bounded LRU.

const CACHE_MAX = 512;
const cache = new Map<string, Chess>();
const keyOf = (startFen: string, moves: readonly string[]) => `${startFen}|${moves.join(" ")}`;

/** Returns a Chess instance at (startFen, moves) that the caller owns until it calls `putChess`. Throws if illegal. */
export function takeChess(startFen: string, moves: readonly string[]): Chess {
  const key = keyOf(startFen, moves);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    return hit;
  }
  const r = replay(startFen, moves);
  if (!r.ok) throw new Error(`cannot rebuild position: ${r.reason} at ${r.index}`);
  return r.chess;
}

export function putChess(startFen: string, moves: readonly string[], chess: Chess): void {
  const key = keyOf(startFen, moves);
  cache.delete(key);
  cache.set(key, chess);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Read-only view: the caller must not mutate the returned instance. */
export function peekChess(startFen: string, moves: readonly string[]): Chess {
  const c = takeChess(startFen, moves);
  putChess(startFen, moves, c);
  return c;
}

export function clearPositionCache(): void {
  cache.clear();
}
