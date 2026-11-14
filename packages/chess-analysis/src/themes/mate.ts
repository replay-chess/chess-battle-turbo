// Mate themes (phase-05 plan §8.11 Tier 1), from the published descriptions:
//   mate        "Win the game with style": the line ends in checkmate delivered by the solver;
//   mateIn1…5   the checkmate comes with the solver's n-th move;
//   smotheredMate  "A checkmate delivered by a knight in which the mated king is unable to move because it is
//                  surrounded (or smothered) by its own pieces".
import { attacksFrom, boardOf, kingSquareOf, solverSteps, type ThemeContext } from "./context";

/** The line (all of it legal) ends with the solver's checkmate. */
export function endsInMate(ctx: ThemeContext): boolean {
  const last = ctx.steps.at(-1);
  return ctx.steps.length === ctx.input.line.length && last !== undefined && last.solver && ctx.final.isCheckmate();
}

export function mateThemes(ctx: ThemeContext): string[] {
  if (!endsInMate(ctx)) return [];
  const n = solverSteps(ctx).length;
  const out = ["mate"];
  if (n >= 1 && n <= 5) out.push(`mateIn${n}`);
  if (isSmothered(ctx)) out.push("smotheredMate");
  return out;
}

/** Knight mate; every square around the mated king holds one of the king's own pieces (or is off the board). */
function isSmothered(ctx: ThemeContext): boolean {
  const last = ctx.steps.at(-1)!;
  if (last.move.piece !== "n") return false;
  const board = boardOf(ctx.final);
  const king = kingSquareOf(board, ctx.defender);
  if (king === null) return false;
  const around = attacksFrom(board, king);
  return around.length > 0 && around.every((sq) => board[sq]?.color === ctx.defender);
}
