// Meta and special-move themes (phase-05 plan §8.11 Tier 1), from the published descriptions:
//   length    oneMove "A puzzle that is only one move long", short "Two moves to win", long "Three moves to win",
//             veryLong "Four moves or more to win" (the solver's moves; the plan's 2 / 4 / 6 / ≥ 8 plies counted with
//             the opponent's setup move);
//   eval      crushing "obtain a crushing advantage (eval ≥ 600 cp)", advantage "a decisive advantage (200 cp ≤ eval ≤
//             600 cp)", equality "secure a draw or a balanced position (eval ≤ 200 cp)" — only with a known engine eval
//             and never for a mating line (that is `mate`);
//   enPassant "A tactic involving the en passant rule", castling "Bring the king to safety, and deploy the rook for
//             attack": a move of the line captures en passant / the solver castles.
// Meta tags are never the primary theme (index.ts).
import { endsInMate } from "./mate";
import type { ThemeContext } from "./context";

export const CRUSHING_CP = 600;
export const ADVANTAGE_CP = 200;

export function lengthTheme(solverMoves: number): "oneMove" | "short" | "long" | "veryLong" {
  if (solverMoves <= 1) return "oneMove";
  if (solverMoves === 2) return "short";
  if (solverMoves === 3) return "long";
  return "veryLong";
}

export function metaThemes(ctx: ThemeContext): string[] {
  const out: string[] = [];
  const solverMoves = Math.ceil(ctx.steps.length / 2);
  if (solverMoves > 0) out.push(lengthTheme(solverMoves));
  const mating = endsInMate(ctx) || (ctx.input.mateIn ?? null) !== null;
  const cp = ctx.input.cp;
  if (!mating && typeof cp === "number") {
    out.push(cp > CRUSHING_CP ? "crushing" : cp >= ADVANTAGE_CP ? "advantage" : "equality");
  }
  if (ctx.steps.some((s) => s.move.isEnPassant())) out.push("enPassant");
  if (ctx.steps.some((s) => s.solver && (s.move.isKingsideCastle() || s.move.isQueensideCastle()))) out.push("castling");
  return out;
}
