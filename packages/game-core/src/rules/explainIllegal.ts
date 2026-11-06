// Illegal-move reasons (plan 8.17, client only). Checked in order; the first match wins. The toast is
// "That move isn’t legal: {reason}." The fixture PKG/chess-fixtures/rules/illegal-reasons.json holds one case per
// reason and is shared with P9 and P10 (premove settings).

import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { Side } from "../machine/types";
import { fileIdx, rankIdx, sqAt } from "./chess";

export type IllegalReason =
  | "not_your_turn"
  | "opponent_piece"
  | "own_piece_on_target"
  | "pattern_knight"
  | "pattern_bishop"
  | "pattern_rook"
  | "pattern_queen"
  | "pattern_king"
  | "pattern_pawn"
  | "blocked"
  | "in_check"
  | "pinned"
  | "exposes_king"
  | "castle_out_of_check"
  | "castle_through_check"
  | "castle_king_moved"
  | "castle_rook_moved"
  | "castle_blocked"
  | "en_passant"
  | "fallback";

export const ILLEGAL_REASONS: readonly IllegalReason[] = [
  "not_your_turn",
  "opponent_piece",
  "own_piece_on_target",
  "pattern_knight",
  "pattern_bishop",
  "pattern_rook",
  "pattern_queen",
  "pattern_king",
  "pattern_pawn",
  "blocked",
  "in_check",
  "pinned",
  "exposes_king",
  "castle_out_of_check",
  "castle_through_check",
  "castle_king_moved",
  "castle_rook_moved",
  "castle_blocked",
  "en_passant",
  "fallback",
];

export interface IllegalExplanation {
  reason: IllegalReason;
  /** The reason sentence ("the knight on d7 blocks the d-file."). */
  text: string;
  /** The full toast ("That move isn’t legal: the knight on d7 blocks the d-file."). */
  toast: string;
}

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const PATTERN_TEXT: Record<PieceSymbol, [IllegalReason, string]> = {
  n: ["pattern_knight", "a knight moves in an L shape."],
  b: ["pattern_bishop", "a bishop moves diagonally."],
  r: ["pattern_rook", "a rook moves along ranks and files."],
  q: ["pattern_queen", "a queen moves along ranks, files and diagonals."],
  k: ["pattern_king", "the king moves one square at a time."],
  p: ["pattern_pawn", "a pawn moves straight ahead and captures diagonally."],
};

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export interface ExplainOptions {
  /** The side trying to move (the viewer). Defaults to the side to move. */
  mover?: Side;
  /** Names used for "{opponent}" ("it’s martin_k’s move."). Default White/Black. */
  names?: { w: string; b: string };
}

function result(reason: IllegalReason, text: string): IllegalExplanation {
  return { reason, text, toast: `That move isn’t legal: ${text}` };
}

/** The first matching reason for from→to; a legal move gets the fallback (callers check legality first). */
export function explainIllegal(fen: string, from: string, to: string, opts: ExplainOptions = {}): IllegalExplanation {
  const chess = new Chess(fen);
  return explainWith(chess, from as Square, to as Square, opts) ?? result("fallback", "the piece went back.");
}

