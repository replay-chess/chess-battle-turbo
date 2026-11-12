// Practice's game rules (phase-03 plan §4.8, §5.9): an untimed, unrated game from a position against the browser
// engine. Pure: the moves are the state; every position is replayed from the start FEN with one chess.js game, so
// threefold repetition sees the history (the legacy practice rebuilt `new Chess(fen)` per move and never saw it,
// play-b PB4). Take Back removes the last full move pair (your move and the engine's reply), or only your move while
// the engine is still thinking. End detection is game-core's (checkmate, stalemate, insufficient material, threefold,
// fifty moves).
import { detectEnd, type BoardEnd } from "@repo/game-core/rules/end";
import { Chess, legalDests, parseUci, type Square } from "@repo/game-core/rules/chess";

export type Side = "w" | "b";

export interface PracticeGame {
  startFen: string;
  /** UCI from `startFen`. */
  moves: readonly string[];
}

export interface PracticePosition {
  fen: string;
  last: [Square, Square] | null;
  check: Square | null;
  /** "12.Ba4" of the move that reached it; null at the start. */
  label: string | null;
  turn: Side;
}

function replay(game: PracticeGame, upTo = game.moves.length): { chess: Chess; labels: string[]; last: [Square, Square] | null } {
  const chess = new Chess(game.startFen);
  const labels: string[] = [];
  let last: [Square, Square] | null = null;
  for (let i = 0; i < upTo; i++) {
    const m = parseUci(game.moves[i] ?? "");
    if (!m) break;
    const no = chess.moveNumber();
    const white = chess.turn() === "w";
    let san: string;
    try {
      san = chess.move(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to }).san;
    } catch {
      break;
    }
    labels.push(`${no}${white ? "." : "…"}${san}`);
    last = [m.from as Square, m.to as Square];
  }
  return { chess, labels, last };
}

function kingInCheck(chess: Chess): Square | null {
  if (!chess.inCheck()) return null;
  return (chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null) as Square | null;
}

/** The position after the first `index` moves (index = moves.length: the live position). */
export function positionAt(game: PracticeGame, index = game.moves.length): PracticePosition {
  const { chess, labels, last } = replay(game, index);
  return {
    fen: chess.fen(),
    last: index > 0 ? last : null,
    check: kingInCheck(chess),
    label: labels[labels.length - 1] ?? null,
    turn: chess.turn(),
  };
}

/** The game with `uci` played, or null when it is not legal in the live position. */
export function playMove(game: PracticeGame, uci: string): PracticeGame | null {
  const m = parseUci(uci);
  if (!m) return null;
  const { chess } = replay(game);
  try {
    chess.move(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });
  } catch {
    return null;
  }
  return { ...game, moves: [...game.moves, uci] };
}

/** Legal targets of the live position (the board's `dests`). */
export function liveDests(game: PracticeGame): Map<Square, Square[]> {
  return legalDests(replay(game).chess);
}

/** The side that moves after `count` moves. */
export function sideAfter(startFen: string, count: number): Side {
  const first: Side = startFen.split(" ")[1] === "b" ? "b" : "w";
  return count % 2 === 0 ? first : first === "w" ? "b" : "w";
}

/**
 * Take Back: the last full move pair, so it is your turn again. With the engine's reply on the board that is two plies;
 * while the engine thinks (your move is the last) one. Never below the start, never past your first move when the
 * engine moved first.
 */
export function takeBack(game: PracticeGame, human: Side): PracticeGame {
  const n = game.moves.length;
  if (n === 0) return game;
  const lastMover = sideAfter(game.startFen, n - 1);
  let drop = lastMover === human ? 1 : 2;
  if (n - drop < 0) drop = n;
  // Keep the engine's opening move when it moved first (the position the user started from).
  const engineFirst = sideAfter(game.startFen, 0) !== human;
  if (engineFirst && n - drop < 1) drop = n - 1;
  if (drop <= 0) return game;
  return { ...game, moves: game.moves.slice(0, n - drop) };
}

/** True when Take Back would change anything. */
export function canTakeBack(game: PracticeGame, human: Side): boolean {
  return takeBack(game, human) !== game;
}

/** The game's end in the live position, or null. */
export function endOf(game: PracticeGame): BoardEnd | null {
  return detectEnd(replay(game).chess);
}

/** The inline result: "Checkmate · you won", "Stalemate · draw" … */
export function resultText(end: BoardEnd, human: Side): string {
  switch (end.method) {
    case "checkmate":
      return end.winner === human ? "Checkmate · you won" : "Checkmate · the engine won";
    case "stalemate":
      return "Stalemate · draw";
    case "insufficient_material":
      return "Insufficient material · draw";
    case "threefold":
      return "Threefold repetition · draw";
    case "fifty_move":
      return "Fifty-move rule · draw";
  }
}

/** The labels of the moves played so far (the practice line under the board). */
export function lineLabels(game: PracticeGame): string[] {
  return replay(game).labels;
}
