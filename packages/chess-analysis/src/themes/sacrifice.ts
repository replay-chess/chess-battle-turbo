// sacrifice (phase-05 plan §8.11 Tier 1; the published description: "A tactic involving giving up material in the
// short-term, to gain an advantage again after a forced sequence of moves"). After one of the defender's replies inside
// the line the solver's material balance (1/3/3/5/9) is at least SACRIFICE_MIN_DROP below where the line started (the
// solver gave something up and the defender took it), and the solver's next move does not simply take it back (that is
// a trade, not a sacrifice): the deficit is still there after it. The line is a winning one by construction (a puzzle
// or a bank line), so the material given is what the forced sequence pays for.
import { balance, boardOf, chessAt, type ThemeContext } from "./context";

export const SACRIFICE_MIN_DROP = 2;

export function isSacrifice(ctx: ThemeContext): boolean {
  const start = balance(boardOf(chessAt(ctx.input.fen)), ctx.solver);
  const steps = ctx.steps;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]!;
    if (s.solver) continue;
    if (start - balance(boardOf(chessAt(s.fenAfter)), ctx.solver) < SACRIFICE_MIN_DROP) continue;
    const next = steps[k + 1];
    const afterNext = next ? balance(boardOf(chessAt(next.fenAfter)), ctx.solver) : null;
    if (afterNext === null || start - afterNext >= SACRIFICE_MIN_DROP) return true;
  }
  return false;
}
