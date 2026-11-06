// End detection after every move (plan 8.5), in this order: checkmate, stalemate, insufficient material,
// threefold repetition, fifty-move rule. All of them end the game automatically.

import type { Chess } from "chess.js";
import type { EndMethod, Side } from "../machine/types";

export interface BoardEnd {
  method: Extract<EndMethod, "checkmate" | "stalemate" | "insufficient_material" | "threefold" | "fifty_move">;
  /** The mover for checkmate; null for every draw. */
  winner: Side | null;
}

export const BOARD_END_METHODS: readonly BoardEnd["method"][] = [
  "checkmate",
  "stalemate",
  "insufficient_material",
  "threefold",
  "fifty_move",
];

/** `chess` must have been built by replaying from the start FEN so threefold sees the history. */
export function detectEnd(chess: Chess): BoardEnd | null {
  if (chess.isCheckmate()) return { method: "checkmate", winner: chess.turn() === "w" ? "b" : "w" };
  if (chess.isStalemate()) return { method: "stalemate", winner: null };
  if (chess.isInsufficientMaterial()) return { method: "insufficient_material", winner: null };
  if (chess.isThreefoldRepetition()) return { method: "threefold", winner: null };
  if (chess.isDrawByFiftyMoves()) return { method: "fifty_move", winner: null };
  return null;
}

/** Board-verifiable methods (plan 8.16 step 3). */
export function isBoardMethod(method: EndMethod): method is BoardEnd["method"] {
  return (BOARD_END_METHODS as readonly string[]).includes(method);
}
