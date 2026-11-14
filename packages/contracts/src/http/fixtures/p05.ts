// Typed P5 HTTP fixtures (phase-05 plan §4, §6.7, §7.1, §9.4) for the UI packages (the `/dev/ui/train/*` and
// `/dev/ui/home` demos read them through apps/web/app/dev/ui/_fixtures/train.ts), component tests, the payload size
// tests (train.size.test.ts) and the contract tests: `import { trainTodayFixture } from "@repo/contracts/http/fixtures/p05"`.
//
// The data is the design's: `DR/V3MistakeBank.dc.html` (the 23 `ALL` rows), `DR/V3BankSession.dc.html` (the three
// drill positions with their lines, coach texts and hints), `DR/V3PuzzleSolve.dc.html` (three fork puzzles with their
// setup moves), `DR/V3PuzzleThemes.dc.html` (Forks 62% · 14 …), `DR/V3TrainHub*.dc.html`, `DR/V3SessionSummary`,
// `DR/V3Home*.dc.html`. Every solution line is legal from its FEN (the runner validates with chess.js), every label is
// what the server would format in UTC on P5_FIXTURE_NOW (Thursday 2026-11-12 19:00). Pure data: no zod at runtime,
// safe for client demos. Every fixture parses with its schema (p05-contracts.test.ts).
//
// `stress` variants fill every field to its limit (40-character names, 300 bank rows, 20 + 20 session items, 50
// attempts): the size tests assert the plan's budgets on them, and the demos render them with `?stress=1`.
import type {
  AttemptIn,
  AttemptOut,
  AttemptsResult,
  BankNextPage,
  BankPage,
  BankRow,
  Badges,
  ExtendResult,
  GradePreviews,
  SessionPayload,
  SessionSummary,
  SkipResult,
  ThemeOption,
  ThemesResult,
  TrainItem,
  TrainPrefs,
  TrainToday,
} from "../train";
import type { HomeData } from "../home";
import type { ReportBody, ReportResult } from "../reports";
import type { MomentBankResponse } from "../review";

// ── Clock, refs and names ───────────────────────────────────────────────────────────────────────────────────────
/** Thursday 19:00 UTC: "Good evening", "Thursday · 6 minutes planned", the next batch "tomorrow at 08:00". */
export const P5_FIXTURE_NOW = "2026-11-12T19:00:00.000Z";
export const P5_FIXTURE_TZ = "UTC";
export const P5_FIXTURE_NEXT_RELEASE = "2026-11-13T08:00:00.000Z";

export const P5_FIXTURE_SESSION_REF = "cm5t9s3ss0001slzpbankdrl1";
export const P5_FIXTURE_PUZZLE_SESSION_REF = "cm5t9s3ss0002slzppuzzle01";
export const P5_FIXTURE_GAME_REF = "cm3k9x2p10007slzpqa8hd4fe";
export const P5_FIXTURE_MISTAKE_REF = "cm5m1st4k0001slzpmistake1";
export const P5_FIXTURE_REPORT_REF = "cm5r3p0rt0001slzpreport01";
export const P5_FIXTURE_OPERA_REF = "cm0p3r4g4me001slzpoperapos";

/** The longest display names the schemas allow (stress). */
export const LONG_NAME = "a_really_long_opponent_name_for_stress_x";

