// The facts every theme detector reads (phase-05 plan §8.11): the solution line replayed once with chess.js, plus small
// board-geometry helpers. Clean-room: built from the published theme descriptions (lichess.org/training/themes) and
// the plan's own rules, never from the AGPL tagger (CLEANROOM.md "P5").
//
// Vocabulary: the "solver" is the side to move in `fen` (the member, or the side the Lichess puzzle asks to play);
// the line alternates solver, defender, solver … starting with the solver. Square indexes are a1 = 0 … h8 = 63.

import { Chess, type Move, type Square } from "chess.js";
import { PIECE_VALUE, type PieceType } from "../board";
import type { Color } from "../codec";

/** Worth for "more valuable than" comparisons: the king outranks everything. */
export const WORTH: Readonly<Record<PieceType, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface ThemeInput {
  /** Position before the solver's first move. */
  fen: string;
  /** The solution line (UCI), solver first. */
  line: readonly string[];
  /** The opponent's previous move into `fen` (UCI), when known. */
  setupUci?: string | null;
  /** That move captured something (rc:recapture reads it). */
  setupCaptured?: boolean;
  /** Solver-POV centipawns after the best move (null when it is a mate); drives crushing / advantage / equality. */
  cp?: number | null;
  /** Solver mates in this many moves (from the engine), when known. */
  mateIn?: number | null;
  /** A review position (not a scored puzzle): the `rc:*` heuristics run. */
  review?: {
    /** The move the member played instead (UCI). */
    playedUci: string;
    /** The opponent's best reply to the played move (UCI), when known. */
    refuteUci?: string | null;
    /** A longer engine line from `fen` (best first) than the stored solution, when known. */
    pv?: readonly string[];
    /** The game phase of the ply. */
    phase?: "OPENING" | "MIDDLEGAME" | "ENDGAME";
  } | null;
}

export interface LineStep {
  /** 0-based index in the line. */
  index: number;
  solver: boolean;
  fenBefore: string;
  fenAfter: string;
  move: Move;
}

export interface ThemeContext {
  input: ThemeInput;
  solver: Color;
  defender: Color;
  /** The legal prefix of the line. */
  steps: LineStep[];
  /** The position after the whole (legal) line. */
  final: Chess;
}

export function otherColor(c: Color): Color {
  return c === "w" ? "b" : "w";
}

export function sqIndex(sq: string): number {
  return sq.charCodeAt(0) - 97 + 8 * (Number(sq[1]) - 1);
}

export function sqName(i: number): Square {
  return `${String.fromCharCode(97 + (i % 8))}${Math.floor(i / 8) + 1}` as Square;
}

export const fileOf = (i: number) => i % 8;
export const rankOf = (i: number) => Math.floor(i / 8);

export interface BoardPiece {
  type: PieceType;
  color: Color;
}

/** 64 squares of a position (a1 = 0). */
export function boardOf(chess: Chess): (BoardPiece | null)[] {
  const out: (BoardPiece | null)[] = new Array<BoardPiece | null>(64).fill(null);
  for (const row of chess.board()) {
    for (const cell of row) if (cell) out[sqIndex(cell.square)] = { type: cell.type as PieceType, color: cell.color };
  }
  return out;
}

export const ROOK_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const BISHOP_DIRS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function slidesAlong(type: PieceType, dir: readonly [number, number]): boolean {
  const diagonal = dir[0] !== 0 && dir[1] !== 0;
  if (type === "q") return true;
  if (type === "b") return diagonal;
  if (type === "r") return !diagonal;
  return false;
}

/** The squares from `from` in direction `dir` up to and including the first occupied one. */
export function ray(board: readonly (BoardPiece | null)[], from: number, dir: readonly [number, number]): number[] {
  const out: number[] = [];
  let f = fileOf(from) + dir[0];
  let r = rankOf(from) + dir[1];
  while (f >= 0 && f < 8 && r >= 0 && r < 8) {
    const i = f + 8 * r;
    out.push(i);
    if (board[i]) break;
    f += dir[0];
    r += dir[1];
  }
  return out;
}

