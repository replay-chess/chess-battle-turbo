// The design mocks as a grading fixture (phase-03 plan §8.4 "Fixture expectations", §12.4 `labels/design-mock.ts`).
//
// Source: the `GAME`, `CLEAN` and `M` constants of the design boards `V3ReviewSummary.dc.html` and
// `V3ReviewClean.dc.html` (identical data in both; design reference `project/v2`, read 2026-11-11). Per ply the mock
// gives the SAN, the label it shows (`q`), the eval AFTER the ply (`ev`, White POV, centipawns) and the engine's best
// move in the position BEFORE the ply (`best`, SAN). `GAME` is knightowl_88 (White, the member) vs tal_fan_77,
// 54 plies; `CLEAN` is the Opera Game with the member as White, 33 plies. The mocks' FEN strings (castling written
// "-") are not used: positions come from replaying the SAN with chess.js.
//
// How the fixture turns the mock into grader input (`mockGradeInput`):
// - evals[0] (the start position, which the mock does not give) = START_POSITION_EVAL (15 cp); evals[i + 1] = ev of
//   ply i. CLEAN's 2000 and 3000 are the mock's stand-ins for a forced mate and a delivered mate and are stored as
//   mates: after 16.Qb8+ and after 16…Nxb8 White mates in 1 (+29999); after 17.Rd8# Black is checkmated (+30000).
//   The test re-proves those facts with chess.js.
// - best[i] = the mock `best` SAN converted to a MoveCode in position i.
// - second[i] (the MultiPV-2 score, which the mock does not give) is stubbed as evals[i], i.e. "the second-best move
//   is as good as the best", except before CLEAN 14.Rd1 (position 26), where it is +150 to give Rd1 the gap and
//   the outcome-class change the plan describes (P3-D28 "GREAT from second").
// - the book set = the EPDs after every ply the mock labels "book".
//
// Feeding that to classify.ts gives `EXPECTED` for every ply. It matches the mock's `q` except for the plies in
// `DIFFERENCES`, each with its reason and numbers. The plan (§8.4) listed four differences; two hold as written
// (book transpositions stay BOOK; 16.Qb8+ is BRILLIANT), and two come out otherwise once computed:
// - `44.Rxf6` is GOOD, not INACCURACY as §8.4 predicted: the mock's own evals give a loss of 3.14 (< 5);
// - `26.Rd1` is BEST, not GREAT: Wb = 92.44 is above the GREAT band's 90 (classify.ts header).
// The other user-ply differences come from the CLEAN mock's `best` column, which repeats the played move on every
// ply: a ply whose played move is the engine's best is BEST, whatever the mock shows.

import { START_POSITION_EVAL } from "../../src/accuracy";
import { INITIAL_FEN } from "../../src/board";
import type { GradeGameInput } from "../../src/classify";
import type { Color, JudgementKey } from "../../src/codec";
import { encodeMate, encodeMove } from "../../src/codec";
import { replaySan, uciOf } from "../../src/replay";

/** The labels the mocks use (the 12 wire keys). */
export type MockLabel = JudgementKey;

export interface MockPly {
  san: string;
  q: MockLabel;
  /** Eval after the ply, White POV, centipawns (2000/3000 = mate stand-ins in CLEAN). */
  ev: number;
  /** Engine's best move in the position before the ply, SAN. */
  best: string;
}

export interface MockMoment {
  ply: number;
  best: string;
  uci: string;
  lineStart: string;
  line: string[];
  ask: string;
  why: string;
}

