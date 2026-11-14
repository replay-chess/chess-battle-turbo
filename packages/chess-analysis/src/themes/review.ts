// Review-position heuristics, the `rc:*` keys (phase-05 plan §8.11, rct-b §3.8): own-mistake patterns that have no
// Lichess theme key. They run only for review positions (a mistake whose best move is not a scored puzzle) and compare
// what the member played with the engine's best move:
//   rc:recapture       the best move recaptures on the square the opponent just captured on, or keeps a recapture
//                      ready (the engine line answers the opponent's capture on a square by taking back there), and
//                      the played move does neither ("Recapture first");
//   rc:defendedTarget  the played move captured a unit defended at least as often as it was attacked, and the capture
//                      loses material ("Defended pawn");
//   rc:pawnStructure   the played pawn move leaves the member more doubled or isolated pawns than the best move does;
//   rc:kingSafety      the played move pushes a pawn of the castled king's shelter, or walks the king while it could
//                      still castle, and the best move does neither;
//   rc:development     in the opening, the best move develops a knight or bishop from its first rank (or castles) and
//                      the played move does not;
//   rc:missedThreat    the opponent's best reply to the played move wins at least 2 pawns of material.
// Board facts come from chess.js and the static exchange (see.ts); nothing is guessed.
import { Chess, type Move } from "chess.js";
import { doubledFiles, exchangeGain, play } from "../text/facts";
import { attackersOf, boardOf, chessAt, fileOf, kingSquareOf, rankOf, sqIndex, type ThemeContext } from "./context";
import { phaseOf } from "./endgame";

function playMoves(fen: string, line: readonly string[]): Move[] {
  const chess = new Chess(fen);
  const out: Move[] = [];
  for (const uci of line) {
    try {
      out.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }));
    } catch {
      break;
    }
  }
  return out;
}

function isolatedPawns(fen: string, color: "w" | "b"): number {
  const board = boardOf(chessAt(fen));
  const files = new Array<number>(8).fill(0);
  for (let s = 0; s < 64; s++) if (board[s]?.type === "p" && board[s]?.color === color) files[fileOf(s)]!++;
  let n = 0;
  for (let f = 0; f < 8; f++) if (files[f]! > 0 && (files[f - 1] ?? 0) === 0 && (files[f + 1] ?? 0) === 0) n += files[f]!;
  return n;
}

function pawnDefects(fen: string, color: "w" | "b"): number {
  return doubledFiles(fen, color) + isolatedPawns(fen, color);
}

/** The position after `first` and, when given and legal, `reply`. */
function after(fen: string, first: string, reply?: string | null): string | null {
  const a = play(fen, first);
  if (!a) return null;
  if (!reply) return a.chess.fen();
  const b = play(a.chess.fen(), reply);
  return b ? b.chess.fen() : a.chess.fen();
}

export function reviewThemes(ctx: ThemeContext): string[] {
  const review = ctx.input.review;
  const best = ctx.input.line[0];
  if (!review || !best || review.playedUci === best) return [];
  const fen = ctx.input.fen;
  const played = play(fen, review.playedUci);
  const bestMove = play(fen, best);
  if (!played || !bestMove) return [];
  const out: string[] = [];
  const pv = review.pv && review.pv[0] === best ? review.pv : [best];
  const solver = ctx.solver;

  // rc:recapture
  let recapture = false;
  if (ctx.input.setupUci && bestMove.move.captured && bestMove.move.to === ctx.input.setupUci.slice(2, 4)) {
    const setupCaptured = ctx.input.setupCaptured === true;
    recapture = setupCaptured && played.move.to !== bestMove.move.to;
  }
  if (!recapture && pv.length >= 3) {
    const line = playMoves(fen, pv.slice(0, 3));
    const reply = line[1];
    const back = line[2];
    recapture = !!(reply?.captured && back?.captured && back.to === reply.to && played.move.to !== reply.to);
  }
  if (recapture) out.push("rc:recapture");

  // rc:defendedTarget
  if (played.move.captured) {
    const board = boardOf(chessAt(fen));
    const t = sqIndex(played.move.to);
    const defenders = attackersOf(board, t, ctx.defender).length;
    const attackers = attackersOf(board, t, solver).length;
    const gain = exchangeGain(fen, review.playedUci);
    if (defenders >= attackers && gain !== null && gain < 0) out.push("rc:defendedTarget");
  }

  // rc:pawnStructure
  if (played.move.piece === "p") {
    const afterPlayed = after(fen, review.playedUci, review.refuteUci);
    const afterBest = after(fen, best, pv[1]);
    if (afterPlayed && afterBest && pawnDefects(afterPlayed, solver) > pawnDefects(afterBest, solver)) {
      out.push("rc:pawnStructure");
    }
  }

  // rc:kingSafety
  const shelterOrWalk = (m: Move): boolean => {
    const board = boardOf(chessAt(fen));
    const king = kingSquareOf(board, solver);
    if (king === null) return false;
    const castling = fen.split(" ")[2] ?? "-";
    const canCastle = solver === "w" ? /[KQ]/.test(castling) : /[kq]/.test(castling);
    if (m.piece === "k" && !m.isKingsideCastle() && !m.isQueensideCastle()) return canCastle;
    if (m.piece !== "p") return false;
    const relKing = solver === "w" ? rankOf(king) : 7 - rankOf(king);
    const castledSide = fileOf(king) >= 5 || fileOf(king) <= 2;
    const from = sqIndex(m.from);
    const relFrom = solver === "w" ? rankOf(from) : 7 - rankOf(from);
    return !canCastle && castledSide && relKing === 0 && relFrom === 1 && Math.abs(fileOf(from) - fileOf(king)) <= 1;
  };
  if (shelterOrWalk(played.move) && !shelterOrWalk(bestMove.move)) out.push("rc:kingSafety");

  // rc:development
  const phase = review.phase ? review.phase.toLowerCase() : phaseOf(fen);
  const develops = (m: Move): boolean => {
    if (m.isKingsideCastle() || m.isQueensideCastle()) return true;
    if (m.piece !== "n" && m.piece !== "b") return false;
    const from = sqIndex(m.from);
    return (solver === "w" ? rankOf(from) : 7 - rankOf(from)) === 0;
  };
  if (phase === "opening" && develops(bestMove.move) && !develops(played.move)) out.push("rc:development");

  // rc:missedThreat
  if (review.refuteUci) {
    const gain = exchangeGain(played.chess.fen(), review.refuteUci);
    if (gain !== null && gain >= 2) out.push("rc:missedThreat");
  }
  return out;
}
