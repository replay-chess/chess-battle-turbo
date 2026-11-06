// Realistic move data for the contract tests (phase-02 plan §7.4.6 size budgets, §12.1). Generated once with
// chess.js 1.4.0 (seeded mulberry32 random games; the Opera Game is Morphy vs Brunswick & Isouard, Paris 1858).
// The Opera start is the longest seeded legend prefix on the dev database (18 plies, through 9...b5).
// Data only: contracts has no chess.js dependency, so these lists are frozen here.

/** The Opera Game (L.MAIN of the V3Game boards) to 17.Rd8#. */
export const OPERA_UCI = [
  "e2e4", "e7e5", "g1f3", "d7d6", "d2d4", "c8g4", "d4e5", "g4f3", "d1f3", "d6e5", "f1c4", "g8f6", "f3b3", "d8e7",
  "b1c3", "c7c6", "c1g5", "b7b5", "c3b5", "c6b5", "c4b5", "b8d7", "e1c1", "a8d8", "d1d7", "d8d7", "h1d1", "e7e6",
  "b5d7", "f6d7", "b3b8", "d7b8", "d1d8",
] as const;

export const OPERA_SAN = [
  "e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6",
  "Bg5", "b5", "Nxb5", "cxb5", "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+", "Nxd7",
  "Qb8+", "Nxb8", "Rd8#",
] as const;

/** FEN after each ply of OPERA_UCI (index i = after ply i + 1). */
export const OPERA_FENS = [
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
  "rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
  "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3",
  "rn1qkbnr/ppp2ppp/3p4/4p3/3PP1b1/5N2/PPP2PPP/RNBQKB1R w KQkq - 1 4",
  "rn1qkbnr/ppp2ppp/3p4/4P3/4P1b1/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 4",
  "rn1qkbnr/ppp2ppp/3p4/4P3/4P3/5b2/PPP2PPP/RNBQKB1R w KQkq - 0 5",
  "rn1qkbnr/ppp2ppp/3p4/4P3/4P3/5Q2/PPP2PPP/RNB1KB1R b KQkq - 0 5",
  "rn1qkbnr/ppp2ppp/8/4p3/4P3/5Q2/PPP2PPP/RNB1KB1R w KQkq - 0 6",
  "rn1qkbnr/ppp2ppp/8/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R b KQkq - 1 6",
  "rn1qkb1r/ppp2ppp/5n2/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R w KQkq - 2 7",
  "rn1qkb1r/ppp2ppp/5n2/4p3/2B1P3/1Q6/PPP2PPP/RNB1K2R b KQkq - 3 7",
  "rn2kb1r/ppp1qppp/5n2/4p3/2B1P3/1Q6/PPP2PPP/RNB1K2R w KQkq - 4 8",
  "rn2kb1r/ppp1qppp/5n2/4p3/2B1P3/1QN5/PPP2PPP/R1B1K2R b KQkq - 5 8",
  "rn2kb1r/pp2qppp/2p2n2/4p3/2B1P3/1QN5/PPP2PPP/R1B1K2R w KQkq - 0 9",
  "rn2kb1r/pp2qppp/2p2n2/4p1B1/2B1P3/1QN5/PPP2PPP/R3K2R b KQkq - 1 9",
  "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10",
  "rn2kb1r/p3qppp/2p2n2/1N2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 10",
  "rn2kb1r/p3qppp/5n2/1p2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R w KQkq - 0 11",
  "rn2kb1r/p3qppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 11",
  "r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R w KQkq - 1 12",
  "r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R b kq - 2 12",
  "3rkb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w k - 3 13",
  "3rkb1r/p2Rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2K4R b k - 0 13",
  "4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2K4R w k - 0 14",
  "4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 1 14",
  "4kb1r/p2r1ppp/4qn2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 2 15",
  "4kb1r/p2B1ppp/4qn2/4p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 0 15",
  "4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16",
  "1Q2kb1r/p2n1ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 b k - 1 16",
  "1n2kb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 w k - 0 17", "1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17",
] as const;

/** Legend start: the position after 9...b5, White to move (prefix of 18 plies). */
export const OPERA_PREFIX_PLIES = 18;
export const OPERA_START_FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
export const OPERA_PREFIX_SANS = "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5";

/** 80 legal plies from the initial position (seed 1). */
export const GAME80_UCI = [
  "g2g3", "b8c6", "f2f3", "c6a5", "g1h3", "b7b5", "d2d3", "h7h6", "c2c3", "b5b4", "e2e4", "e7e5", "g3g4", "g8e7",
  "h3g1", "h8g8", "c1f4", "c8b7", "a2a4", "h6h5", "c3c4", "a7a6", "f4e5", "d7d6", "b1d2", "d6e5", "d2b1", "d8d4",
  "d1e2", "a5b3", "b1c3", "b7c6", "a1a3", "c6b5", "e2c2", "e8c8", "a3a2", "d4e3", "c3e2", "e7c6", "a2a1", "f8c5",
  "g4g5", "b3c1", "h2h3", "d8d7", "f3f4", "c8b8", "c2b1", "e3e2", "f1e2", "c1e2", "e1d2", "g7g6", "h3h4", "c5e7",
  "h1h2", "e2g3", "b1a2", "g3f5", "a1e1", "f5e3", "c4b5", "b8b7", "e1b1", "b7a7", "b1a1", "e7g5", "g1e2", "g5d8",
  "f4e5", "c6d4", "a1g1", "g8g7", "g1a1", "a7b7", "d2e3", "d8h4", "a2b1", "f7f6",
] as const;
export const GAME80_FEN = "8/1kpr2r1/p4pp1/1P2P2p/Pp1nP2b/3PK3/1P2N2R/RQ6 w - - 0 41";

/** 80 legal plies from OPERA_START_FEN (seed 7). */
export const OPERA80_UCI = [
  "g5f6", "b8a6", "e1c1", "h7h5", "a2a4", "e7b4", "c3e2", "h8h6", "e2g3", "b4d6", "c4f7", "e8d7", "c1b1", "a6b4",
  "f6g7", "d7c7", "b3b4", "d6e6", "b4d6", "e6d6", "g7h8", "h6f6", "f7d5", "f8h6", "d5g8", "c7b7", "f2f4", "f6f5",
  "g8e6", "f5f8", "b2b4", "d6d8", "b1a1", "e5f4", "a1a2", "h5h4", "d1e1", "a8c8", "e6d7", "f8g8", "e4e5", "c8c7",
  "d7e8", "c7g7", "g3f1", "g8f8", "c2c3", "b5a4", "e1e4", "g7h7", "b4b5", "d8b8", "e8c6", "b7c8", "f1e3", "f8g8",
  "c6d5", "h7h8", "e4c4", "b8c7", "a2b1", "f4e3", "c4b4", "h6g7", "g2g3", "h4h3", "d5e6", "c8b8", "c3c4", "g7f6",
  "h1c1", "f6d8", "b1a2", "a4a3", "c1a1", "a7a5", "a1d1", "b8b7", "a2b1", "h8h7",
] as const;
export const OPERA80_FEN = "3b2r1/1kq4r/4B3/pP2P3/1RP5/p3p1Pp/7P/1K1R4 w - - 4 50";
