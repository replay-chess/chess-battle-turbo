// skewer (phase-05 plan §8.11 Tier 1; the published description: "A motif involving a high value piece being
// attacked, moving out of the way, and allowing a lower value piece behind it to be captured or attacked, the inverse
// of a pin"). A solver bishop, rook or queen move lines up an enemy piece A and, behind it on the same line, an enemy
// piece B worth less than A (A may be the king); the defender moves A away and the solver then captures on B's square.
import {
  BISHOP_DIRS,
  boardOf,
  chessAt,
  firstTwo,
  ROOK_DIRS,
  slidesAlong,
  sqIndex,
  WORTH,
  type ThemeContext,
} from "./context";

export function isSkewer(ctx: ThemeContext): boolean {
  const steps = ctx.steps;
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k]!;
    if (!step.solver) continue;
    const board = boardOf(chessAt(step.fenAfter));
    const at = sqIndex(step.move.to);
    const piece = board[at];
    if (!piece || (piece.type !== "b" && piece.type !== "r" && piece.type !== "q")) continue;
    for (const dir of [...ROOK_DIRS, ...BISHOP_DIRS]) {
      if (!slidesAlong(piece.type, dir)) continue;
      const { first, second } = firstTwo(board, at, dir);
      if (first === null || second === null) continue;
      const a = board[first]!;
      const b = board[second]!;
      if (a.color !== ctx.defender || b.color !== ctx.defender) continue;
      if (WORTH[a.type] <= WORTH[b.type]) continue;
      const reply = steps[k + 1];
      if (!reply || sqIndex(reply.move.from) !== first) continue;
      const next = steps[k + 2];
      if (next && sqIndex(next.move.to) === second && next.move.captured) return true;
    }
  }
  return false;
}
