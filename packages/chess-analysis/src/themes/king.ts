// King-attack themes (phase-05 plan §8.11 Tier 1), from the published descriptions:
//   exposedKing      "A tactic involving a king with few defenders around it, often leading to checkmate": no pawn of
//                    the enemy king's own stands next to it (no shelter at all) and the solver gives check or mates;
//   kingsideAttack   "An attack of the opponent's king, after they castled on the king side": the enemy king sits on
//                    the g/h files of its first two ranks, it has no castling right left, and the solver checks it;
//   queensideAttack  the same on the a–c files.
import { attacksFrom, boardOf, chessAt, fileOf, kingSquareOf, rankOf, type ThemeContext } from "./context";

/** An exposed king has at most this many of its own pawns next to it (0: measured, CLEANROOM.md "P5"). */
export const EXPOSED_MAX_SHELTER = 0;

function checks(ctx: ThemeContext): boolean {
  return ctx.steps.some((s) => s.solver && (s.move.san.includes("+") || s.move.san.includes("#")));
}

export function kingThemes(ctx: ThemeContext): string[] {
  const out: string[] = [];
  const start = chessAt(ctx.input.fen);
  const board = boardOf(start);
  const king = kingSquareOf(board, ctx.defender);
  if (king === null || !checks(ctx)) return out;
  const shelter = attacksFrom(board, king).filter((sq) => board[sq]?.color === ctx.defender && board[sq]?.type === "p").length;
  if (shelter <= EXPOSED_MAX_SHELTER) out.push("exposedKing");
  const castling = ctx.input.fen.split(" ")[2] ?? "-";
  const rights = ctx.defender === "w" ? /[KQ]/.test(castling) : /[kq]/.test(castling);
  const rel = ctx.defender === "w" ? rankOf(king) : 7 - rankOf(king);
  if (!rights && rel <= 1) {
    if (fileOf(king) >= 6) out.push("kingsideAttack");
    else if (fileOf(king) <= 2) out.push("queensideAttack");
  }
  return out;
}
