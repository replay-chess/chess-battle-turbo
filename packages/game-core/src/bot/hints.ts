// Hints for bot games (plan 8.14). Level 1 names the piece to move; level 2 draws the arrow and names the move.
// Two levels per position; a new position resets the level. Both levels count in meta.assists.hints.

import { Chess, type Square } from "chess.js";
import { HINT_ARROW_COLOR, HINT_MOVETIME_MS } from "../constants";
import { parseUci } from "../rules/chess";

const NAMES = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" } as const;

/** Full-strength search used for hints. */
export const HINT_SEARCH = {
  options: [
    ["UCI_LimitStrength", "false"],
    ["Skill Level", "20"],
    ["MultiPV", "1"],
  ] as [string, string][],
  go: `go movetime ${HINT_MOVETIME_MS}`,
};

export interface HintView {
  level: 1 | 2;
  text: string;
  arrow: { from: string; to: string; color: string } | null;
}

/** The position part of a FEN (placement, side, castling, en passant): a new position resets the hint level. */
export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export interface HintTracker {
  key: string;
  level: 0 | 1 | 2;
}

/** The next level for `fen` (1, then 2, then null when both were shown for this position). */
export function nextHintLevel(tracker: HintTracker | null, fen: string): 1 | 2 | null {
  const key = positionKey(fen);
  if (!tracker || tracker.key !== key) return 1;
  if (tracker.level === 0) return 1;
  if (tracker.level === 1) return 2;
  return null;
}

export function advanceHint(tracker: HintTracker | null, fen: string, level: 1 | 2): HintTracker {
  return {
    key: positionKey(fen),
    level: tracker && tracker.key === positionKey(fen) ? (Math.max(tracker.level, level) as 1 | 2) : level,
  };
}

export function hintView(level: 1 | 2, fen: string, bestUci: string): HintView | null {
  const m = parseUci(bestUci);
  if (!m) return null;
  const chess = new Chess(fen);
  const piece = chess.get(m.from as Square);
  if (!piece) return null;
  if (level === 1) {
    const name = piece.type === "p" ? `pawn on ${m.from}` : NAMES[piece.type];
    return { level, text: `Hint 1 of 2: look at your ${name}.`, arrow: null };
  }
  let words: string;
  try {
    const mv = chess.move(
      m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to },
    );
    if (mv.isKingsideCastle()) words = "castle short, O-O";
    else if (mv.isQueensideCastle()) words = "castle long, O-O-O";
    else words = `play ${mv.san}`;
  } catch {
    return null;
  }
  return { level, text: `Hint 2 of 2: ${words}.`, arrow: { from: m.from, to: m.to, color: HINT_ARROW_COLOR } };
}
