// Alternative checkmates (phase-05 plan §8.1 step 2: "every other mate-in-1 joins accept"; the runner's move check,
// §5.2). A position where the stored move gives mate is solved by ANY move that gives mate: the member who mates
// with the other rook found the puzzle, at the first move or at the last ply of a longer line, in a Lichess puzzle as
// in a bank card. Used by the worker (the stored `accept` list of a mate-in-1 bank card), the W1 rating guard (a
// mating "wrong" move is not a wrong move) and the runner (judgeMove). Pure; chess.js only (board routes and the
// server: never on the non-board routes, browser-subpaths.test.ts).
import { Chess } from "chess.js";

function play(fen: string, uci: string): Chess | null {
  const u = uci.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) return null;
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length === 5 ? u[4] : undefined });
    if (!m || (m.promotion && u.length !== 5)) return null;
    return chess;
  } catch {
    return null;
  }
}

/** True when `uci` is legal in `fen` and gives checkmate. */
export function givesMate(fen: string, uci: string): boolean {
  return play(fen, uci)?.isCheckmate() ?? false;
}

/** Every legal move that gives checkmate in `fen` (lowercase UCI, promotions with their piece), in chess.js order. */
export function matingMoves(fen: string): string[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    if (chess.isCheckmate()) out.push(`${m.from}${m.to}${m.promotion ?? ""}`);
    chess.undo();
  }
  return out;
}

/**
 * The move a solver played at a ply whose expected move mates: accepted when it mates too. False when the expected
 * move does not mate (an alternative is then judged by the stored accept list only).
 */
export function isAlternativeMate(fen: string, expectedUci: string, playedUci: string): boolean {
  if (expectedUci.trim().toLowerCase() === playedUci.trim().toLowerCase()) return false;
  return givesMate(fen, expectedUci) && givesMate(fen, playedUci);
}