/** Like `explainIllegal` but returns null when the move is legal. */
export function explainWith(
  chess: Chess,
  from: Square,
  to: Square,
  opts: ExplainOptions = {},
): IllegalExplanation | null {
  const turn = chess.turn();
  const mover = opts.mover ?? turn;
  const names = opts.names ?? { w: "White", b: "Black" };
  const opponent: Side = mover === "w" ? "b" : "w";

  if (mover !== turn) return result("not_your_turn", `it’s ${names[opponent]}’s move.`);
  const piece = chess.get(from);
  if (!piece) return result("fallback", "the piece went back.");
  if (piece.color !== mover) return result("opponent_piece", `that’s ${names[opponent]}’s piece.`);
  if (from === to) return result("fallback", "the piece went back.");
  if (chess.moves({ verbose: true, square: from }).some((m) => m.to === to)) return null;

  const target = chess.get(to);
  if (target && target.color === mover) {
    return result("own_piece_on_target", `your ${PIECE_NAMES[target.type]} is already on ${to}.`);
  }

  const df = fileIdx(to) - fileIdx(from);
  const dr = rankIdx(to) - rankIdx(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);
  const pattern = () => result(PATTERN_TEXT[piece.type][0], PATTERN_TEXT[piece.type][1]);

  switch (piece.type) {
    case "n":
      if (!((adf === 1 && adr === 2) || (adf === 2 && adr === 1))) return pattern();
      break;
    case "b":
      if (adf !== adr) return pattern();
      break;
    case "r":
      if (df !== 0 && dr !== 0) return pattern();
      break;
    case "q":
      if (adf !== adr && df !== 0 && dr !== 0) return pattern();
      break;
    case "k": {
      const home = mover === "w" ? "e1" : "e8";
      if (from === home && dr === 0 && adf === 2) return explainCastle(chess, mover, df > 0 ? "k" : "q");
      if (adf > 1 || adr > 1) return pattern();
      break;
    }
    case "p": {
      const dir = mover === "w" ? 1 : -1;
      const startRank = mover === "w" ? 1 : 6;
      if (df === 0 && dr === dir) {
        if (target) return pattern();
      } else if (df === 0 && dr === 2 * dir && rankIdx(from) === startRank) {
        const mid = sqAt(fileIdx(from), rankIdx(from) + dir) as Square;
        const blocker = chess.get(mid);
        if (blocker) return result("blocked", `the ${PIECE_NAMES[blocker.type]} on ${mid} blocks the ${from[0]}-file.`);
        if (target) return pattern();
      } else if (adf === 1 && dr === dir) {
        const epSquare = chess.fen({ forceEnpassantSquare: true }).split(" ")[3];
        if (!target && to !== epSquare) {
          const besideSq = sqAt(fileIdx(to), rankIdx(from)) as Square;
          const beside = chess.get(besideSq);
          if (beside && beside.type === "p" && beside.color !== mover) {
            return result("en_passant", "en passant is only possible right after the pawn moves two squares.");
          }
          return pattern();
        }
      } else return pattern();
      break;
    }
  }

  // Sliders: the first piece between from and to blocks the line.
  if (piece.type === "b" || piece.type === "r" || piece.type === "q") {
    const sf = Math.sign(df);
    const sr = Math.sign(dr);
    for (let k = 1; k < Math.max(adf, adr); k++) {
      const sq = sqAt(fileIdx(from) + sf * k, rankIdx(from) + sr * k) as Square;
      const blocker = chess.get(sq);
      if (blocker) {
        const line = df === 0 ? `${from[0]}-file` : dr === 0 ? `${ORDINALS[rankIdx(from)]} rank` : "diagonal";
        return result("blocked", `the ${PIECE_NAMES[blocker.type]} on ${sq} blocks the ${line}.`);
      }
    }
  }

  // The move fits the pattern and the path is clear, so it fails on king safety.
  if (chess.inCheck()) return result("in_check", "your king is in check.");
  if (piece.type !== "k" && isPinned(chess, from, mover)) {
    return result("pinned", `the ${PIECE_NAMES[piece.type]} on ${from} is pinned to your king.`);
  }
  return result("exposes_king", "that would leave your king in check.");
}

function isPinned(chess: Chess, from: Square, mover: Side): boolean {
  const probe = new Chess(chess.fen());
  const king = probe.findPiece({ type: "k", color: mover })[0];
  if (!king) return false;
  probe.remove(from);
  return probe.isAttacked(king, mover === "w" ? "b" : "w");
}

function explainCastle(chess: Chess, mover: Side, wing: "k" | "q"): IllegalExplanation {
  const rights = chess.getCastlingRights(mover);
  if (!rights.k && !rights.q) return result("castle_king_moved", "your king has already moved.");
  if (!rights[wing]) return result("castle_rook_moved", "that rook has already moved.");
  const rank = mover === "w" ? "1" : "8";
  const between = (wing === "k" ? ["f", "g"] : ["b", "c", "d"]).map((f) => `${f}${rank}` as Square);
  if (between.some((sq) => chess.get(sq))) {
    return result("castle_blocked", "there are pieces between your king and rook.");
  }
  const opp: Side = mover === "w" ? "b" : "w";
  if (chess.inCheck()) return result("castle_out_of_check", "you can’t castle out of check.");
  const transit = `${wing === "k" ? "f" : "d"}${rank}` as Square;
  if (chess.isAttacked(transit, opp)) return result("castle_through_check", "you can’t castle through check.");
  return result("exposes_king", "that would leave your king in check.");
}
