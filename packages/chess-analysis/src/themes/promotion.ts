// Pawn themes (phase-05 plan §8.11 Tier 1), from the published descriptions:
//   promotion       "Promote one of your pawns to a queen or minor piece": a solver move of the line promotes;
//   underPromotion  the promotion is to a knight, bishop or rook;
//   advancedPawn    "One of your pawns is deep into the opponent position, maybe threatening to promote": a solver
//                   pawn on its 6th or 7th rank moves in the line, or the line promotes.
import { rankOf, sqIndex, type ThemeContext } from "./context";

export function pawnThemes(ctx: ThemeContext): string[] {
  const out: string[] = [];
  const solverMoves = ctx.steps.filter((s) => s.solver);
  const promos = solverMoves.filter((s) => s.move.promotion);
  if (promos.length) out.push("promotion");
  if (promos.some((s) => s.move.promotion !== "q")) out.push("underPromotion");
  const deep = solverMoves.some((s) => {
    if (s.move.piece !== "p") return false;
    const r = rankOf(sqIndex(s.move.from));
    const rel = ctx.solver === "w" ? r : 7 - r;
    return rel >= 5;
  });
  if (deep || promos.length) out.push("advancedPawn");
  return out;
}
