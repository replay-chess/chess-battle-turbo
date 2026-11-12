// Plan intent of the engine's move and the plan-chip feedback (phase-03 plan §8.8).
//
// intent(best, position), first match:
//   1 attack   the move gives check, or the moved piece attacks a square next to the enemy king that only the
//              king defends (a square other pieces also cover is not a weakness the move attacks)
//   2 trade    the move captures and does not lose material in the exchange that follows (SEE ≥ 0)
//   3 defend   the side to move was in check (the move answers it: a block or a king move; a capture of the checker
//              that holds material is already `trade`), or the move takes a piece that was attacked and
//              under-protected out of danger, or it adds a defender to another attacked piece
//   4 improve  anything else (its fact names an enemy piece the move newly attacks, when there is one)
//
// "Under-protected" (facts.ts) = attacked and undefended, attacked more often than defended, or attacked by a cheaper
// piece. Each intent also yields a short fact about the move ("Rxf5 wins the bishop on f5"), which the chip feedback
// and the "why" fallback use.
//
// Chip feedback, precomputed for all five chips so a tap needs no network:
//   chip = intent  → "Right instinct. {first why sentence}"
//   chip = unsure  → "The engine’s idea here was to {intent}: {bestSan}."
//   otherwise      → "You were thinking: {chip}. The engine’s idea here was to {intent}: {bestSan} {fact}."

import type { Square } from "chess.js";
import { Chess } from "chess.js";
import type { PieceType } from "./board";
import type { Color } from "./codec";
import {
  APOS,
  attackersOf,
  exchangeGain,
  kingSquare,
  kingZone,
  other,
  PIECE_NAME,
  piecesOf,
  play,
  underProtected,
  value,
} from "./text/facts";

export type Intent = "attack" | "defend" | "trade" | "improve";
export type PlanChip = Intent | "unsure";
/** The five chips in the board's order (Attack, Defend, Trade, Improve a piece, Not sure). */
export const PLAN_CHIPS: readonly PlanChip[] = ["attack", "defend", "trade", "improve", "unsure"];

/** How a chip or an intent reads inside a sentence ("to improve a piece"). */
export const INTENT_WORDS: Readonly<Record<PlanChip, string>> = {
  attack: "attack",
  defend: "defend",
  trade: "trade",
  improve: "improve a piece",
  unsure: "not sure",
};

/** The longest chip feedback string (ReviewContentV1 `plan` values are ≤ 200). */
export const PLAN_TEXT_MAX = 200;

export interface IntentResult {
  intent: Intent;
  /** SAN of the engine's move. */
  san: string;
  /** What the move does, as a predicate after the SAN: "gives check", "wins the bishop on f5". */
  fact: string;
}

/**
 * The piece on `from` attacks a square next to the enemy king that only the king defends (f7 after 2.Qh5). A square
 * the king's other pieces also cover is not counted: a capture that merely eyes a well-guarded pawn shield is a
 * trade, not an attack on the king.
 */
function attacksKingZone(chess: Chess, from: Square, enemy: Color): boolean {
  const k = kingSquare(chess, enemy);
  if (!k) return false;
  return kingZone(k).some(
    (sq) =>
      attackersOf(chess, sq, other(enemy)).includes(from) &&
      attackersOf(chess, sq, enemy).every((defender) => defender === k),
  );
}

/** The engine's idea for `bestUci` in `fen` (§8.8). Throws a RangeError when the move is not legal there. */
export function intentOf(fen: string, bestUci: string): IntentResult {
  const before = new Chess(fen);
  const mover = before.turn();
  const enemy = other(mover);
  const p = play(fen, bestUci);
  if (!p) throw new RangeError(`illegal move ${bestUci} in ${fen}`);
  const { chess: after, move } = p;
  const san = move.san;
  const piece = PIECE_NAME[move.piece as PieceType];

  // 1 attack
  if (after.inCheck()) return { intent: "attack", san, fact: "gives check" };
  if (attacksKingZone(after, move.to, enemy)) {
    return { intent: "attack", san, fact: `aims the ${piece} at the king` };
  }

  // 2 trade
  if (move.captured || move.isEnPassant()) {
    const gain = exchangeGain(fen, bestUci) ?? 0;
    if (gain >= 0) {
      const target = move.isEnPassant() ? "pawn" : PIECE_NAME[move.captured as PieceType];
      const sq = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
      return { intent: "trade", san, fact: gain > 0 ? `wins the ${target} on ${sq}` : `trades on ${sq}` };
    }
  }

  // 3 defend
  if (before.inCheck()) return { intent: "defend", san, fact: "answers the check" };
  if (underProtected(before, move.from, mover)) {
    return { intent: "defend", san, fact: `takes the ${piece} on ${move.from} out of danger` };
  }
  for (const own of piecesOf(after, mover)) {
    if (own.sq === move.to || own.type === "k") continue;
    const attacked = attackersOf(after, own.sq, enemy).length > 0;
    if (!attacked) continue;
    const defendersAfter = attackersOf(after, own.sq, mover).length;
    const defendersBefore = attackersOf(before, own.sq, mover).length;
    if (defendersAfter > defendersBefore) {
      return { intent: "defend", san, fact: `protects the ${PIECE_NAME[own.type]} on ${own.sq}` };
    }
  }

  // 4 improve: name an enemy piece the move newly attacks when there is one ("challenges the bishop on g3").
  let target: { sq: Square; type: PieceType } | null = null;
  for (const e of piecesOf(after, enemy)) {
    if (e.type === "k" || e.type === "p") continue;
    if (!attackersOf(after, e.sq, mover).includes(move.to)) continue;
    if (attackersOf(before, e.sq, mover).includes(move.from)) continue;
    if (!target || value(e.type) > value(target.type)) target = e;
  }
  if (target) return { intent: "improve", san, fact: `challenges the ${PIECE_NAME[target.type]} on ${target.sq}` };
  return { intent: "improve", san, fact: `brings the ${piece} to ${move.to}` };
}

/**
 * Feedback for every chip (§8.8). `whyFirst` is the first "why" sentence of the moment; when "Right instinct." plus
 * it would pass PLAN_TEXT_MAX, the engine's fact stands in for it.
 */
export function chipFeedback(it: IntentResult, whyFirst: string | null): Record<PlanChip, string> {
  const fact = `${it.san} ${it.fact}.`;
  const idea = `The engine${APOS}s idea here was to ${INTENT_WORDS[it.intent]}`;
  const right = whyFirst && `Right instinct. ${whyFirst}`.length <= PLAN_TEXT_MAX ? whyFirst : fact;
  const out = {} as Record<PlanChip, string>;
  for (const chip of PLAN_CHIPS) {
    if (chip === it.intent) out[chip] = `Right instinct. ${right}`;
    else if (chip === "unsure") out[chip] = `${idea}: ${it.san}.`;
    else {
      const long = `You were thinking: ${INTENT_WORDS[chip]}. ${idea}: ${fact}`;
      out[chip] = long.length <= PLAN_TEXT_MAX ? long : `You were thinking: ${INTENT_WORDS[chip]}. ${idea}: ${it.san}.`;
    }
  }
  return out;
}
