import { Chess } from "chess.js";

/**
 * Chess-correctness fixtures for the socket tests (plan §12.5).
 *
 * The FENs are copied from `packages/db/prisma/fixtures/design-legend-positions.ts` (1A·P6):
 * the socket app cannot import from the web app (its `tsc` build has `rootDir: "."`).
 * `restore.test.ts` checks that each history replays to exactly that FEN.
 */

/** A stored history entry as the socket persists it: a verbose chess.js move. */
export type StoredMove = Record<string, unknown>;

/** Replays SAN moves from `startingFen` and returns the verbose history the socket stores. */
export function toStoredHistory(sanMoves: readonly string[], startingFen?: string): StoredMove[] {
  const chess = startingFen ? new Chess(startingFen) : new Chess();
  for (const san of sanMoves) chess.move(san);
  // JSON round trip: what comes back from `gameData.moveHistory` is plain objects.
  return JSON.parse(JSON.stringify(chess.history({ verbose: true }))) as StoredMove[];
}

export const STANDARD_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------------------------------------------------------------------------------------------
// Kasparov–Topalov, Wijk aan Zee 1999
// ---------------------------------------------------------------------------------------------

/** Moves 1–23 (46 plies), up to the position before 24.Rxd4. */
export const KASPAROV_TOPALOV_SAN: readonly string[] = [
  "e4", "d6", "d4", "Nf6", "Nc3", "g6", "Be3", "Bg7", "Qd2", "c6",
  "f3", "b5", "Nge2", "Nbd7", "Bh6", "Bxh6", "Qxh6", "Bb7", "a3", "e5",
  "O-O-O", "Qe7", "Kb1", "a6", "Nc1", "O-O-O", "Nb3", "exd4", "Rxd4", "c5",
  "Rd1", "Nb6", "g3", "Kb8", "Na5", "Ba8", "Bh3", "d5", "Qf4+", "Ka7",
  "Rhe1", "d4", "Nd5", "Nbxd5", "exd5", "Qd6",
];

/** `design-legend-positions.ts` key "kt": the position after 23...Qd6. */
export const KASPAROV_TOPALOV_FEN = "b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24";

/** The 40-ply legal history of plan §12.5 (through 20...Ka7). */
export const LEGAL_HISTORY_40: readonly StoredMove[] = toStoredHistory(KASPAROV_TOPALOV_SAN.slice(0, 40));
export const LEGAL_HISTORY_40_FEN = "b2r3r/k3qp1p/pn3np1/Nppp4/4PQ2/P1N2PPB/1PP4P/1K1R3R w - - 2 21";

/** All 46 plies; replays to KASPAROV_TOPALOV_FEN. */
export const LEGAL_HISTORY_46: readonly StoredMove[] = toStoredHistory(KASPAROV_TOPALOV_SAN);

/**
 * The same history with ply 7 replaced by a knight move from an empty square: after 3.Nc3 the
 * b1 square is empty, so "Nb1-d2" is illegal. A restore must refuse it.
 */
export const ILLEGAL_HISTORY: readonly StoredMove[] = [
  ...LEGAL_HISTORY_40.slice(0, 6),
  { color: "w", piece: "n", from: "b1", to: "d2", san: "Nd2" },
  ...LEGAL_HISTORY_40.slice(7),
];
export const ILLEGAL_PLY = 7;

// ---------------------------------------------------------------------------------------------
// The Opera Game, Morphy vs Duke Karl / Count Isouard, Paris 1858
// ---------------------------------------------------------------------------------------------

/** `OPERA_GAME_PGN` of the web fixture: 9 moves, 18 plies. */
export const OPERA_GAME_SAN: readonly string[] = [
  "e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5",
  "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5",
];
/** `design-legend-positions.ts` key "mo". */
export const OPERA_GAME_FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
export const OPERA_HISTORY: readonly StoredMove[] = toStoredHistory(OPERA_GAME_SAN);

/**
 * Draw-offer sequence on top of the Opera Game (White to move): White offers, then plays
 * 10.Nxb5, which must clear the offer; Black answers 10...cxb5.
 */
export const DRAW_SEQUENCE = {
  whiteMove: { from: "c3", to: "b5" },
  blackReply: { from: "c6", to: "b5" },
} as const;

// ---------------------------------------------------------------------------------------------
// Final-move persistence (H6 #7)
// ---------------------------------------------------------------------------------------------

/** White mates in one with Ra8#. */
export const MATE_IN_ONE_FEN = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
export const MATE_IN_ONE_MOVE = { from: "a1", to: "a8", san: "Ra8#" } as const;
