// Position identity for the Mistake Bank (phase-05 plan §8.1 step 6, R-ENG-07; signatures §3).
//
// A bank item is deduped per (user, position): the same opening error in five games is one card "seen in 5 games".
// The position key is the EPD (the first four FEN fields: placement, side to move, castling rights, en passant square,
// exactly as written in the FEN; the halfmove clock and the move number are dropped, so transpositions and repeated
// positions hash equal). `epdHash` is FNV-1a 64 over the EPD's UTF-8 bytes, read as a signed int64 so it fits
// Postgres `bigint` (`mistakes."epdHash"`). The TrainingCard API key is built from it (`m_<sqid>`,
// @repo/chess-training/items), so the worker knows a card's key before the mistake row exists.
//
// FNV-1a is public domain (Fowler/Noll/Vo); the offset basis and prime are the published 64-bit constants.

import { epdOf } from "./board";

/** FNV-1a 64-bit offset basis. */
export const FNV64_OFFSET = 0xcbf29ce484222325n;
/** FNV-1a 64-bit prime. */
export const FNV64_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

/** The EPD of a FEN: placement, side to move, castling, en passant (single spaces). Throws on a short FEN. */
export function epd(fen: string): string {
  return epdOf(fen);
}

/** FNV-1a 64 of a string's UTF-8 bytes, unsigned. */
export function fnv1a64(text: string): bigint {
  let h = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h;
}

/** `mistakes."epdHash"`: FNV-1a 64 of the position's EPD as a signed int64 (move counters ignored). */
export function epdHash(fen: string): bigint {
  return BigInt.asIntN(64, fnv1a64(epd(fen)));
}
