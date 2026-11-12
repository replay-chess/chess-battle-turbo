// Replays a game once with chess.js and keeps what the grader needs per position (phase-03 plan §8.12 step 2):
// FEN, EPD, side to move, legal move count, and per ply the SAN, UCI and whether it captured.
//
// Index base (§8.1): position i is the position before ply i; position n (n = plies) is the final position.

import { Chess, type Square } from "chess.js";
import type { Color } from "./codec";
import { epdOf } from "./board";

export interface Replay {
  startFen: string;
  /** FEN of positions 0 … n. */
  fens: string[];
  /** EPD of positions 0 … n. */
  epds: string[];
  /** Legal move count of positions 0 … n (0 in a terminal position). */
  legal: number[];
  /** Side to move in position 0. */
  startMover: Color;
  /** UCI of plies 0 … n − 1 (normalised: lowercase promotion, castling as king two squares). */
  uci: string[];
  /** SAN of plies 0 … n − 1. */
  san: string[];
  /** Final position status. */
  final: { checkmate: boolean; stalemate: boolean; threefold: boolean; draw: boolean };
}

/**
 * Castling written king-takes-rook (Chess960 style, as Lichess exports it: "e1h1") → the king's two-square move
 * ("e1g1"), which is what Stockfish prints in standard chess and what MoveCode stores. Other moves pass through.
 */
export function normalizeUci(fen: string, uci: string): string {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const board = new Chess(fen);
  const piece = board.get(from as Square);
  const target = board.get(to as Square);
  if (piece?.type === "k" && target?.type === "r" && target.color === piece.color && from[1] === to[1]) {
    const file = to[0] === "h" ? "g" : to[0] === "a" ? "c" : null;
    if (file && from[0] === "e") return `${from}${file}${from[1]}`;
  }
  return uci;
}

function moveFromUci(chess: Chess, uci: string) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    return chess.move({ from, to, promotion });
  } catch {
    throw new RangeError(`illegal move ${uci} in ${chess.fen()}`);
  }
}

function snapshot(chess: Chess, r: Replay): void {
  const fen = chess.fen();
  r.fens.push(fen);
  r.epds.push(epdOf(fen));
  r.legal.push(chess.moves().length);
}

function finish(chess: Chess, r: Replay): Replay {
  r.final = {
    checkmate: chess.isCheckmate(),
    stalemate: chess.isStalemate(),
    threefold: chess.isThreefoldRepetition(),
    draw: chess.isDraw(),
  };
  return r;
}

function start(startFen: string): { chess: Chess; r: Replay } {
  const chess = new Chess(startFen);
  const r: Replay = {
    startFen,
    fens: [],
    epds: [],
    legal: [],
    startMover: chess.turn(),
    uci: [],
    san: [],
    final: { checkmate: false, stalemate: false, threefold: false, draw: false },
  };
  snapshot(chess, r);
  return { chess, r };
}

/** Replays UCI moves from a FEN. Throws a RangeError on an illegal move. */
export function replayUci(startFen: string, moves: readonly string[]): Replay {
  const { chess, r } = start(startFen);
  for (const m of moves) {
    const mv = moveFromUci(chess, m);
    r.uci.push(`${mv.from}${mv.to}${mv.promotion ?? ""}`);
    r.san.push(mv.san);
    snapshot(chess, r);
  }
  return finish(chess, r);
}

/** Replays SAN moves from a FEN (fixtures, Lichess exports). Throws a RangeError on an illegal move. */
export function replaySan(startFen: string, moves: readonly string[]): Replay {
  const { chess, r } = start(startFen);
  for (const m of moves) {
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      throw new RangeError(`illegal move ${m} in ${chess.fen()}`);
    }
    r.uci.push(`${mv.from}${mv.to}${mv.promotion ?? ""}`);
    r.san.push(mv.san);
    snapshot(chess, r);
  }
  return finish(chess, r);
}

/** SAN of a UCI move in a position (for templates and fixtures). Throws on an illegal move. */
export function sanOf(fen: string, uci: string): string {
  return moveFromUci(new Chess(fen), uci).san;
}

/** UCI of a SAN move in a position. Throws on an illegal move. */
export function uciOf(fen: string, san: string): string {
  const chess = new Chess(fen);
  let mv;
  try {
    mv = chess.move(san);
  } catch {
    throw new RangeError(`illegal move ${san} in ${fen}`);
  }
  return `${mv.from}${mv.to}${mv.promotion ?? ""}`;
}
