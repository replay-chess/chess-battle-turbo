// fork (phase-05 plan §8.11 R-THM-05; the published description: "A move where the moved piece attacks two opponent
// pieces at once"). For each solver move except the last: when the moved piece is not on a bad square (the defender
// cannot win material by taking it, static exchange), count the enemy non-pawn pieces it attacks that are worth more
// than it (the king counts) or hang (no defender), and that cannot simply take the forker back (a target that guards the
// mover's square counts only when taking the forker loses material for it). More than one such target is a fork.
import { see } from "../see";
import { exchangeGain } from "../text/facts";
import {
  attackersOf,
  attacksFrom,
  boardOf,
  chessAt,
  sqIndex,
  sqName,
  WORTH,
  type ThemeContext,
} from "./context";

export function isFork(ctx: ThemeContext): boolean {
  const solverMoves = ctx.steps.filter((s) => s.solver);
  for (const step of solverMoves.slice(0, -1)) {
    const after = chessAt(step.fenAfter);
    const to = sqIndex(step.move.to);
    if (see(step.fenAfter, step.move.to) > 0) continue;
    const board = boardOf(after);
    const mover = board[to];
    if (!mover) continue;
    let targets = 0;
    for (const sq of attacksFrom(board, to)) {
      const p = board[sq];
      if (!p || p.color !== ctx.defender || p.type === "p") continue;
      const valuable = WORTH[p.type] > WORTH[mover.type];
      const hanging = attackersOf(board, sq, ctx.defender).length === 0;
      if (!valuable && !hanging) continue;
      if (p.type !== "k" && attacksFrom(board, sq).includes(to)) {
        // It guards the forker's square: it answers the fork only when taking the forker does not lose material.
        const back = exchangeGain(step.fenAfter, `${sqName(sq)}${step.move.to}`);
        if (back !== null && back >= 0) continue;
      }
      targets++;
    }
    if (targets > 1) return true;
  }
  return false;
}
