// Row fixtures for the Train unit tests (not shipped: imported by *.test.ts only). The position is the design's
// V3BankSession #1 (tal_fan_77, move 19): Black's setup Bg3, White to find Rxf5; the member played Qd2 in the game.
import type { CardRowDb } from "./dto.server";

export const NOW = new Date("2026-11-12T19:00:00.000Z");
export const PRE_SETUP_FEN = "r2r2k1/p1q2pp1/2pb1n1p/5b2/8/1PNNP2P/P1P1B1P1/R2Q1RK1 b - - 0 18";
export const MEMBER_FEN = "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19";
export const GAME_REF = "cm3k9x2p10007slzpqa8hd4fe";

export function cardRow(overrides: Partial<CardRowDb> = {}): CardRowDb {
  return {
    cardId: 11n,
    itemKey: "m_card00000001",
    deck: "BANK",
    kind: "MISTAKE",
    mistakeId: 7n,
    puzzleId: null,
    cardFen: null,
    cardSolution: null,
    cardOrient: null,
    puzzleRating: null,
    theme: "hangingPiece",
    cardPhase: "MIDDLEGAME",
    due: new Date("2026-11-12T08:00:00.000Z"),
    stability: 4.2,
    difficulty: 5.1,
    elapsedDays: 4,
    scheduledDays: 4,
    learningSteps: 0,
    reps: 2,
    lapses: 0,
    state: "REVIEW",
    lastReview: new Date("2026-11-08T08:10:00.000Z"),
    mastery: 2,
    suspendedUntil: null,
    mistakeRef: "cm5m1st4k0001slzpmistake1",
    color: "w",
    fen: PRE_SETUP_FEN,
    setupUci: "d6g3",
    solution: "f1f5",
    accept: null,
    playedUci: "d1d2",
    refuteUci: "c7h2",
    judgement: "BLUNDER",
    source: "OWN_ERROR",
    isPuzzle: false,
    primaryTheme: "hangingPiece",
    phase: "MIDDLEGAME",
    cpBest: 270,
    mateBest: null,
    moveNumber: 19,
    occurrences: 1,
    lastPly: 36,
    lastPlayedAt: new Date("2026-11-12T10:00:00.000Z"),
    lastOpponentName: "tal_fan_77",
    hiddenAt: null,
    gameRef: GAME_REF,
    ...overrides,
  };
}
