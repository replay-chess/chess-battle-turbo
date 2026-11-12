// The practice hint (phase-03 plan §8.11, §4.8 "Hint (P3, local and free)"). From the local engine's best move at the
// current position: level 1 names the piece and its square ("Hint: look at your knight on c3."), level 2 adds the
// arrow from → to. Works offline (the engine is in the browser); P7 may replace the level-1 wording with a coach hint.
// A new position resets the level. Pure.
import { HINT_ARROW_COLOR } from "@repo/game-core/constants";
import { Chess, parseUci, type Square } from "@repo/game-core/rules/chess";

const PIECE_NAMES = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" } as const;

export interface PracticeHint {
  level: 1 | 2;
  text: string;
  arrow: { from: Square; to: Square; color: string } | null;
}

/** The hint text and arrow for `bestUci` in `fen`, or null when the move is not a piece of the side to move. */
export function practiceHint(fen: string, bestUci: string, level: 1 | 2): PracticeHint | null {
  const m = parseUci(bestUci);
  if (!m) return null;
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const piece = chess.get(m.from as Square);
  if (!piece || piece.color !== chess.turn()) return null;
  const text = `Hint: look at your ${PIECE_NAMES[piece.type]} on ${m.from}.`;
  if (level === 1) return { level, text, arrow: null };
  return { level, text: `${text} The arrow shows where it goes.`, arrow: { from: m.from as Square, to: m.to as Square, color: HINT_ARROW_COLOR } };
}

/** The position part of a FEN (placement, side, castling, en passant): the hint level resets when it changes. */
export function hintKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

/** The next level to show for `fen` after `shown` (1, then 2, then null: both were shown). */
export function nextHintLevel(shown: { key: string; level: 1 | 2 } | null, fen: string): 1 | 2 | null {
  if (!shown || shown.key !== hintKey(fen)) return 1;
  return shown.level === 1 ? 2 : null;
}
