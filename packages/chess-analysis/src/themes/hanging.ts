// hangingPiece and capturingDefender (phase-05 plan §8.11), from the published descriptions:
//   hangingPiece       "A tactic involving an opponent piece being undefended or insufficiently defended and free to
//                      capture": the solver's first move takes an undefended enemy knight, bishop, rook or queen and
//                      keeps the material (the static exchange after the capture gives nothing back);
//   capturingDefender  "Removing a piece that is critical to defence of another piece, allowing the now undefended
//                      piece to be captured on a following move": a solver capture removes a piece that guarded
//                      another enemy piece, and the solver takes that piece later in the line.
import { exchangeGain, value } from "../text/facts";
import { attackersOf, attacksFrom, boardOf, chessAt, sqIndex, type ThemeContext } from "./context";

/** A loose piece is a knight, bishop, rook or queen (a free pawn is not the motif; measured, CLEANROOM.md "P5"). */
export const MIN_HANGING_VALUE = 3;

export function hangingThemes(ctx: ThemeContext): string[] {
  const out: string[] = [];
  if (isHangingPiece(ctx)) out.push("hangingPiece");
  if (isCapturingDefender(ctx)) out.push("capturingDefender");
  return out;
}

function isHangingPiece(ctx: ThemeContext): boolean {
  const first = ctx.steps[0];
  if (!first || !first.move.captured) return false;
  const taken = value(first.move.captured);
  const uci = `${first.move.from}${first.move.to}${first.move.promotion ?? ""}`;
  const gain = exchangeGain(first.fenBefore, uci);
  if (gain === null || gain < taken || taken < MIN_HANGING_VALUE) return false;
  // Free to take: nobody guards the piece (measured: "insufficiently defended" captures are mostly ordinary trades).
  const before = boardOf(chessAt(first.fenBefore));
  return attackersOf(before, sqIndex(first.move.to), ctx.defender).length === 0;
}

function isCapturingDefender(ctx: ThemeContext): boolean {
  const steps = ctx.steps;
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k]!;
    if (!step.solver || !step.move.captured) continue;
    const before = boardOf(chessAt(step.fenBefore));
    const removed = sqIndex(step.move.to);
    const guarded = attacksFrom(before, removed).filter((sq) => {
      const p = before[sq];
      return p && p.color === ctx.defender && p.type !== "k" && sq !== removed;
    });
    for (let j = k + 2; j < steps.length; j += 2) {
      const later = steps[j]!;
      if (later.solver && later.move.captured && guarded.includes(sqIndex(later.move.to))) return true;
    }
  }
  return false;
}
