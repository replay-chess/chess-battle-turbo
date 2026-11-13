// The Level step's aside, "A puzzle at your level" (phase-04 plan §4.4), and the legend position of the Welcome,
// Activating and Done asides (§4.0). The FENs are `packages/chess-fixtures/design/onboarding.json`, where each line is
// replayed by the fixtures' own test; sample-puzzles.test.ts checks these copies equal the fixture.
// PUZZLE_R800_1200 is the FEN on V3OnbRating (the board the design shows); the other four are CC0 puzzles from the
// Lichess puzzle database (plan §4.4, §12.5; FIX-1), recorded 2026-11-13 with their ids and ratings: the position is
// the game replayed to the puzzle, the side to move is the solver. "New to chess" shows no puzzle: its aside says the
// coach starts with how the pieces work.
import type { RatingBandDb } from "@repo/contracts/http/p04-plain";

export type SamplePuzzle = {
  fen: string;
  /** Around which rating it sits ("Sample puzzle around 1150"): the Lichess puzzle rating where there is one. */
  rating: number;
  /** Accessible name of the board. */
  label: string;
  /** The Lichess puzzle (CC0, lichess.org/training/<id>); null for the design board's own position. */
  lichessId: string | null;
};

export const SAMPLE_PUZZLES: Readonly<Record<Exclude<RatingBandDb, "NEW_TO_CHESS">, SamplePuzzle>> = {
  UNDER_800: {
    fen: "1r3rk1/pb3pp1/3b3p/2p5/3P2n1/3Q1N2/6PP/R3R1NK b - - 0 26",
    rating: 794,
    label: "Sample puzzle around 794. Black to move.",
    lichessId: "91Hz0",
  },
  R800_1200: {
    fen: "r3k2r/1p3p2/1np2pb1/p2p3p/3P1b1P/2NBP1P1/PP1K1P2/R6R w kq - 0 16",
    rating: 1150,
    label: "Sample puzzle around 1150. White to move.",
    lichessId: null,
  },
  R1200_1600: {
    fen: "8/6R1/6p1/8/5Pk1/1P4Pp/1r5P/6K1 b - - 4 31",
    rating: 1538,
    label: "Sample puzzle around 1538. Black to move.",
    lichessId: "E5uss",
  },
  R1600_2000: {
    fen: "4r1k1/1pp3p1/1p3p1p/1P2p3/2PnR2N/3P4/r4PPP/4R1K1 w - - 0 21",
    rating: 1691,
    label: "Sample puzzle around 1691. White to move.",
    lichessId: "OeeyB",
  },
  R2000_PLUS: {
    fen: "r1b1qr1k/pp2b1p1/4Qn1p/4Np2/2BPnB2/4P3/PP3PPP/R4RK1 w - - 2 16",
    rating: 2123,
    label: "Sample puzzle around 2123. White to move.",
    lichessId: "78xH8",
  },
};

/** The board on V3OnbRating when nothing is picked yet. */
export const DEFAULT_PUZZLE_BAND = "R800_1200" as const;

/** The aside puzzle for a band; null for "New to chess" (no puzzle, only the note). */
export function samplePuzzleFor(band: RatingBandDb | null): SamplePuzzle | null {
  if (band === "NEW_TO_CHESS") return null;
  return SAMPLE_PUZZLES[band ?? DEFAULT_PUZZLE_BAND];
}

/** Kasparov–Topalov, Wijk aan Zee 1999, before 24.Rxd4 (V3OnbWelcome, V3OnbActivating, V3OnbDone). */
export const LEGEND_POSITION = {
  fen: "b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24",
  label: "Kasparov vs Topalov 1999, after 23…Qd6. White to move.",
  caption: "Kasparov vs Topalov, 1999. White to move. It's waiting for you at the end of setup.",
} as const;
