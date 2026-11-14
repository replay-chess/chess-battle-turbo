// trappedPiece (phase-05 plan §8.11 Tier 1; the published description: "A piece is unable to escape capture as it has
// limited moves"). After a solver move (defender to move, not in check) an enemy knight, bishop, rook or queen that is
// not pinned is attacked, staying
// loses material (the solver wins material by taking it), and every legal move of it loses material too (it lands
// where the solver wins it, or it captures something and is lost in the exchange); and the line then wins it: a later
// solver move captures a piece of that kind.
import { Chess, type Square } from "chess.js";
import { PIECE_VALUE, type PieceType } from "../board";
import { see } from "../see";
import { exchangeGain } from "../text/facts";
import { boardOf, pinsBy, sqName, type ThemeContext } from "./context";

/** The same position with the other side to move (en passant cleared), or null when that is not a legal FEN. */
function flipped(fen: string): string | null {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  const f = parts.join(" ");
  try {
    new Chess(f);
    return f;
  } catch {
    return null;
  }
}

function trappedOn(fen: string, sq: Square, ctx: ThemeContext): boolean {
  const chess = new Chess(fen);
  const piece = chess.get(sq);
  if (!piece || piece.color !== ctx.defender || piece.type === "p" || piece.type === "k") return false;
  if (!chess.isAttacked(sq, ctx.solver)) return false;
  const stay = flipped(fen);
  if (stay === null || see(stay, sq) <= 0) return false;
  const value = PIECE_VALUE[piece.type as PieceType];
  for (const m of chess.moves({ square: sq, verbose: true })) {
    const gain = exchangeGain(fen, `${m.from}${m.to}${m.promotion ?? ""}`);
    // A move that keeps the material (gain ≥ 0) is an escape; capturing something worth the piece is one too.
    if (gain === null || gain >= 0 || (m.captured && PIECE_VALUE[m.captured as PieceType] >= value)) return false;
  }
  return true;
}

export function isTrappedPiece(ctx: ThemeContext): boolean {
  const steps = ctx.steps;
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k]!;
    if (!step.solver) continue;
    const chess = new Chess(step.fenAfter);
    // In check every other piece is frozen, and a pinned piece is the pin theme: neither is a trap.
    if (chess.inCheck()) continue;
    const pinned = new Set(pinsBy(boardOf(chess), ctx.solver).map((p) => p.pinned));
    for (let i = 0; i < 64; i++) {
      if (pinned.has(i)) continue;
      const sq = sqName(i);
      const p = chess.get(sq);
      if (!p || p.color !== ctx.defender || p.type === "p" || p.type === "k") continue;
      if (!trappedOn(step.fenAfter, sq, ctx)) continue;
      if (steps.slice(k + 1).some((s) => s.solver && s.move.captured === p.type)) return true;
    }
  }
  return false;
}
