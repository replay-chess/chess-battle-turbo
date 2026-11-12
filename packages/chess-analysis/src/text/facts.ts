// Board facts the template texts are built from (phase-03 plan §8.7, §8.8). Every fact comes from chess.js on a real
// position: a SAN is only ever produced by playing the move, so a template can never name an illegal move, and every
// material claim is a static exchange (see.ts) on the board, never a guess.
//
// Copy conventions shared by every template (P1 §3.11 and the design boards):
// - sentence case, digits for numbers, no emoji, no exclamation marks, the user is "you";
// - typographic apostrophes (’), as the boards write "Black’s knight" and "the engine’s move";
// - a move with its number reads "17.Qc1" for White and "17…Qc1" for Black (codec.ts `moveLabel`).

import { Chess, type Move, type Square } from "chess.js";
import { PIECE_VALUE, type PieceType } from "../board";
import type { Color } from "../codec";
import { see, seeExchange } from "../see";

/** U+2019, the apostrophe every template uses. */
export const APOS = "’";

export const PIECE_NAME: Readonly<Record<PieceType, string>> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export const COLOR_NAME: Readonly<Record<Color, string>> = { w: "White", b: "Black" };

export function other(c: Color): Color {
  return c === "w" ? "b" : "w";
}

/** "a bishop", "an inaccuracy"-style article for a following word. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** Plays a UCI move on a copy of the position; null when the move is not legal there. */
export function play(fen: string, uci: string): { chess: Chess; move: Move } | null {
  const chess = new Chess(fen);
  try {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { chess, move };
  } catch {
    return null;
  }
}

/** SAN of a UCI move, or null when it is not legal in the position. */
export function sanOrNull(fen: string, uci: string | null | undefined): string | null {
  if (!uci) return null;
  return play(fen, uci)?.move.san ?? null;
}

/**
 * Plays a UCI line from a position, stopping at the first move that is not legal. Returns the legal prefix with its
 * moves (SAN, capture flags, the FEN after each).
 */
export function playLine(fen: string, line: readonly string[]): Move[] {
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

/** Material value of a piece type (1/3/3/5/9). */
export function value(t: PieceType | string | undefined): number {
  return t ? (PIECE_VALUE[t as PieceType] ?? 0) : 0;
}

/**
 * Net material the side to move wins with `uci`, counting the exchange that follows on the target square (both sides
 * recapture with their least valuable piece and stop when it stops paying): captured + promotion gain − what the
 * opponent then wins on that square. Positive = the move wins material; negative = it gives some away.
 */
export function exchangeGain(fen: string, uci: string): number | null {
  const p = play(fen, uci);
  if (!p) return null;
  const m = p.move;
  const captured = m.isEnPassant() ? 1 : value(m.captured);
  const promo = m.promotion ? value(m.promotion) - 1 : 0;
  return captured + promo - see(p.chess.fen(), m.to);
}

/** Every piece of `color` (squares and types), kings included. */
export function piecesOf(chess: Chess, color: Color): { sq: Square; type: PieceType }[] {
  const out: { sq: Square; type: PieceType }[] = [];
  for (const row of chess.board()) {
    for (const cell of row)
      if (cell && cell.color === color) out.push({ sq: cell.square, type: cell.type as PieceType });
  }
  return out;
}

/** Pieces of `color` attacking `sq` (chess.js geometry: pins are ignored, as in a defender count). */
export function attackersOf(chess: Chess, sq: Square, color: Color): Square[] {
  return chess.attackers(sq, color);
}

/** The squares around a king (up to 8). */
export function kingZone(kingSq: Square): Square[] {
  const f = kingSq.charCodeAt(0) - 97;
  const r = Number(kingSq[1]) - 1;
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(`${String.fromCharCode(97 + nf)}${nr + 1}` as Square);
    }
  }
  return out;
}

export function kingSquare(chess: Chess, color: Color): Square | null {
  return chess.findPiece({ type: "k", color })[0] ?? null;
}

/** Files (a–h) on which `color` has two or more pawns. */
export function doubledFiles(fen: string, color: Color): number {
  const chess = new Chess(fen);
  const perFile = new Array<number>(8).fill(0);
  for (const p of piecesOf(chess, color)) if (p.type === "p") perFile[p.sq.charCodeAt(0) - 97]!++;
  return perFile.filter((n) => n >= 2).length;
}

/**
 * Whether a piece of `owner` on `sq` is under-protected: attacked and either undefended, attacked more often than it
 * is defended, or attacked by a cheaper piece.
 */
export function underProtected(chess: Chess, sq: Square, owner: Color): boolean {
  const piece = chess.get(sq);
  if (!piece || piece.color !== owner || piece.type === "k") return false;
  const attackers = attackersOf(chess, sq, other(owner));
  if (attackers.length === 0) return false;
  const defenders = attackersOf(chess, sq, owner);
  if (defenders.length === 0 || defenders.length < attackers.length) return true;
  const cheapest = Math.min(...attackers.map((a) => value(chess.get(a)?.type)));
  return cheapest < value(piece.type);
}

const COUNT_WORD = ["", "", "two", "three", "four", "five", "six", "seven", "eight"];

/** "a pawn", "two pawns", "the queen". */
function piecesWord(type: PieceType, n: number): string {
  if (n === 1) return type === "q" ? "the queen" : article(PIECE_NAME[type]);
  return `${COUNT_WORD[n] ?? String(n)} ${PIECE_NAME[type]}s`;
}

