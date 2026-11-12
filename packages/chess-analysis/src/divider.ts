// Phase division: opening → middlegame → endgame (phase-03 plan §8.3, RES R-ACC-03).
//
// A port of scalachess `Divider` (core/src/main/scala/Divider.scala at tag 18.1.0, commit 0e813dd9), which is
// MIT-licensed: "Copyright (c) 2012-2014 Thibault Duplessis" (licence verified from the scalachess LICENSE file at
// that tag before porting, FEA V8). The full notice is in NOTICE.md. Only the divider is ported; scalachess is a
// separate project from Lichess's AGPL server (lila), which stays out of bounds under CLEANROOM.md.
//
// For each position (index = plies played, 0 = the start position):
// - majorsAndMinors: the count of knights, bishops, rooks and queens of both colours;
// - backrankSparse: fewer than 4 White pieces on rank 1, or fewer than 4 Black pieces on rank 8;
// - mixedness: the sum over the 49 overlapping 2×2 regions of a score of how White and Black pieces mix there,
//   weighted by how far up the board the region sits.
// middlegamePly = the first position where majorsAndMinors ≤ 10, or backrankSparse, or mixedness > 150.
// endgamePly = the first position where majorsAndMinors ≤ 6 (only looked for once a middlegame exists).
// As in scalachess, the middlegame is dropped when it would not start before the endgame.
//
// [V] "verify the constants against the pinned scalachess tag before freezing": done. 10, 6, 4 and 150, the region
// grid (x, y ∈ 0…6, regions 0x0303 << (x + 8y), score row = y + 1) and the score table below are copied from
// tag 18.1.0. The oracle (`divider.test.ts`) reproduces Lichess's published `division` for the fixture games.
//
// Games from a FEN start may begin in any phase: position 0 is tested like every other, so a start position that
// already meets a rule gives middlegamePly or endgamePly = 0. Imported Lichess games (P4) use the API's division.

import type { Piece } from "./board";
import { placement } from "./board";

export const MIDDLEGAME_MAX_PIECES = 10;
export const ENDGAME_MAX_PIECES = 6;
export const BACKRANK_MIN_PIECES = 4;
export const MIXEDNESS_MIN = 150;

export interface Division {
  /** First position (= plies played) of the middlegame, or null when the game never left the opening. */
  middlegamePly: number | null;
  /** First position of the endgame, or null when the game never reached one. */
  endgamePly: number | null;
}

function majorsAndMinors(board: readonly (Piece | null)[]): number {
  let c = 0;
  for (const p of board) if (p && p.type !== "k" && p.type !== "p") c++;
  return c;
}

function backrankSparse(board: readonly (Piece | null)[]): boolean {
  let white = 0;
  let black = 0;
  for (let f = 0; f < 8; f++) {
    if (board[f]?.color === "w") white++;
    if (board[56 + f]?.color === "b") black++;
  }
  return white < BACKRANK_MIN_PIECES || black < BACKRANK_MIN_PIECES;
}

/** scalachess `Divider.score(y, white, black)`: y is the region's row (1 … 7), white/black the piece counts in it. */
function score(y: number, white: number, black: number): number {
  switch (white) {
    case 0:
      switch (black) {
        case 1:
          return 1 + y;
        case 2:
          return y < 6 ? 2 + (6 - y) : 0;
        case 3:
          return y < 7 ? 3 + (7 - y) : 0;
        case 4:
          return y < 7 ? 3 + (7 - y) : 0;
        default:
          return 0;
      }
    case 1:
      switch (black) {
        case 0:
          return 1 + (8 - y);
        case 1:
          return 5 + Math.abs(4 - y);
        case 2:
          return 4 + (7 - y);
        case 3:
          return 5 + (7 - y);
        default:
          return 0;
      }
    case 2:
      switch (black) {
        case 0:
          return y > 2 ? 2 + (y - 2) : 0;
        case 1:
          return 4 + (y - 1);
        case 2:
          return 7;
        default:
          return 0;
      }
    case 3:
      switch (black) {
        case 0:
          return y > 1 ? 3 + (y - 1) : 0;
        case 1:
          return 5 + (y - 1);
        default:
          return 0;
      }
    case 4:
      switch (black) {
        case 0:
          return y > 1 ? 3 + (y - 1) : 0; // a group of 4 on the home row scores 0
        default:
          return 0;
      }
    default:
      return 0;
  }
}

/** scalachess `Divider.mixedness`: 49 overlapping 2×2 regions, region (x, y) covers files x, x+1 and ranks y, y+1. */
export function mixedness(board: readonly (Piece | null)[]): number {
  let acc = 0;
  for (let y = 0; y <= 6; y++) {
    for (let x = 0; x <= 6; x++) {
      let white = 0;
      let black = 0;
      for (const sq of [x + 8 * y, x + 1 + 8 * y, x + 8 * (y + 1), x + 1 + 8 * (y + 1)]) {
        const p = board[sq];
        if (p?.color === "w") white++;
        else if (p?.color === "b") black++;
      }
      acc += score(y + 1, white, black);
    }
  }
  return acc;
}

/** Division of a game from its positions' FENs (index 0 = the start position, index i = after i plies). */
export function divide(fens: readonly string[]): Division {
  const boards = fens.map(placement);
  const mid = boards.findIndex(
    (b) => majorsAndMinors(b) <= MIDDLEGAME_MAX_PIECES || backrankSparse(b) || mixedness(b) > MIXEDNESS_MIN,
  );
  if (mid < 0) return { middlegamePly: null, endgamePly: null };
  const endIdx = boards.findIndex((b) => majorsAndMinors(b) <= ENDGAME_MAX_PIECES);
  const end = endIdx < 0 ? null : endIdx;
  return { middlegamePly: end === null || mid < end ? mid : null, endgamePly: end };
}
