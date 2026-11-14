// Phase and material-signature themes (phase-05 plan §8.11 Tier 1), from the published descriptions:
//   pawnEndgame "An endgame with only pawns", knightEndgame / bishopEndgame / rookEndgame / queenEndgame "… with only
//   knights / bishops / rooks / queens and pawns", queenRookEndgame "… with only queens, rooks and pawns" (each with at
//   least one piece of the named kinds); the phase tags opening / middlegame / endgame ("A tactic during the first /
//   middle / last phase of the game").
// Read on the position before the solver's first move, and only in the endgame phase. A review position from a game passes the game's own phase
// (the division of the whole game, divider.ts); a lone position is divided on its own (the divider's piece rules).
import type { PieceType } from "../board";
import { divide } from "../divider";
import { boardOf, chessAt, type ThemeContext } from "./context";

export type GamePhaseKey = "opening" | "middlegame" | "endgame";

export function phaseOf(fen: string): GamePhaseKey {
  const d = divide([fen]);
  if (d.endgamePly === 0) return "endgame";
  if (d.middlegamePly === 0) return "middlegame";
  return "opening";
}

export function endgameThemes(ctx: ThemeContext): string[] {
  const out: string[] = [];
  const review = ctx.input.review?.phase;
  const phase: GamePhaseKey = review ? (review.toLowerCase() as GamePhaseKey) : phaseOf(ctx.input.fen);
  if (phase === "endgame") {
    const kinds = new Set<PieceType>();
    for (const p of boardOf(chessAt(ctx.input.fen))) if (p && p.type !== "k" && p.type !== "p") kinds.add(p.type);
    const only = (...allowed: PieceType[]) => [...kinds].every((k) => allowed.includes(k));
    if (kinds.size === 0) out.push("pawnEndgame");
    else if (only("n")) out.push("knightEndgame");
    else if (only("b")) out.push("bishopEndgame");
    else if (only("r")) out.push("rookEndgame");
    else if (only("q")) out.push("queenEndgame");
    else if (only("q", "r") && kinds.has("q") && kinds.has("r")) out.push("queenRookEndgame");
  }
  out.push(phase);
  return out;
}