/** "a knight", "a knight and a pawn", "a rook, a knight and a pawn" (most valuable first, equal pieces counted). */
function piecesList(pieces: readonly PieceType[]): string {
  const counts = new Map<PieceType, number>();
  for (const p of [...pieces].sort((a, b) => value(b) - value(a))) counts.set(p, (counts.get(p) ?? 0) + 1);
  const words = [...counts].map(([t, n]) => piecesWord(t, n));
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A trade with the pieces both sides took in it removed: what the mover gave up and what it got for that. */
export interface SettledTrade {
  /** Pieces the mover lost that it did not get back in kind, most valuable first. */
  lost: PieceType[];
  /** Pieces the mover took that do not cancel a loss of the same kind, most valuable first. */
  gained: PieceType[];
}

/** Cancels equal piece types between the two sides of a trade (a bishop for a bishop is no loss). Kings never count. */
export function settleTrade(lost: readonly PieceType[], gained: readonly PieceType[]): SettledTrade {
  const l = lost.filter((p) => p !== "k");
  const g = gained.filter((p) => p !== "k");
  for (let i = l.length - 1; i >= 0; i--) {
    const j = g.indexOf(l[i]!);
    if (j >= 0) {
      l.splice(i, 1);
      g.splice(j, 1);
    }
  }
  const desc = (a: PieceType, b: PieceType) => value(b) - value(a);
  return { lost: l.sort(desc), gained: g.sort(desc) };
}

/**
 * "a bishop", "a bishop for a pawn", "the queen for a knight and a pawn", "the exchange", from every piece the mover
 * lost and every piece it took in the sequence (pieces of the same kind on both sides cancel), or null when nothing is
 * left lost. Named from the piece types on the board, never from their values: a bishop and a knight are both worth 3.
 */
export function tradePhrase(lost: readonly PieceType[], gained: readonly PieceType[]): string | null {
  const t = settleTrade(lost, gained);
  if (t.lost.length === 0) return null;
  if (t.lost.length === 1 && t.lost[0] === "r" && t.gained.length === 1 && (t.gained[0] === "n" || t.gained[0] === "b")) {
    return "the exchange";
  }
  const lostWords = piecesList(t.lost);
  return t.gained.length === 0 ? lostWords : `${lostWords} for ${piecesList(t.gained)}`;
}

/** `tradePhrase` for one piece lost and at most one taken ("the queen for a knight", "the exchange", "a bishop"). */
export function materialPhrase(lost: PieceType, gained: PieceType | null): string {
  return tradePhrase([lost], gained ? [gained] : []) ?? article(PIECE_NAME[lost]);
}

export interface ReplyLoss {
  /** The reply as played (SAN). */
  replySan: string;
  /** Net material the mover is down after the played move, the reply and the exchange on the reply's square. */
  net: number;
  /** The most valuable piece the mover lost in that sequence. */
  lostPiece: PieceType | null;
  /** Material the mover took with the played move. */
  gained: number;
  /** The piece the mover took with the played move (a pawn for en passant), or null. */
  gainedPiece: PieceType | null;
  /** Every piece the mover lost: the one the reply took, then the opponent's captures in the exchange that follows. */
  lostPieces: PieceType[];
  /** Every piece the mover took: with the played move, then its captures in the exchange on the reply's square. */
  gainedPieces: PieceType[];
  check: boolean;
  mate: boolean;
}

/**
 * What the opponent's reply does to the mover after `played`: the reply (`reply`, UCI, legal after `played`), the
 * material balance change once the exchange on the reply's square settles, the pieces each side took in that
 * sequence, and check/mate flags. Null when either move is not legal (a stale line proves nothing).
 */
export function replyLoss(fenBefore: string, played: string, reply: string | null | undefined): ReplyLoss | null {
  if (!reply) return null;
  const first = play(fenBefore, played);
  if (!first) return null;
  const gainedPiece = first.move.isEnPassant() ? "p" : ((first.move.captured as PieceType | undefined) ?? null);
  const gained = value(gainedPiece ?? undefined);
  const afterPlayed = first.chess.fen();
  const second = play(afterPlayed, reply);
  if (!second) return null;
  const replyTook: PieceType | null = second.move.isEnPassant()
    ? "p"
    : ((second.move.captured as PieceType | undefined) ?? null);
  const lostValue = value(replyTook ?? undefined);
  // What the mover wins back by recapturing on the reply's square (0 when the square cannot be retaken), with the
  // pieces both sides take in that exchange.
  const exchange = replyTook
    ? seeExchange(second.chess.fen(), second.move.to)
    : { value: 0, captures: [] as PieceType[] };
  const net = lostValue - exchange.value - gained;
  const lostPieces: PieceType[] = replyTook ? [replyTook] : [];
  const gainedPieces: PieceType[] = gainedPiece ? [gainedPiece] : [];
  exchange.captures.forEach((p, i) => (i % 2 === 0 ? gainedPieces : lostPieces).push(p));
  return {
    replySan: second.move.san,
    net,
    lostPiece: second.move.captured && !second.move.isEnPassant() ? (second.move.captured as PieceType) : null,
    gained,
    gainedPiece,
    lostPieces,
    gainedPieces,
    check: second.move.san.endsWith("+"),
    mate: second.move.san.endsWith("#"),
  };
}

/** One sentence of review text (ReviewContentV1 `Sentence`). */
export interface Sentence {
  t: string;
  /** Passed the P7 verifier; always false for template text (P3-D16). */
  v: boolean;
}

/** A template sentence (never verifier output, so `v` is false). */
export const sentence = (t: string): Sentence => ({ t, v: false });

/** The first sentence of a list of sentences (a "why"), or null. */
export function firstSentence(sentences: readonly { t: string }[]): string | null {
  return sentences[0]?.t ?? null;
}