export const GAME: readonly MockPly[] = [
  { san: "e4", q: "book", ev: 36, best: "e4" }, // 0
  { san: "e5", q: "book", ev: 36, best: "e5" }, // 1
  { san: "Nf3", q: "book", ev: 41, best: "Nf3" }, // 2
  { san: "Nc6", q: "book", ev: 31, best: "Nf6" }, // 3
  { san: "Bc4", q: "book", ev: 18, best: "d4" }, // 4
  { san: "Nf6", q: "book", ev: 18, best: "Nf6" }, // 5
  { san: "Ng5", q: "book", ev: -4, best: "d3" }, // 6
  { san: "d5", q: "book", ev: -5, best: "d5" }, // 7
  { san: "exd5", q: "book", ev: -6, best: "exd5" }, // 8
  { san: "Na5", q: "book", ev: -8, best: "Na5" }, // 9
  { san: "Bb5+", q: "book", ev: -9, best: "Bb5+" }, // 10
  { san: "c6", q: "book", ev: -3, best: "c6" }, // 11
  { san: "dxc6", q: "book", ev: -2, best: "dxc6" }, // 12
  { san: "bxc6", q: "book", ev: -2, best: "bxc6" }, // 13
  { san: "Be2", q: "book", ev: -16, best: "Bd3" }, // 14
  { san: "h6", q: "book", ev: -12, best: "h6" }, // 15
  { san: "Nf3", q: "book", ev: -17, best: "Nh3" }, // 16
  { san: "e4", q: "book", ev: -20, best: "e4" }, // 17
  { san: "Ne5", q: "book", ev: -19, best: "Ne5" }, // 18
  { san: "Bd6", q: "book", ev: 20, best: "Bc5" }, // 19
  { san: "d4", q: "book", ev: 6, best: "d4" }, // 20
  { san: "exd3", q: "book", ev: 4, best: "exd3" }, // 21
  { san: "Nxd3", q: "book", ev: 4, best: "Nxd3" }, // 22
  { san: "Qc7", q: "book", ev: 7, best: "O-O" }, // 23
  { san: "h3", q: "good", ev: -27, best: "b3" }, // 24
  { san: "O-O", q: "best", ev: -16, best: "O-O" }, // 25
  { san: "O-O", q: "best", ev: -20, best: "O-O" }, // 26
  { san: "Rd8", q: "good", ev: 5, best: "c5" }, // 27
  { san: "Nc3", q: "good", ev: -27, best: "Nd2" }, // 28
  { san: "Bf5", q: "excellent", ev: -10, best: "Rb8" }, // 29
  { san: "Be3", q: "excellent", ev: -28, best: "Bg4" }, // 30
  { san: "Nc4", q: "excellent", ev: -27, best: "Rab8" }, // 31
  { san: "b3", q: "inaccuracy", ev: -137, best: "Qc1" }, // 32
  { san: "Nxe3", q: "best", ev: -140, best: "Nxe3" }, // 33
  { san: "fxe3", q: "best", ev: -130, best: "fxe3" }, // 34
  { san: "Bg3", q: "blunder", ev: 290, best: "Bh7" }, // 35
  { san: "Qd2", q: "miss", ev: -62, best: "Rxf5" }, // 36
  { san: "Bh7", q: "best", ev: -69, best: "Bh7" }, // 37
  { san: "Bf3", q: "best", ev: -76, best: "Bf3" }, // 38
  { san: "Re8", q: "excellent", ev: -66, best: "Qe7" }, // 39
  { san: "Bxc6", q: "blunder", ev: -365, best: "Ne2" }, // 40
  { san: "Qxc6", q: "best", ev: -388, best: "Qxc6" }, // 41
  { san: "Rad1", q: "good", ev: -426, best: "Rf3" }, // 42
  { san: "Qb6", q: "good", ev: -371, best: "Rad8" }, // 43
  { san: "Rxf6", q: "interesting", ev: -427, best: "Nf4" }, // 44
  { san: "Qxf6", q: "best", ev: -428, best: "Qxf6" }, // 45
  { san: "Nd5", q: "best", ev: -433, best: "Nd5" }, // 46
  { san: "Qd6", q: "best", ev: -427, best: "Qd6" }, // 47
  { san: "Ne1", q: "excellent", ev: -438, best: "N3f4" }, // 48
  { san: "Bxe1", q: "excellent", ev: -425, best: "Qf8" }, // 49
  { san: "Qxe1", q: "best", ev: -453, best: "Qxe1" }, // 50
  { san: "Rad8", q: "excellent", ev: -420, best: "Bxc2" }, // 51
  { san: "c4", q: "excellent", ev: -433, best: "Qf2" }, // 52
  { san: "Kh8", q: "excellent", ev: -402, best: "Be4" }, // 53
];