/** The first two pieces met from `from` along `dir` (either may be absent). */
export function firstTwo(
  board: readonly (BoardPiece | null)[],
  from: number,
  dir: readonly [number, number],
): { first: number | null; second: number | null } {
  let f = fileOf(from) + dir[0];
  let r = rankOf(from) + dir[1];
  let first: number | null = null;
  while (f >= 0 && f < 8 && r >= 0 && r < 8) {
    const i = f + 8 * r;
    if (board[i]) {
      if (first === null) first = i;
      else return { first, second: i };
    }
    f += dir[0];
    r += dir[1];
  }
  return { first, second: null };
}

export interface Pin {
  pinner: number;
  pinned: number;
  /** The more valuable piece behind the pinned one. */
  behind: number;
}

/** Every pin `by` holds against the other side: a slider, an enemy piece, then a more valuable enemy piece behind. */
export function pinsBy(board: readonly (BoardPiece | null)[], by: Color): Pin[] {
  const out: Pin[] = [];
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || p.color !== by || (p.type !== "b" && p.type !== "r" && p.type !== "q")) continue;
    for (const dir of [...ROOK_DIRS, ...BISHOP_DIRS]) {
      if (!slidesAlong(p.type, dir)) continue;
      const { first, second } = firstTwo(board, s, dir);
      if (first === null || second === null) continue;
      const a = board[first]!;
      const b = board[second]!;
      if (a.color === by || b.color === by) continue;
      if (a.type === "k") continue;
      if (WORTH[b.type] > WORTH[a.type]) out.push({ pinner: s, pinned: first, behind: second });
    }
  }
  return out;
}

/** Squares a piece of `color` standing on `from` attacks (pawn captures only; sliders stop at the first piece). */
export function attacksFrom(board: readonly (BoardPiece | null)[], from: number): number[] {
  const p = board[from];
  if (!p) return [];
  const f = fileOf(from);
  const r = rankOf(from);
  const at = (df: number, dr: number) => {
    const nf = f + df;
    const nr = r + dr;
    return nf >= 0 && nf < 8 && nr >= 0 && nr < 8 ? nf + 8 * nr : null;
  };
  const out: number[] = [];
  const push = (i: number | null) => {
    if (i !== null) out.push(i);
  };
  switch (p.type) {
    case "p": {
      const dr = p.color === "w" ? 1 : -1;
      push(at(-1, dr));
      push(at(1, dr));
      break;
    }
    case "n":
      for (const [df, dr] of [
        [1, 2],
        [2, 1],
        [2, -1],
        [1, -2],
        [-1, -2],
        [-2, -1],
        [-2, 1],
        [-1, 2],
      ] as const)
        push(at(df, dr));
      break;
    case "k":
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (df || dr) push(at(df, dr));
      break;
    default:
      for (const dir of [...ROOK_DIRS, ...BISHOP_DIRS]) if (slidesAlong(p.type, dir)) out.push(...ray(board, from, dir));
  }
  return out;
}

/** Attackers of `sq` of `color` (geometry only: pins ignored). */
export function attackersOf(board: readonly (BoardPiece | null)[], sq: number, color: Color): number[] {
  const out: number[] = [];
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.color === color && attacksFrom(board, s).includes(sq)) out.push(s);
  }
  return out;
}

export function kingSquareOf(board: readonly (BoardPiece | null)[], color: Color): number | null {
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.type === "k" && p.color === color) return s;
  }
  return null;
}

/** Material (1/3/3/5/9) of `side` minus the other side's. */
export function balance(board: readonly (BoardPiece | null)[], side: Color): number {
  let b = 0;
  for (const p of board) if (p) b += (p.color === side ? 1 : -1) * PIECE_VALUE[p.type];
  return b;
}

/** Replays the line (legal prefix) and collects the steps. */
export function buildContext(input: ThemeInput): ThemeContext {
  const chess = new Chess(input.fen);
  const solver = chess.turn();
  const steps: LineStep[] = [];
  input.line.forEach((uci, index) => {
    if (steps.length !== index) return;
    const fenBefore = chess.fen();
    let move: Move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return;
    }
    steps.push({ index, solver: index % 2 === 0, fenBefore, fenAfter: chess.fen(), move });
  });
  return { input, solver, defender: otherColor(solver), steps, final: chess };
}

/** The solver's steps. */
export function solverSteps(ctx: ThemeContext): LineStep[] {
  return ctx.steps.filter((s) => s.solver);
}

export function chessAt(fen: string): Chess {
  return new Chess(fen);
}
