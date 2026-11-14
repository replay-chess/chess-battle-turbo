// backRankMate (phase-05 plan §8.11 Tier 1), from the published description: "Checkmate the king on the home rank,
// when it is trapped there by its own pieces." The mated king stands on its first rank, the mating piece is a rook or
// queen giving check along that rank, and the king's way forward (the squares of its second rank next to it) is shut
// by its own pieces (every one of those squares holds one).
import { boardOf, fileOf, kingSquareOf, rankOf, sqIndex, sqName, type ThemeContext } from "./context";
import { endsInMate } from "./mate";

export function backRankThemes(ctx: ThemeContext): string[] {
  if (!endsInMate(ctx)) return [];
  const board = boardOf(ctx.final);
  const king = kingSquareOf(board, ctx.defender);
  if (king === null) return [];
  const home = ctx.defender === "w" ? 0 : 7;
  if (rankOf(king) !== home) return [];
  const checkers = ctx.final.attackers(sqName(king), ctx.solver).map(sqIndex);
  const rankChecker = checkers.some((c) => {
    const p = board[c];
    return p && (p.type === "r" || p.type === "q") && rankOf(c) === home;
  });
  if (!rankChecker) return [];
  const forward = home === 0 ? 1 : 6;
  let ownBlocks = 0;
  for (let df = -1; df <= 1; df++) {
    const f = fileOf(king) + df;
    if (f < 0 || f > 7) continue;
    const sq = f + 8 * forward;
    const p = board[sq];
    if (p && p.color === ctx.defender) ownBlocks++;
    else return [];
  }
  return ownBlocks > 0 ? ["backRankMate"] : [];
}