const at = (offsetMin: number) => new Date(Date.parse(P5_FIXTURE_NOW) + offsetMin * 60_000).toISOString();
const days = (n: number) => at(n * 24 * 60);
const ref = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, "0")}slzpfx5train0`.slice(0, 25);
const gameRefN = (n: number) => ref("cm5g4m3", n);

// ── Card keys (opaque `m_` + sqid of the epdHash; the exact codec is @repo/chess-training/items) ───────────────────
const ALPHA = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A stable, opaque, 13-character key per index (the length of a real two-uint32 sqid). */
export function fixtureCardKey(i: number): string {
  let x = (i + 1) * 2_654_435_761;
  let out = "";
  for (let k = 0; k < 11; k++) {
    out += ALPHA[x % ALPHA.length];
    x = Math.floor(x / ALPHA.length) + (k + 7) * 97 * (i + 3);
  }
  return `m_${out}`;
}

// ── Grade previews (what fsrs.ts would compute: Again 10 min, Hard 2 d, Good 4 d, Easy 9 d, snapped to 08:00) ─────
const releaseIn = (d: number) => new Date(Date.parse(P5_FIXTURE_NEXT_RELEASE) + (d - 1) * 86_400_000).toISOString();

export const NEW_CARD_PREVIEW: GradePreviews = {
  again: { label: "< 10 min", due: at(10), days: 0 },
  hard: { label: "2 days", due: releaseIn(2), days: 2 },
  good: { label: "4 days", due: releaseIn(4), days: 4 },
  easy: { label: "9 days", due: releaseIn(9), days: 9 },
};
/** The pass-2 copy after an Again (a relearning card a few minutes later). */
export const AFTER_AGAIN_PREVIEW: GradePreviews = {
  again: { label: "< 10 min", due: at(20), days: 0 },
  hard: { label: "1 day", due: releaseIn(1), days: 1 },
  good: { label: "2 days", due: releaseIn(2), days: 2 },
  easy: { label: "5 days", due: releaseIn(5), days: 5 },
};

// ── Bank rows (`DR/V3MistakeBank.dc.html` ALL) ─────────────────────────────────────────────────────────────────
type DesignRow = [fen: string, orient: "w" | "b", theme: [key: string, label: string], played: string, moveNo: number, opp: string, when: string, judgement: BankRow["judgement"], phase: BankRow["phase"], source: BankRow["source"], mastery: number, next: string | null];

const DESIGN_ROWS: DesignRow[] = [
  ["r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19", "w", ["hangingPiece", "Loose piece"], "Qd2", 19, "tal_fan_77", "today", "miss", "middlegame", "missed", 0, null],
  ["r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 5 21", "w", ["rc:defendedTarget", "Defended pawn"], "Bxc6", 21, "tal_fan_77", "today", "blunder", "middlegame", "own", 0, null],
  ["r3k2r/1p3p2/1np2pb1/p2p3p/3P1b1P/2NBP1P1/PP1K1P2/R6R w kq - 0 16", "w", ["rc:recapture", "Recapture first"], "Bxg6", 16, "pawnstorm22", "Oct 27", "blunder", "middlegame", "own", 1, null],
  ["r2qk2r/pp2ppbp/1nN3p1/8/3P4/8/PP3PPP/RNBQR1K1 b kq - 0 13", "b", ["rc:recapture", "Recapture first"], "Qd5", 13, "e4_enjoyer", "Oct 27", "blunder", "opening", "own", 2, null],
  ["r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17", "w", ["fork", "Fork"], "Nd2", 24, "vera_b", "Oct 26", "mistake", "middlegame", "missed", 1, "Tomorrow"],
  ["r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 0 19", "w", ["backRankMate", "Back rank"], "Ra7", 30, "lucena_now", "Oct 26", "blunder", "endgame", "own", 1, "Tomorrow"],
  ["r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 0 21", "w", ["fork", "Fork"], "Be2", 18, "martin_k", "Oct 25", "mistake", "middlegame", "missed", 2, "Tomorrow"],
  ["r1bqkb1r/pp3ppp/2P2n2/nB2p1N1/8/8/PPPP1PPP/RNBQK2R b - - 0 1", "b", ["hangingPiece", "Loose piece"], "h6", 22, "opposite_sq", "Oct 25", "mistake", "middlegame", "own", 2, "Tomorrow"],
  ["r1bqkb1r/p4ppp/2p2n2/n3p1N1/8/8/PPPPBPPP/RNBQK2R b - - 0 1", "b", ["rc:pawnStructure", "Pawn structure"], "f6", 14, "kingswalk", "Oct 24", "inaccuracy", "opening", "own", 1, "Tomorrow"],
  ["r1bqkb1r/p4pp1/2p2n1p/n3p3/8/5N2/PPPPBPPP/RNBQK2R b - - 0 1", "b", ["backRankMate", "Back rank"], "Qe7", 33, "tal_fan_77", "Oct 24", "blunder", "endgame", "own", 3, "Tomorrow"],
  ["r1bqkb1r/p4pp1/2p2n1p/n3N3/4p3/8/PPPPBPPP/RNBQK2R b - - 0 1", "b", ["fork", "Fork"], "Rb8", 27, "pawnstorm22", "Oct 22", "miss", "middlegame", "missed", 2, "Sat"],
  ["r1bqk2r/p4pp1/2pb1n1p/n3N3/3Pp3/8/PPP1BPPP/RNBQK2R b - - 0 1", "b", ["hangingPiece", "Loose piece"], "Nb7", 20, "e4_enjoyer", "Oct 21", "mistake", "middlegame", "own", 3, "Sat"],
  ["r1bqk2r/p4pp1/2pb1n1p/n7/8/3N4/PPP1BPPP/RNBQK2R b - - 0 1", "b", ["rc:recapture", "Recapture first"], "Qb6", 17, "vera_b", "Oct 20", "blunder", "middlegame", "own", 2, "Sat"],
  ["r1b1k2r/p1q2pp1/2pb1n1p/n7/8/3N3P/PPP1BPP1/RNBQK2R b - - 0 1", "b", ["fork", "Fork"], "Bd7", 25, "lucena_now", "Oct 19", "mistake", "middlegame", "missed", 3, "Sun"],
  ["r1b2rk1/p1q2pp1/2pb1n1p/n7/8/3N3P/PPP1BPP1/RNBQ1RK1 b - - 0 1", "b", ["rc:pawnStructure", "Pawn structure"], "g5", 12, "martin_k", "Oct 18", "inaccuracy", "opening", "own", 2, "Sun"],
  ["r1br2k1/p1q2pp1/2pb1n1p/n7/8/2NN3P/PPP1BPP1/R1BQ1RK1 b - - 0 1", "b", ["hangingPiece", "Loose piece"], "Re8", 23, "kingswalk", "Oct 17", "mistake", "middlegame", "own", 3, "Sun"],
  ["r2r2k1/p1q2pp1/2pb1n1p/n4b2/8/2NNB2P/PPP1BPP1/R2Q1RK1 b - - 0 1", "b", ["backRankMate", "Back rank"], "Kh8", 36, "opposite_sq", "Oct 15", "blunder", "endgame", "own", 4, "Mon"],
  ["r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/1PNNB2P/P1P1BPP1/R2Q1RK1 b - - 0 1", "b", ["fork", "Fork"], "Qc8", 21, "tal_fan_77", "Oct 14", "miss", "middlegame", "missed", 3, "Mon"],
  ["r2r2k1/p1q2pp1/2pb1n1p/5b2/8/1PNNP2P/P1P1BPP1/R2Q1RK1 b - - 0 1", "b", ["hangingPiece", "Loose piece"], "a5", 19, "pawnstorm22", "Oct 12", "mistake", "middlegame", "own", 4, "Tue"],
  ["r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1PQB1P1/R4RK1 b - - 0 1", "b", ["rc:recapture", "Recapture first"], "Ne4", 11, "e4_enjoyer", "Oct 10", "mistake", "opening", "own", 3, "Wed"],
  ["r2r2k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 b - - 0 1", "b", ["fork", "Fork"], "Rd7", 28, "vera_b", "Oct 8", "mistake", "middlegame", "missed", 4, "Nov 6"],
  ["r3r1k1/p1q2ppb/2B2n1p/8/8/1PNNP1bP/P1PQ2P1/R4RK1 b - - 0 1", "b", ["rc:pawnStructure", "Pawn structure"], "b5", 15, "lucena_now", "Oct 6", "inaccuracy", "opening", "own", 4, "Nov 8"],
  ["r3r1k1/p4ppb/2q2n1p/8/8/1PNNP1bP/P1PQ2P1/3R1RK1 b - - 0 1", "b", ["backRankMate", "Back rank"], "Rf8", 34, "martin_k", "Oct 3", "blunder", "endgame", "own", 4, "Nov 12"],
];

function rowFrom(d: DesignRow, i: number, opts: { long?: boolean } = {}): BankRow {
  const [fen, orient, [key, label], played, moveNo, opp, when, judgement, phase, source, mastery, next] = d;
  return {
    cardRef: fixtureCardKey(i),
    fen,
    orient,
    lastMove: i % 3 === 0 ? ["d6", "g3"] : null,
    theme: { key, label },
    judgement,
    playedSan: played,
    moveNo,
    opponent: opts.long ? LONG_NAME : opp,
    playedAtLabel: when,
    phase,
    source,
    mastery,
    isDue: next === null,
    nextLabel: next,
    skippedToday: false,
    occurrences: i === 2 ? 3 : 1,
    gameRef: gameRefN(i % 12),
    gamePly: moveNo * 2 - (orient === "w" ? 2 : 1),
  };
}

/** The design's 23 rows: 4 due today, 19 scheduled later. */
export function bankRowsFixture(): BankRow[] {
  return DESIGN_ROWS.map((d, i) => rowFrom(d, i));
}

/** `n` rows (the design's rows repeated with distinct refs), long names when `long`. */
export function manyBankRows(n: number, opts: { long?: boolean } = {}): BankRow[] {
  return Array.from({ length: n }, (_, i) => rowFrom(DESIGN_ROWS[i % DESIGN_ROWS.length]!, i, opts));
}

const FACETS: BankPage["facets"] = {
  theme: [
    { key: "fork", label: "Fork", n: 6 },
    { key: "hangingPiece", label: "Loose piece", n: 5 },
    { key: "rc:recapture", label: "Recapture first", n: 4 },
    { key: "backRankMate", label: "Back rank", n: 4 },
    { key: "rc:pawnStructure", label: "Pawn structure", n: 3 },
    { key: "rc:defendedTarget", label: "Defended pawn", n: 1 },
  ],
  phase: [
    { key: "opening", label: "Opening", n: 5 },
    { key: "middlegame", label: "Middlegame", n: 14 },
    { key: "endgame", label: "Endgame", n: 4 },
  ],
  source: [
    { key: "own", label: "My blunders", n: 16 },
    { key: "missed", label: "Missed punishments", n: 7 },
  ],
};

const NEXT_BATCH = { at: P5_FIXTURE_NEXT_RELEASE, atLabel: "08:00", count: 6, whenLabel: "tomorrow at 08:00" };

export const BANK_PAGE_STATES = ["default", "empty", "caughtup", "cap_reached", "stress"] as const;
export type BankPageState = (typeof BANK_PAGE_STATES)[number];

/** `GET /api/train/bank` page 1 in each server state (`filtered` is a client state over `default`). */
export function bankPageFixture(state: BankPageState): BankPage {
  const rows = bankRowsFixture();
  const base: BankPage = {
    state: "default",
    counts: { due: 4, dueRaw: 4, all: 23, capRemaining: 10 },
    rows,
    facets: FACETS,
    upcoming: [
      { label: "Tomorrow", n: 6 },
      { label: "Saturday", n: 3 },
      { label: "Sunday", n: 5 },
      { label: "Next week", n: 9 },
    ],
    nextBatch: NEXT_BATCH,
    focusTheme: { key: "fork", label: "Forks" },
    emptyCtas: null,
    lesson: null,
  };
  switch (state) {
    case "default":
      return base;
    case "empty":
      return {
        ...base,
        state: "empty",
        counts: { due: 0, dueRaw: 0, all: 0, capRemaining: 10 },
        rows: [],
        facets: { theme: [], phase: [], source: [] },
        upcoming: [],
        nextBatch: null,
        emptyCtas: { lastGame: { gameRef: P5_FIXTURE_GAME_REF, opponent: "tal_fan_77", reviewed: false }, hasLinkedAccount: false },
      };
    case "caughtup":
      return {
        ...base,
        state: "caughtup",
        counts: { due: 0, dueRaw: 0, all: 23, capRemaining: 6 },
        rows: rows.map((r) => (r.isDue ? { ...r, isDue: false, nextLabel: "Tomorrow" } : r)),
      };
    case "cap_reached":
      return {
        ...base,
        state: "caughtup",
        counts: { due: 0, dueRaw: 4, all: 23, capRemaining: 0 },
      };
    case "stress":
      return {
        ...base,
        counts: { due: 52, dueRaw: 61, all: 300, capRemaining: 10 },
        rows: manyBankRows(300, { long: true }),
        focusTheme: { key: "discoveredAttack", label: "Discovered attacks" },
      };
  }
}

/** Page 2+ of a large bank: 50 rows only. */
export function bankNextPageFixture(): BankNextPage {
  return { rows: manyBankRows(50, { long: true }) };
}

// ── Session items ───────────────────────────────────────────────────────────────────────────────────────────────
/** `DR/V3BankSession.dc.html` P[]: start FEN, line, played move, theme, coach texts. Lines are legal. */
const BANK_ITEMS: Array<{
  fen: string;
  solution: string[];
  played: [uci: string, san: string];
  theme: [string, string];
  moveNo: number;
  opponent: string;
  correct: string;
  wrongGameMove: string;
  hint: string;
  cost: string;
  judgement: "miss" | "blunder" | "mistake";
}> = [
  {
    fen: "r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17",
    solution: ["d1c1", "c4e3", "c1e3"],
    played: ["b2b3", "b3"],
    theme: ["rc:recapture", "Recapture first"],
    moveNo: 17,
    opponent: "tal_fan_77",
    correct: "Qc1 keeps the queen ready to recapture on e3, so you avoid doubled e-pawns.",
    wrongGameMove: "b3 is what you played. After Nxe3 fxe3 your e-pawns are doubled. Keep the queen ready to take back.",
    hint: "Which piece can guard e3 without blocking anything?",
    cost: "Qc1 kept your pawns healthy here, about +0.4 for you. b3 let Black double them.",
    judgement: "mistake",
  },
  {
    fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 0 19",
    solution: ["f1f5", "g3h2", "g1h1"],
    played: ["d1d2", "Qd2"],
    theme: ["hangingPiece", "Loose piece"],
    moveNo: 19,
    opponent: "tal_fan_77",
    correct: "Rxf5 wins the bishop. Nothing of Black's defends f5, and the engine rates the position about +2.7.",
    wrongGameMove: "Qd2 is what you played. After Bxd3 the bishop gets away and the chance is gone.",
    hint: "Look at your rook on f1. What can it see now that the f-pawn is gone?",
    cost: "Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go.",
    judgement: "miss",
  },
  {
    fen: "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 0 21",
    solution: ["c3e2", "g3h2", "g1h1"],
    played: ["f3c6", "Bxc6"],
    theme: ["rc:defendedTarget", "Defended pawn"],
    moveNo: 21,
    opponent: "tal_fan_77",
    correct: "Ne2 challenges the bishop on g3 and keeps the game level. c6 is guarded by the queen.",
    wrongGameMove: "Bxc6 is what you played: the queen on c7 guards c6, so it gives a bishop for a pawn.",
    hint: "Before taking on c6, count its defenders. Then look at the bishop on g3.",
    cost: "Ne2 kept the game level here. Bxc6 gave a bishop for a pawn, about −2.1 for you.",
    judgement: "blunder",
  },
];

/** `DR/V3PuzzleSolve.dc.html` P[]: Lichess shape (FEN before the setup move), legal lines. */
const PUZZLE_ITEMS = [
  {
    id: "0009B",
    fen: "r2qkbnr/pp3ppp/8/1N6/8/8/PPPP1PPP/R1BQKB1R b KQkq - 0 1",
    setup: "d8d5",
    solution: ["b5c7", "e8d8", "c7d5"],
    rating: 1420,
    correct: "Nc7+ hits the king, the queen and the rook at once. After the king moves, Nxd5 wins the queen.",
    hint: "Your knight can give check from two squares. One of them also hits the queen.",
  },
  {
    id: "00aKx",
    fen: "rn1qk2r/ppp1bppp/3p4/6N1/2B5/8/PPP2PPP/RNBQK2R b KQkq - 0 1",
    setup: "h7h6",
    solution: ["g5f7"],
    rating: 1360,
    correct: "Nxf7 forks the queen on d8 and the rook on h8. The king can't take back because your bishop guards f7.",
    hint: "Count what a knight on f7 would attack.",
  },
  {
    id: "00Q7c",
    fen: "r1bqkb1r/pppp1ppp/2n5/2n5/3P4/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 1",
    setup: "c5e6",
    solution: ["d4d5"],
    rating: 1290,
    correct: "d5 attacks both knights. One of them will fall, because they can't both move away.",
    hint: "Pawns fork too. Which pawn move hits c6 and e6?",
  },
];

function bankItem(i: number, opts: { pass?: 1 | 2; long?: boolean } = {}): TrainItem {
  const b = BANK_ITEMS[i % BANK_ITEMS.length]!;
  const pass = opts.pass ?? 1;
  const opponent = opts.long ? LONG_NAME : b.opponent;
  return {
    itemId: `i${i + 1}${pass === 2 ? "b" : ""}`,
    kind: "mistake",
    pass,
    cardRef: fixtureCardKey(100 + i),
    puzzleId: null,
    fen: b.fen,
    setup: [],
    lastMove: ["d6", "g3"],
    solution: b.solution,
    accept: [],
    orient: "w",
    theme: { key: b.theme[0], label: b.theme[1] },
    rating: null,
    sourceLabel: `vs ${opponent} · today · move ${b.moveNo}`,
    context: {
      gameRef: P5_FIXTURE_GAME_REF,
      gamePly: b.moveNo * 2 - 2,
      gameLabel: `Your game vs ${opponent} · today · move ${b.moveNo}`,
      playedUci: b.played[0],
      playedSan: b.played[1],
      judgement: b.judgement,
      costText: b.cost,
    },
    text: { hint: b.hint, look: null, correct: b.correct, wrongGameMove: b.wrongGameMove, verified: true },
    preview: pass === 2 ? AFTER_AGAIN_PREVIEW : NEW_CARD_PREVIEW,
    previewAfterAgain: pass === 2 ? null : AFTER_AGAIN_PREVIEW,
    cardReps: 0,
    mastery: 0,
  };
}

function puzzleItem(i: number): TrainItem {
  const p = PUZZLE_ITEMS[i % PUZZLE_ITEMS.length]!;
  return {
    itemId: `i${i + 1}`,
    kind: "puzzle",
    pass: 1,
    cardRef: null,
    puzzleId: i < PUZZLE_ITEMS.length ? p.id : `${p.id.slice(0, 3)}${String(i).padStart(2, "0")}`,
    fen: p.fen,
    setup: [p.setup],
    lastMove: null,
    solution: p.solution,
    accept: [],
    orient: "w",
    theme: { key: "fork", label: "Forks" },
    rating: p.rating,
    sourceLabel: "Lichess puzzle · matched to your rating",
    context: null,
    text: {
      hint: p.hint,
      look: "Look for one square where a piece attacks two things.",
      correct: p.correct,
      wrongGameMove: null,
      verified: true,
    },
    preview: NEW_CARD_PREVIEW,
    previewAfterAgain: AFTER_AGAIN_PREVIEW,
    cardReps: null,
    mastery: null,
  };
}

/** The picker set (`DR/V3PuzzleThemes.dc.html` + §8.11): Recommended first, the six design themes, then More. */
export function themeOptionsFixture(): ThemeOption[] {
  const row = (key: string, label: string, group: ThemeOption["group"], pct: number | null, attempts: number, available: number, recommended = false): ThemeOption => ({
    key,
    label,
    group,
    pct,
    attempts,
    available,
    recommended,
  });
  return [
    row("fork", "Forks", "recommended", 62, 14, 250, true),
    row("pin", "Pins", "tactics", 18, 9, 250),
    row("hangingPiece", "Loose pieces", "material", 55, 11, 250),
    row("backRankMate", "Back rank", "mates", 40, 6, 250),
    row("mateIn2", "Mate in 2", "mates", null, 2, 250),
    row("discoveredAttack", "Discovered attack", "tactics", null, 0, 250),
    row("skewer", "Skewers", "tactics", null, 0, 250),
    row("capturingDefender", "Remove the defender", "tactics", null, 0, 180),
    row("trappedPiece", "Trapped piece", "material", null, 0, 120),
    row("sacrifice", "Sacrifice", "tactics", null, 0, 250),
    row("deflection", "Deflection", "tactics", null, 0, 250),
    row("attraction", "Attraction", "tactics", null, 0, 90),
    row("mateIn1", "Mate in 1", "mates", null, 0, 250),
    row("mateIn3", "Mate in 3", "mates", null, 0, 40),
    row("defensiveMove", "Defend the threat", "defence", null, 0, 250),
    row("rookEndgame", "Rook endgame", "endgames", null, 0, 250),
    row("pawnEndgame", "Pawn endgame", "endgames", null, 0, 0),
  ];
}

export const SESSION_STATES = ["bank", "puzzles", "caughtup", "cap_reached", "nothing_matches", "resumed", "stress_bank", "stress_puzzles"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** `POST /api/train/sessions` (and R3 `include=items`) in each state. */
export function sessionPayloadFixture(state: SessionState): SessionPayload {
  const bankBase: SessionPayload = {
    ref: P5_FIXTURE_SESSION_REF,
    kind: "bank",
    status: "active",
    theme: null,
    items: [0, 1, 2].map((i) => bankItem(i)),
    resumeIndex: 0,
    queueLabels: BANK_ITEMS.map((b, i) => ({ itemId: `i${i + 1}`, label: `${b.opponent} · move ${b.moveNo} · ${b.theme[1]}` })),
    header: { title: "Mistake Bank", solveStreak: 4, rating: null },
    capRemaining: 10,
    countsTowardCap: true,
    stream: false,
    targetCount: null,
    themes: null,
    widened: null,
    empty: null,
  };
  const puzzlesBase: SessionPayload = {
    ref: P5_FIXTURE_PUZZLE_SESSION_REF,
    kind: "puzzles",
    status: "active",
    theme: { key: "fork", label: "Forks" },
    items: Array.from({ length: 10 }, (_, i) => puzzleItem(i)),
    resumeIndex: 0,
    queueLabels: [],
    header: { title: "Puzzles", solveStreak: 4, rating: { value: 1512, rd: 92, vol: 0.06, provisional: false } },
    capRemaining: null,
    countsTowardCap: false,
    stream: true,
    targetCount: null,
    themes: themeOptionsFixture(),
    widened: null,
    empty: null,
  };
  switch (state) {
    case "bank":
      return bankBase;
    case "puzzles":
      return puzzlesBase;
    case "caughtup":
      return { ...bankBase, items: [], queueLabels: [], empty: "caughtup" };
    case "cap_reached":
      return { ...bankBase, items: [], queueLabels: [], capRemaining: 0, empty: "cap_reached" };
    case "nothing_matches":
      return { ...bankBase, items: [], queueLabels: [], empty: "nothing_matches" };
    case "resumed":
      // Item 1 graded Again (its pass-2 copy re-queued 4 later, here at the end), item 2 graded: resume at item 3.
      return {
        ...bankBase,
        items: [bankItem(0), bankItem(1), bankItem(2), bankItem(0, { pass: 2 })],
        queueLabels: [...bankBase.queueLabels, { itemId: "i1b", label: bankBase.queueLabels[0]!.label }],
        resumeIndex: 2,
        capRemaining: 8,
      };
    case "stress_bank":
      return {
        ...bankBase,
        items: [...Array.from({ length: 20 }, (_, i) => bankItem(i, { long: true })), ...Array.from({ length: 20 }, (_, i) => bankItem(i, { pass: 2, long: true }))],
        queueLabels: Array.from({ length: 40 }, (_, i) => ({ itemId: `i${(i % 20) + 1}${i >= 20 ? "b" : ""}`, label: `${LONG_NAME} · move 99 · Recapture first` })),
      };
    case "stress_puzzles":
      return { ...puzzlesBase, items: Array.from({ length: 20 }, (_, i) => puzzleItem(i)), widened: { from: 1300, to: 1700 } };
  }
}

/** A session payload with `n` items (the size tests: 10 and 20). */
export function sessionWithItems(n: number, kind: "bank" | "puzzles"): SessionPayload {
  const base = sessionPayloadFixture(kind);
  const items = Array.from({ length: n }, (_, i) => (kind === "bank" ? bankItem(i) : puzzleItem(i)));
  return {
    ...base,
    items,
    queueLabels: kind === "bank" ? items.map((it, i) => ({ itemId: it.itemId, label: `tal_fan_77 · move ${17 + i} · ${it.theme.label}` })) : [],
  };
}

/** W3: the next 10 puzzles. */
export function extendResultFixture(): ExtendResult {
  return { items: Array.from({ length: 10 }, (_, i) => ({ ...puzzleItem(i + 10), itemId: `i${i + 11}` })), stream: true };
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const SUMMARY_STATES = ["default", "perfect", "puzzles", "saving", "stress"] as const;
export type SummaryState = (typeof SUMMARY_STATES)[number];

export function sessionSummaryFixture(state: SummaryState): SessionSummary {
  const base: SessionSummary = {
    ref: P5_FIXTURE_SESSION_REF,
    variant: "default",
    kind: "daily",
    eyebrow: "Session summary · Mistake Bank + forks",
    title: "Done for today.",
    subtitle: "Your bank resets tomorrow. Forks are improving: 2 of 3 found on the first try.",
    stats: { solved: 4, total: 5, firstTry: 3, withHint: 1, skipped: 0 },
    grades: [
      { grade: "again", n: 1, intervalLabel: "< 10 min" },
      { grade: "hard", n: 1, intervalLabel: "2 days" },
      { grade: "good", n: 2, intervalLabel: "4 days" },
      { grade: "easy", n: 1, intervalLabel: "9 days" },
    ],
    themes: [
      { key: "fork", label: "Fork", n: 3 },
      { key: "hangingPiece", label: "Loose piece", n: 1 },
      { key: "rc:recapture", label: "Recapture first", n: 1 },
    ],
    milestone: { kind: "theme", label: "Milestone · forks 70%" },
    rating: null,
    next: {
      puzzles: { href: "/train/puzzles?theme=fork&source=summary", note: "Rated and themed sets don't count against your bank cap" },
      lesson: null,
    },
    graded: 6,
  };
  switch (state) {
    case "default":
      return base;
    case "perfect":
      return {
        ...base,
        variant: "perfect",
        title: "A perfect session.",
        subtitle: "5 of 5 on the first try. Forks just passed 70% mastery.",
        stats: { solved: 5, total: 5, firstTry: 5, withHint: 0, skipped: 0 },
        grades: [
          { grade: "again", n: 0, intervalLabel: "< 10 min" },
          { grade: "hard", n: 0, intervalLabel: "2 days" },
          { grade: "good", n: 4, intervalLabel: "4 days" },
          { grade: "easy", n: 1, intervalLabel: "9 days" },
        ],
        graded: 5,
      };
    case "puzzles":
      return {
        ...base,
        ref: P5_FIXTURE_PUZZLE_SESSION_REF,
        kind: "puzzles",
        eyebrow: "Session summary · Forks",
        title: "Session complete.",
        subtitle: "Rating 1524 (+12 this session).",
        stats: { solved: 8, total: 10, firstTry: 6, withHint: 2, skipped: 0 },
        themes: [{ key: "fork", label: "Fork", n: 10 }],
        milestone: null,
        rating: { value: 1524, delta: 12 },
        graded: 10,
      };
    case "saving":
      // The client navigated with ?n=6; the server holds 4 graded attempts so far.
      return { ...base, stats: { solved: 3, total: 5, firstTry: 2, withHint: 1, skipped: 0 }, graded: 4 };
    case "stress":
      return {
        ...base,
        eyebrow: "Session summary · Mistake Bank + discovered attacks",
        subtitle: "Your bank resets tomorrow. Discovered attacks are improving: 12 of 20 found on the first try.",
        stats: { solved: 18, total: 20, firstTry: 12, withHint: 5, skipped: 2 },
        themes: Array.from({ length: 8 }, (_, i) => ({ key: i === 0 ? "discoveredAttack" : `theme${i}`, label: "Discovered attack", n: 20 - i })),
        milestone: { kind: "streak", label: "Milestone · 30-day streak" },
        graded: 40,
      };
  }
}

// ── R1 today ────────────────────────────────────────────────────────────────────────────────────────────────────
export const TODAY_STATES = ["default", "nothingdue", "cap_reached", "partial", "new_user", "stress"] as const;
export type TodayState = (typeof TODAY_STATES)[number];

const DUE_PREVIEW: TrainToday["due"]["preview"] = [
  {
    cardRef: fixtureCardKey(0),
    fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19",
    orient: "w",
    lastMove: ["d6", "g3"],
    themeLabel: "Loose piece",
    opponent: "tal_fan_77",
    moveNo: 19,
    label: "Due: loose piece vs tal_fan_77, move 19",
  },
  {
    cardRef: fixtureCardKey(1),
    fen: "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 5 21",
    orient: "w",
    lastMove: null,
    themeLabel: "Defended pawn",
    opponent: "tal_fan_77",
    moveNo: 21,
    label: "Due: defended pawn vs tal_fan_77, move 21",
  },
  {
    cardRef: fixtureCardKey(2),
    fen: "r3k2r/1p3p2/1np2pb1/p2p3p/3P1b1P/2NBP1P1/PP1K1P2/R6R w kq - 0 16",
    orient: "w",
    lastMove: null,
    themeLabel: "Recapture first",
    opponent: "pawnstorm22",
    moveNo: 16,
    label: "Due: recapture first vs pawnstorm22, move 16",
  },
];

export function trainTodayFixture(state: TodayState): TrainToday {
  const base: TrainToday = {
    dayKey: "2026-11-12",
    weekdayLabel: "Thursday",
    plannedMinutes: 6,
    state: "default",
    streak: { current: 4, best: 9, week: [true, true, true, true, false, false, false], aria: "4-day streak: trained Monday to Thursday" },
    plan: {
      steps: [
        {
          kind: "bank",
          title: "Review 3 mistakes from yesterday's game",
          subtitle: "Mistake Bank · vs tal_fan_77 · ~2 min",
          estMin: 2,
          status: "due",
          href: "/train/bank/session?plan=1",
        },
        {
          kind: "puzzles",
          title: "3 fork puzzles at your level",
          subtitle: "Your lowest-mastery theme · rating 1512 · ~4 min",
          estMin: 4,
          status: "next",
          href: "/train/puzzles?theme=fork&n=3&source=plan",
        },
      ],
      done: 0,
      total: 2,
      basis: "bank",
      cta: { kind: "start", label: "Start Today's Plan · ~6 min", href: null },
      footnote: "Built from your Mistake Bank. Daily cap: 10 reviews.",
    },
    due: { shown: 4, raw: 4, capRemaining: 10, cap: 10, waitingLine: null, preview: DUE_PREVIEW },
    nextBatch: NEXT_BATCH,
    allTraining: {
      bank: { due: 4, total: 23 },
      puzzles: {
        themes: [
          { key: "fork", label: "Forks", pct: 62 },
          { key: "pin", label: "Pins", pct: 18 },
          { key: "backRankMate", label: "Back rank", pct: 40 },
        ],
      },
    },
    mastery: [
      { key: "fork", label: "Forks", pct: 62 },
      { key: "hangingPiece", label: "Loose pieces", pct: 55 },
      { key: "backRankMate", label: "Back rank", pct: 40 },
      { key: "pin", label: "Pins", pct: 18 },
    ],
    keepGoing: null,
    puzzleRating: { value: 1512, provisional: false },
    prefs: { timeZone: P5_FIXTURE_TZ, dayStartHour: 4, releaseHour: 8 },
  };
  const doneSteps = base.plan.steps.map((s) => ({ ...s, status: "done" as const }));
  switch (state) {
    case "default":
      return base;
    case "nothingdue":
      return {
        ...base,
        state: "nothingdue",
        plan: { ...base.plan, steps: doneSteps, done: 2, cta: { kind: "keep_going", label: "Keep Going: Fork Puzzles", href: "/train/puzzles?theme=fork&source=hub" } },
        due: { shown: 0, raw: 0, capRemaining: 6, cap: 10, waitingLine: null, preview: [] },
        allTraining: { ...base.allTraining, bank: { due: 0, total: 23 } },
        keepGoing: { href: "/train/puzzles?theme=fork&source=hub", label: "Keep Going: Fork Puzzles" },
      };
    case "cap_reached":
      return {
        ...base,
        state: "nothingdue",
        plan: { ...base.plan, steps: [doneSteps[0]!, base.plan.steps[1]!], done: 1, cta: { kind: "continue", label: "Continue Today's Plan · ~4 min", href: null } },
        due: { shown: 0, raw: 6, capRemaining: 0, cap: 10, waitingLine: "You reviewed today's 10 positions. 6 more wait for tomorrow.", preview: [] },
        allTraining: { ...base.allTraining, bank: { due: 0, total: 23 } },
      };
    case "partial":
      return {
        ...base,
        plan: {
          ...base.plan,
          steps: [doneSteps[0]!, { ...base.plan.steps[1]!, status: "due" }],
          done: 1,
          cta: { kind: "continue", label: "Continue Today's Plan · ~4 min", href: null },
        },
        due: { ...base.due, shown: 1, raw: 1, capRemaining: 7, preview: DUE_PREVIEW.slice(0, 1) },
        allTraining: { ...base.allTraining, bank: { due: 1, total: 23 } },
      };
    case "new_user":
      return {
        ...base,
        plannedMinutes: 5,
        streak: { current: 0, best: 0, week: [false, false, false, false, false, false, false], aria: "No training yet this week" },
        plan: {
          steps: [
            { kind: "review", title: "Review your last game", subtitle: "vs tal_fan_77 · the coach found 3 moments · ~1 min", estMin: 1, status: "due", href: `/review/${P5_FIXTURE_GAME_REF}` },
            { kind: "puzzles", title: "3 fork puzzles at your level", subtitle: "Start here · rating 1484 · ~4 min", estMin: 4, status: "next", href: "/train/puzzles?theme=fork&n=3&source=plan" },
          ],
          done: 0,
          total: 2,
          basis: "new",
          cta: { kind: "start", label: "Start Today's Plan · ~5 min", href: null },
          footnote: "Built from your Mistake Bank. Daily cap: 10 reviews.",
        },
        due: { shown: 0, raw: 0, capRemaining: 10, cap: 10, waitingLine: null, preview: [] },
        nextBatch: null,
        allTraining: { bank: { due: 0, total: 0 }, puzzles: { themes: [] } },
        mastery: [],
        puzzleRating: { value: 1484, provisional: true },
      };
    case "stress":
      return {
        ...base,
        weekdayLabel: "Wednesday",
        plannedMinutes: 60,
        streak: { current: 365, best: 365, week: [true, true, true, true, true, true, true], aria: "365-day streak: trained Monday to Sunday" },
        plan: {
          ...base.plan,
          steps: [
            { ...base.plan.steps[0]!, title: "Review 10 due mistakes", subtitle: "Mistake Bank · 10 games · ~8 min", estMin: 8 },
            { ...base.plan.steps[1]!, title: "3 discovered attack puzzles at your level", subtitle: "Your lowest-mastery theme · rating 2199 · ~4 min" },
          ],
          cta: { kind: "start", label: "Start Today's Plan · ~12 min", href: null },
        },
        due: {
          shown: 10,
          raw: 61,
          capRemaining: 10,
          cap: 10,
          waitingLine: "51 more wait for later days. FSRS keeps it to 10 a day.",
          preview: [...DUE_PREVIEW, { ...DUE_PREVIEW[0]!, cardRef: fixtureCardKey(3), opponent: LONG_NAME, label: `Due: loose piece vs ${LONG_NAME}, move 19` }].map((p) => ({ ...p, opponent: LONG_NAME })),
        },
        nextBatch: { ...NEXT_BATCH, count: 9_999 },
        allTraining: {
          bank: { due: 61, total: 9_999 },
          puzzles: {
            themes: [
              { key: "discoveredAttack", label: "Discovered attack", pct: 100 },
              { key: "capturingDefender", label: "Remove the defender", pct: 0 },
              { key: "defensiveMove", label: "Defend the threat", pct: null },
            ],
          },
        },
        mastery: [
          { key: "discoveredAttack", label: "Discovered attack", pct: 100 },
          { key: "capturingDefender", label: "Remove the defender", pct: 0 },
          { key: "defensiveMove", label: "Defend the threat", pct: 50 },
          { key: "rc:pawnStructure", label: "Pawn structure", pct: 99 },
        ],
        puzzleRating: { value: 2199, provisional: false },
        prefs: { timeZone: "America/Argentina/ComodRivadavia", dayStartHour: 6, releaseHour: 12 },
      };
  }
}

// ── Home ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const HOME_STATES = ["populated", "new_user", "import_running", "analysing", "clean", "nothing_due", "stress"] as const;
export type HomeState = (typeof HOME_STATES)[number];

export function homeFixture(state: HomeState): HomeData {
  const base: HomeData = {
    state: "populated",
    greeting: { part: "evening", name: "knightowl_88" },
    stats: { gamesThisWeek: 4 },
    continue: {
      kind: "moments",
      gameRef: P5_FIXTURE_GAME_REF,
      fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19",
      orient: "w",
      lastMove: ["d6", "g3"],
      opponent: "tal_fan_77",
      opponentRating: 1203,
      result: "loss",
      endMove: 28,
      openingName: "Two Knights Defence",
      whenLabel: "today",
      keyMomentCount: 3,
      accuracy: 78,
      analysis: { status: "done", done: 54, total: 54 },
    },
    startHere: null,
    bank: {
      due: 4,
      total: 23,
      estMin: 3,
      topTheme: { label: "Loose pieces", n: 7 },
      thumbs: [
        { cardRef: fixtureCardKey(0), fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19", orient: "w", label: "Due: loose piece vs tal_fan_77, move 19" },
        { cardRef: fixtureCardKey(1), fen: "r1bq1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 8", orient: "w", label: "Due: dropped bishop vs pawnstorm22, move 8" },
        { cardRef: fixtureCardKey(2), fen: "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5", orient: "b", label: "Due: loose knight vs martin_k, move 5" },
        { cardRef: fixtureCardKey(3), fen: "rn1qkbnr/pp2pppp/2p5/3pPb2/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 1 4", orient: "w", label: "Due: missed tactic vs lucena_now, move 4" },
      ],
      nextBatch: NEXT_BATCH,
    },
    week: { days: [true, true, true, true, false, false, false], games: 4, puzzles: 12, aria: "Played Monday to Thursday this week" },
    recent: [
      ["loss", "tal_fan_77", 1203, "Missed Rxf5 · move 19", "today"],
      ["win", "martin_k", 1212, "Mate like Morphy · move 17", "yesterday"],
      ["loss", "pawnstorm22", 1221, "Dropped a bishop · move 16", "Oct 27"],
      ["draw", "bishop_pair_bob", 1178, "Repetition · move 31", "Oct 26"],
      ["win", "lucena_now", 1192, "Clean game", "Oct 25"],
      ["loss", "knight_rider_9", 1240, "Hung the queen · move 22", "Oct 24"],
      ["win", "fianchetto_fran", 1158, "Fork on e6 · move 14", "Oct 23"],
      ["win", "zugzwang_zoe", 1170, "Won the rook ending · move 52", "Oct 22"],
    ].map(([result, opponent, rating, chip, dateLabel], i) => ({
      gameRef: i === 0 ? P5_FIXTURE_GAME_REF : gameRefN(40 + i),
      result: result as "win" | "loss" | "draw",
      opponent: opponent as string,
      opponentRating: rating as number,
      chip: chip as string,
      dateLabel: dateLabel as string,
    })),
    import: null,
    hasLinkedAccount: true,
  };
  switch (state) {
    case "populated":
      return base;
    case "new_user":
      return {
        ...base,
        state: "new_user",
        greeting: { part: "evening", name: "knightowl_88" },
        stats: { gamesThisWeek: 0 },
        continue: null,
        startHere: {
          href: `/position/${P5_FIXTURE_OPERA_REF}`,
          fen: "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10",
          orient: "w",
          title: "Play Your First Legend Position",
          blurb: "Paris, 1858. Morphy is White and two pieces ahead in development. Study it for 30 seconds, then play it out against someone at your level.",
          ariaLabel: "Morphy's Opera Game, move 10. White to move.",
        },
        bank: { due: 0, total: 0, estMin: 0, topTheme: null, thumbs: [], nextBatch: null },
        week: { days: [false, false, false, false, false, false, false], games: 0, puzzles: 0, aria: "No games yet this week" },
        recent: [],
        hasLinkedAccount: false,
      };
    case "import_running":
      return { ...base, import: { provider: "chesscom", imported: 212, total: 480, etaSec: 120 } };
    case "analysing":
      return {
        ...base,
        continue: { ...base.continue!, kind: "analysing", keyMomentCount: 0, accuracy: null, analysis: { status: "running", done: 14, total: 38 } },
      };
    case "clean":
      return {
        ...base,
        continue: { ...base.continue!, kind: "clean", result: "win", keyMomentCount: 0, accuracy: 92, lastMove: null, fen: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 34", endMove: 34 },
      };
    case "nothing_due":
      return { ...base, bank: { ...base.bank, due: 0, estMin: 0, thumbs: [] } };
    case "stress":
      return {
        ...base,
        greeting: { part: "morning", name: LONG_NAME },
        stats: { gamesThisWeek: 999 },
        continue: { ...base.continue!, opponent: LONG_NAME, opponentRating: 2999, openingName: "Sicilian Defence: Najdorf Variation, English Attack, Anti-English", endMove: 999 },
        bank: {
          ...base.bank,
          due: 9_999,
          total: 9_999,
          estMin: 7_499,
          topTheme: { label: "Remove the defender", n: 9_999 },
          thumbs: base.bank.thumbs.map((t) => ({ ...t, label: `Due: remove the defender vs ${LONG_NAME}, move 199` })),
          nextBatch: { ...NEXT_BATCH, count: 9_999 },
        },
        week: { days: [true, true, true, true, true, true, true], games: 999, puzzles: 9_999, aria: "Played every day this week" },
        recent: base.recent.map((r) => ({ ...r, opponent: LONG_NAME, opponentRating: 2999, chip: "Won the rook ending after a long fight · move 152 · knight fork on e6" })),
        import: { provider: "lichess", imported: 9_999, total: 9_999, etaSec: 86_400 },
      };
  }
}

// ── Small payloads ──────────────────────────────────────────────────────────────────────────────────────────────
export function themesResultFixture(): ThemesResult {
  return { options: themeOptionsFixture(), rating: 1512 };
}

export function badgesFixture(): Badges {
  return { bankDue: 4, trainDot: true };
}

export function trainPrefsFixture(): TrainPrefs {
  return { timeZone: P5_FIXTURE_TZ, dayStartHour: 4, releaseHour: 8, bankDailyCap: 10, newPerDay: 5, autoGrade: false };
}

export function skipResultFixture(): SkipResult {
  return { suspendedUntil: P5_FIXTURE_NEXT_RELEASE, label: "Tomorrow" };
}

/** A6 after turning a moment back on: a NEW card due at the next release. */
export function momentBankOutFixture(inBank: boolean): MomentBankResponse {
  return inBank
    ? { ply: 36, inBank: true, card: { ref: fixtureCardKey(0), dueAt: P5_FIXTURE_NEXT_RELEASE, dueLabel: "Tomorrow" } }
    : { ply: 36, inBank: false, card: null };
}

export function reportBodyFixture(): ReportBody {
  return {
    targetType: "mistake",
    targetRef: P5_FIXTURE_MISTAKE_REF,
    reason: "better_move",
    note: "Rxf5 is fine, but Nxe5 looks stronger to me.",
    fen: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19",
  };
}

export function reportResultFixture(duplicate = false): ReportResult {
  return { ref: P5_FIXTURE_REPORT_REF, duplicate };
}

/** `n` attempts as the outbox sends them (W1 body), alternating bank and puzzle items. */
export function attemptsFixture(n: number): AttemptIn[] {
  return Array.from({ length: n }, (_, i) => {
    const puzzle = i % 2 === 1;
    return {
      clientAttemptId: `0b7f3c1e-9a4d-4c5e-8f21-${String(i).padStart(12, "0")}`,
      sessionRef: puzzle ? P5_FIXTURE_PUZZLE_SESSION_REF : P5_FIXTURE_SESSION_REF,
      itemId: `i${i + 1}`,
      cardRef: puzzle ? null : fixtureCardKey(i),
      puzzleId: puzzle ? "0009B" : null,
      kind: puzzle ? "puzzle" : "mistake",
      solved: true,
      firstTry: i % 3 !== 0,
      hintsUsed: i % 3 === 0 ? 1 : 0,
      wrongMovesUci: i % 5 === 0 ? ["b5d6"] : [],
      solutionShown: false,
      timeMs: 24_000 + i * 731,
      grade: i % 3 === 0 ? "hard" : "good",
      suggestedGrade: i % 3 === 0 ? "hard" : "good",
      cardReps: puzzle ? null : 2,
      reviewedAt: at(-60 + i),
    };
  });
}

export function attemptOutFixture(a: AttemptIn, i: number): AttemptOut {
  const puzzle = a.kind === "puzzle";
  return {
    clientAttemptId: a.clientAttemptId,
    status: "ok",
    ...(a.cardRef ? { card: { ref: a.cardRef, due: releaseIn(4), dueLabel: "Mon", mastery: 2, reps: 3, scheduled: true, requeued: false } } : {}),
    ...(puzzle ? { rating: { value: 1512 + i, delta: 12, provisional: false } } : {}),
    solveStreak: 5,
    dayStreak: 4,
    theme: { key: "fork", pct: 62, ...(i === 0 ? { milestone: 70 as const } : {}) },
  };
}

export function attemptsResultFixture(n: number): AttemptsResult {
  return { results: attemptsFixture(n).map(attemptOutFixture), capRemaining: 7, planDone: 1, bankDue: 3 };
}
