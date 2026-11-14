// pin (phase-05 plan §8.11 Tier 1; the published description: "A tactic involving pins, where a piece is unable to
// move without revealing an attack on a higher value piece"). After a solver move (defender to move) a solver bishop,
// rook or queen pins an enemy piece to its king (the piece cannot legally move off the line), and the line uses it:
//   - the pinned piece is attacked and loses material where it stands (an attacker is worth less than it, or it has
//     fewer defenders than attackers), or
//   - the pinned piece guards the square the solver just moved to: it cannot take back, which is what makes the move
//     work.
// Measured against the Lichess `pin` tag (CLEANROOM.md "P5"): pins against a queen or rook, a pinned piece captured
// later, or a pin of the solver's own piece that the line breaks are far more often ordinary play than the motif, so
// only the absolute pin counts.
import { attackersOf, attacksFrom, boardOf, chessAt, pinsBy, sqIndex, WORTH, type BoardPiece, type Pin, type ThemeContext } from "./context";

function pinWins(board: readonly (BoardPiece | null)[], pin: Pin, ctx: ThemeContext): boolean {
  const pinned = board[pin.pinned]!;
  const attackers = attackersOf(board, pin.pinned, ctx.solver);
  if (attackers.length === 0) return false;
  const cheapest = Math.min(...attackers.map((a) => WORTH[board[a]!.type]));
  if (cheapest < WORTH[pinned.type]) return true;
  return attackersOf(board, pin.pinned, ctx.defender).length < attackers.length;
}

export function isPin(ctx: ThemeContext): boolean {
  for (const step of ctx.steps) {
    if (!step.solver) continue;
    const to = sqIndex(step.move.to);
    const after = boardOf(chessAt(step.fenAfter));
    for (const pin of pinsBy(after, ctx.solver)) {
      if (after[pin.behind]?.type !== "k") continue;
      if (pinWins(after, pin, ctx) || attacksFrom(after, pin.pinned).includes(to)) return true;
    }
  }
  return false;
}