export const CLEAN: readonly MockPly[] = [
  { san: "e4", q: "book", ev: 20, best: "e4" }, // 0
  { san: "e5", q: "book", ev: 25, best: "e5" }, // 1
  { san: "Nf3", q: "book", ev: 30, best: "Nf3" }, // 2
  { san: "d6", q: "book", ev: 40, best: "d6" }, // 3
  { san: "d4", q: "book", ev: 60, best: "d4" }, // 4
  { san: "Bg4", q: "book", ev: 55, best: "Bg4" }, // 5
  { san: "dxe5", q: "book", ev: 120, best: "dxe5" }, // 6
  { san: "Bxf3", q: "book", ev: 110, best: "Bxf3" }, // 7
  { san: "Qxf3", q: "best", ev: 160, best: "Qxf3" }, // 8
  { san: "dxe5", q: "good", ev: 150, best: "dxe5" }, // 9
  { san: "Bc4", q: "best", ev: 170, best: "Bc4" }, // 10
  { san: "Nf6", q: "book", ev: 160, best: "Nf6" }, // 11
  { san: "Qb3", q: "excellent", ev: 220, best: "Qb3" }, // 12
  { san: "Qe7", q: "best", ev: 200, best: "Qe7" }, // 13
  { san: "Nc3", q: "best", ev: 260, best: "Nc3" }, // 14
  { san: "c6", q: "good", ev: 250, best: "c6" }, // 15
  { san: "Bg5", q: "excellent", ev: 300, best: "Bg5" }, // 16
  { san: "b5", q: "best", ev: 260, best: "b5" }, // 17
  { san: "Nxb5", q: "best", ev: 420, best: "Nxb5" }, // 18
  { san: "cxb5", q: "best", ev: 400, best: "cxb5" }, // 19
  { san: "Bxb5+", q: "excellent", ev: 520, best: "Bxb5+" }, // 20
  { san: "Nbd7", q: "best", ev: 500, best: "Nbd7" }, // 21
  { san: "O-O-O", q: "best", ev: 560, best: "O-O-O" }, // 22
  { san: "Rd8", q: "good", ev: 540, best: "Rd8" }, // 23
  { san: "Rxd7", q: "best", ev: 700, best: "Rxd7" }, // 24
  { san: "Rxd7", q: "best", ev: 680, best: "Rxd7" }, // 25
  { san: "Rd1", q: "great", ev: 800, best: "Rd1" }, // 26
  { san: "Qe6", q: "best", ev: 760, best: "Qe6" }, // 27
  { san: "Bxd7+", q: "excellent", ev: 900, best: "Bxd7+" }, // 28
  { san: "Nxd7", q: "best", ev: 880, best: "Nxd7" }, // 29
  { san: "Qb8+", q: "brilliant", ev: 2000, best: "Qb8+" }, // 30
  { san: "Nxb8", q: "forced", ev: 2000, best: "Nxb8" }, // 31
  { san: "Rd8#", q: "best", ev: 3000, best: "Rd8#" }, // 32
];

export const GAME_MOMENTS: readonly MockMoment[] = [
  {
    ply: 32,
    best: "Qc1",
    uci: "d1c1",
    lineStart: "r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17",
    line: ["Qc1", "Nxe3", "Qxe3"],
    ask: "Move 17. Black’s knight on c4 is eyeing your bishop on e3. What would you play?",
    why: "After b3 the knight takes on e3 and fxe3 leaves you with doubled e-pawns. Qc1 keeps the queen ready to recapture on e3 instead. You lose about 6 win% points, so this is an inaccuracy, not a disaster.",
  },
  {
    ply: 36,
    best: "Rxf5",
    uci: "f1f5",
    lineStart: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 0 19",
    line: ["Rxf5", "Bh2+", "Kh1"],
    ask: "Move 19. Black just played Bg3. Something was available here. What would you play?",
    why: "Bg3 left the bishop on f5 with no defender, and your rook sees it down the open f-file. Rxf5 wins a whole piece. Qd2 let the chance pass, which is why it is marked Miss.",
  },
  {
    ply: 40,
    best: "Ne2",
    uci: "c3e2",
    lineStart: "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 0 21",
    line: ["Ne2", "Bh2+", "Kh1"],
    ask: "Move 21. The position is still close. What would you play?",
    why: "The queen on c7 guards c6, so Bxc6 gives a bishop for a pawn. Ne2 challenges the bishop on g3 and keeps the game level. This was the move that decided the game.",
  },
];
export type MockName = "GAME" | "CLEAN";
export const MOCKS: Readonly<Record<MockName, readonly MockPly[]>> = { GAME, CLEAN };
/** The member's side in each mock. */
export const USER_SIDE: Readonly<Record<MockName, Color>> = { GAME: "w", CLEAN: "w" };

/** Stored evals that replace the mock's mate stand-ins, by position index (= ply + 1). */
export const MOCK_MATES: Readonly<Record<MockName, Readonly<Record<number, number>>>> = {
  GAME: {},
  CLEAN: { 31: encodeMate("w", 1), 32: encodeMate("w", 1), 33: encodeMate("w", 0) },
};

/** The stubbed `second` value before CLEAN 14.Rd1 (position 26): +150, a hold where Rd1 keeps a win. */
export const CLEAN_RD1_SECOND = 150;

export function mockEvals(name: MockName): number[] {
  const mates = MOCK_MATES[name];
  return [START_POSITION_EVAL, ...MOCKS[name].map((p, i) => mates[i + 1] ?? p.ev)];
}

/** Grader input built from a mock as the header describes. */
export function mockGradeInput(name: MockName): GradeGameInput {
  const plies = MOCKS[name];
  const replay = replaySan(
    INITIAL_FEN,
    plies.map((p) => p.san),
  );
  const evals = mockEvals(name);
  const best = plies.map((p, i) => encodeMove(uciOf(replay.fens[i] as string, p.best)));
  const second = evals.slice();
  if (name === "CLEAN") second[26] = CLEAN_RD1_SECOND;
  const bookEpds = new Set(plies.flatMap((p, i) => (p.q === "book" ? [replay.epds[i + 1] as string] : [])));
  return { replay, evals, best, second, isBook: (epd) => bookEpds.has(epd) };
}

export interface MockDifference {
  name: MockName;
  ply: number;
  side: Color;
  san: string;
  mock: MockLabel;
  ours: JudgementKey;
  why: string;
}

/** Every ply where the grader's label differs from the mock's `q`, with the reason. */
export const DIFFERENCES: readonly MockDifference[] = [
  {
    name: "GAME",
    ply: 44,
    side: "w",
    san: "Rxf6",
    mock: "interesting",
    ours: "good",
    why: "INTERESTING is not emitted in GRADING_VERSION 1 (P3-D15). §8.4 expected INACCURACY, but the mock's evals (−371 → −427) give Wb 20.33, Wa 17.19, a loss of 3.14: GOOD (2 < d < 5). Rxf6 is an exchange sacrifice, but d > 2 rules out BRILLIANT.",
  },
  {
    name: "CLEAN",
    ply: 9,
    side: "b",
    san: "dxe5",
    mock: "good",
    ours: "best",
    why: "Opponent ply. The mock's best move is the played move (dxe5) and Black's Win% rises (35.68 → 36.53): BEST.",
  },
  {
    name: "CLEAN",
    ply: 11,
    side: "b",
    san: "Nf6",
    mock: "book",
    ours: "best",
    why: "Opponent ply. BOOK needs an unbroken book chain from move 1; it ended at ply 8 (5.Qxf3, not book), so 6…Nf6 cannot be BOOK. Played = best: BEST.",
  },
  {
    name: "CLEAN",
    ply: 12,
    side: "w",
    san: "Qb3",
    mock: "excellent",
    ours: "best",
    why: "The mock's best move is the played move (Qb3) and White's Win% rises (64.32 → 69.21): BEST. The CLEAN `best` column repeats the played move on every ply.",
  },
  {
    name: "CLEAN",
    ply: 15,
    side: "b",
    san: "c6",
    mock: "good",
    ours: "best",
    why: "Opponent ply. Played = the mock's best (c6), Win% rises (27.74 → 28.49): BEST.",
  },
  {
    name: "CLEAN",
    ply: 16,
    side: "w",
    san: "Bg5",
    mock: "excellent",
    ours: "best",
    why: "Played = the mock's best (Bg5), Win% rises (71.51 → 75.11): BEST.",
  },
  {
    name: "CLEAN",
    ply: 20,
    side: "w",
    san: "Bxb5+",
    mock: "excellent",
    ours: "best",
    why: "Played = the mock's best (Bxb5+), Win% rises (81.35 → 87.15): BEST.",
  },
  {
    name: "CLEAN",
    ply: 23,
    side: "b",
    san: "Rd8",
    mock: "good",
    ours: "best",
    why: "Opponent ply. Played = the mock's best (Rd8), Win% rises (11.28 → 12.04): BEST.",
  },
  {
    name: "CLEAN",
    ply: 26,
    side: "w",
    san: "Rd1",
    mock: "great",
    ours: "best",
    why: "§8.4 expected GREAT. The stubbed second (+150: Wsecond 63.46, hold) gives a gap of 28.98 and an outcome-class change (win → hold), but GREAT also needs 10 ≤ Wb ≤ 90 and Wb = 92.44 (eval +680 before 14.Rd1). Played = best: BEST.",
  },
  {
    name: "CLEAN",
    ply: 28,
    side: "w",
    san: "Bxd7+",
    mock: "excellent",
    ours: "best",
    why: "Played = the mock's best (Bxd7+), Win% rises (94.26 → 96.49): BEST.",
  },
];

/** The grader's expected label for every ply: the mock's `q`, except at `DIFFERENCES`. */
export const EXPECTED: Readonly<Record<MockName, readonly JudgementKey[]>> = {
  GAME: GAME.map((p, i) => DIFFERENCES.find((d) => d.name === "GAME" && d.ply === i)?.ours ?? p.q),
  CLEAN: CLEAN.map((p, i) => DIFFERENCES.find((d) => d.name === "CLEAN" && d.ply === i)?.ours ?? p.q),
};
