// Typed P3 HTTP fixtures (phase-03 plan §4, §5, §7.1) for the UI packages (`/dev/ui/*` demos, component tests, e2e
// mocks) and the contract tests: `import { reviewFixture } from "@repo/contracts/http/fixtures/review"`.
//
// The data is the design's: `DR/V3ReviewSummary.dc.html` GAME (knightowl_88 vs tal_fan_77, Two Knights, 0–1
// resigned, 54 plies, moments at plies 32 INACCURACY, 36 MISS and 40 BLUNDER) and CLEAN (the Opera Game as White,
// 16.Qb8+ BRILLIANT, 17.Rd8#), and `DR/V3LegendCompare.dc.html` (12.Ba4 vs Morphy's 12.O-O-O). The moves, SAN,
// best moves and FENs were replayed with chess.js 1.4.0, so every move is legal in its position. Documented
// differences from the mock: 44.Rxf6 is graded INACCURACY (P3-D15: INTERESTING is never emitted in GRADING_VERSION 1),
// and CLEAN's mock scores 2000/3000 on the mating line are mate codes (30000 − n: White mates in 1 after 16.Qb8+ and
// after 16…Nxb8; 30000 after 17.Rd8#, the side to move is mated). Every fixture parses with its
// schema (review.test.ts). Pure data: no zod at runtime, safe to import from client demos.
import type { CompleteResponse, GameRowDTO, GamesPageMeta } from "../games";
import type { LegendCompareDTO } from "../legend";
import type { PracticeContextDTO } from "../practice";
import type {
  AnalyseResponse,
  AnalysisStatusWire,
  CompleteOut,
  LegendSummaryDTO,
  MomentDTO,
  PlayerCard,
  ReviewAnalysis,
  ReviewCompleteView,
  ReviewContentDTO,
  ReviewDTO,
  ReviewStatusDTO,
  RetryResponse,
} from "../review";
import type { ShareDTO } from "../share";

// ── Identities (25-character cuids, as the socket fixtures) ─────────────────────────────────────────────────────
export const FIXTURE_GAME_REF = "cm3k9x2p10007slzpqa8hd4fe";
export const FIXTURE_CLEAN_REF = "cm3k9xq7r0009slzpw2e5bn1k";
export const FIXTURE_LEGEND_REF = "cm3kb2v4d000bslzp6q1m8r3t";
export const FIXTURE_POSITION_REF = "cm1z0p8k40001ls8dq7n2v5wa";
export const FIXTURE_SHARE_CODE = "k7m2x9qa";
export const FIXTURE_SITE_URL = "https://playchess.tech";
export const FIXTURE_PLAYED_AT = "2026-11-09T18:42:10.000Z";
export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const you = (name: string, rating: number): PlayerCard => ({ name, rating, initials: name.slice(0, 2).toUpperCase(), kind: "member", isYou: true });
const opp = (name: string, rating: number | null, kind: PlayerCard["kind"] = "member"): PlayerCard => ({
  name,
  rating,
  initials: name.slice(0, 2).toUpperCase(),
  kind,
  isYou: false,
});

/** Remaining ms after each ply of a 10+0 game: a deterministic, plausible spend pattern. */
export function fixtureClocks(plies: number, initialMs = 600_000): number[] {
  const left = { w: initialMs, b: initialMs };
  return Array.from({ length: plies }, (_, i) => {
    const side = i % 2 === 0 ? "w" : "b";
    left[side] = Math.max(0, left[side] - (2_000 + ((i * 7_919) % 23_000)));
    return left[side];
  });
}

// ── GAME (DR/V3ReviewSummary.dc.html) ───────────────────────────────────────────────────────────────────────────
export const GAME = {
  plies: 54,
  moves:
    "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5 e4d5 c6a5 c4b5 c7c6 d5c6 b7c6 b5e2 h7h6 g5f3 e5e4 f3e5 f8d6 d2d4 e4d3 " +
    "e5d3 d8c7 h2h3 e8g8 e1g1 f8d8 b1c3 c8f5 c1e3 a5c4 b2b3 c4e3 f2e3 d6g3 d1d2 f5h7 e2f3 d8e8 f3c6 c7c6 a1d1 c6b6 " +
    "f1f6 b6f6 c3d5 f6d6 d3e1 g3e1 d2e1 a8d8 c2c4 g8h8",
  san:
    "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5 Bd6 d4 exd3 Nxd3 Qc7 h3 O-O O-O Rd8 " +
    "Nc3 Bf5 Be3 Nc4 b3 Nxe3 fxe3 Bg3 Qd2 Bh7 Bf3 Re8 Bxc6 Qxc6 Rad1 Qb6 Rxf6 Qxf6 Nd5 Qd6 Ne1 Bxe1 Qxe1 Rad8 c4 Kh8",
  best:
    "e2e4 e7e5 g1f3 g8f6 d2d4 g8f6 d2d3 d7d5 e4d5 c6a5 c4b5 c7c6 d5c6 b7c6 b5d3 h7h6 g5h3 e5e4 f3e5 f8c5 d2d4 e4d3 " +
    "e5d3 e8g8 b2b3 e8g8 e1g1 c6c5 b1d2 a8b8 e2g4 a8b8 d1c1 c4e3 f2e3 f5h7 f1f5 f5h7 e2f3 c7e7 c3e2 c7c6 f1f3 a8d8 " +
    "d3f4 b6f6 c3d5 f6d6 d3f4 d6f8 d2e1 h7c2 e1f2 h7e4",
  j: "kkkkkkkkkkkkkkkkkkkkkkkkgbbggEEEIbbXSbbEXbggIbbbEEbEEE",
  evals: [
    30, 36, 36, 41, 31, 18, 18, -4, -5, -6, -8, -9, -3, -2, -2, -16, -12, -17, -20, -19, 20, 6, 4, 4, 7, -27, -16, -20, 5,
    -27, -10, -28, -27, -137, -140, -130, 290, -62, -69, -76, -66, -365, -388, -426, -371, -427, -428, -433, -427, -438,
    -425, -453, -420, -433, -402,
  ],
  counts: {
    w: [0, 0, 0, 5, 3, 3, 12, 0, 0, 2, 0, 1, 1],
    b: [0, 0, 0, 6, 6, 2, 12, 0, 0, 0, 0, 0, 1],
  },
  finalFen: "3rr2k/p4ppb/3q3p/3N4/2P5/1P2P2P/P5P1/3RQ1K1 w - - 1 28",
} as const;

// ── CLEAN (DR/V3ReviewClean.dc.html: the Opera Game as White) ───────────────────────────────────────────────────
export const CLEAN = {
  plies: 33,
  moves:
    "e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3 d6e5 f1c4 g8f6 f3b3 d8e7 b1c3 c7c6 c1g5 b7b5 c3b5 c6b5 c4b5 b8d7 " +
    "e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 b5d7 f6d7 b3b8 d7b8 d1d8",
  san:
    "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 " +
    "Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#",
  best:
    "e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3 d6e5 f1c4 g8f6 f3b3 d8e7 b1c3 c7c6 c1g5 b7b5 c3b5 c6b5 c4b5 b8d7 " +
    "e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 b5d7 f6d7 b3b8 d7b8 d1d8",
  j: "kkkkkkkkbgbkEbbgEbbbEbbgbbGbEbBFb",
  evals: [
    20, 20, 25, 30, 40, 60, 55, 120, 110, 160, 150, 170, 160, 220, 200, 260, 250, 300, 260, 420, 400, 520, 500, 560, 540,
    700, 680, 800, 760, 900, 880, 29_999, 29_999, 30_000,
  ],
  counts: {
    w: [0, 1, 1, 7, 4, 0, 4, 0, 0, 0, 0, 0, 0],
    b: [0, 0, 0, 7, 0, 3, 5, 1, 0, 0, 0, 0, 0],
  },
  finalFen: "1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17",
} as const;

// ── The design's three moments of GAME (§8.5: plies 32, 36, 40) ─────────────────────────────────────────────────
const sentence = (t: string) => ({ t, v: false });

export const GAME_MOMENTS: MomentDTO[] = [
  {
    ply: 32,
    moveLabel: "17.",
    judgement: "inaccuracy",
    playedUci: "b2b3",
    playedSan: "b3",
    bestUci: "d1c1",
    bestSan: "Qc1",
    accept: ["d1c1"],
    line: "d1c1 c4e3 c1e3",
    lineSan: "Qc1 Nxe3 Qxe3",
    winBefore: 47.5,
    winAfter: 37.6,
    intent: "defend",
    ask: "Move 17. Black’s knight on c4 is eyeing your bishop on e3. What would you play?",
    why: [
      sentence("After b3 the knight takes on e3 and fxe3 leaves you with doubled e-pawns."),
      sentence("Qc1 keeps the queen ready to recapture on e3 instead."),
      sentence("You lose about 10 win% points, so this is an inaccuracy, not a disaster."),
    ],
    plan: {
      attack: "You were thinking: attack. The engine’s idea here was to defend: Qc1 keeps e3 covered.",
      defend: "Right instinct. After b3 the knight takes on e3 and fxe3 leaves you with doubled e-pawns.",
      trade: "You were thinking: trade. The engine’s idea here was to defend: Qc1 keeps e3 covered.",
      improve: "You were thinking: improve. The engine’s idea here was to defend: Qc1 keeps e3 covered.",
      unsure: "The engine’s idea here was to defend: Qc1.",
    },
    inBank: true,
    result: "found_retry",
    attempts: 2,
  },
  {
    ply: 36,
    moveLabel: "19.",
    judgement: "miss",
    playedUci: "d1d2",
    playedSan: "Qd2",
    bestUci: "f1f5",
    bestSan: "Rxf5",
    accept: ["f1f5"],
    line: "f1f5 g3h2 g1h1",
    lineSan: "Rxf5 Bh2+ Kh1",
    winBefore: 74.4,
    winAfter: 44.3,
    intent: "trade",
    ask: "Move 19. Black just played Bg3. Something was available here. What would you play?",
    why: [
      sentence("Rxf5 wins the bishop on f5."),
      sentence("Bg3 left the bishop on f5 with no defender, and your rook sees it down the open f-file."),
      sentence("You lose about 30 win% points, so this is the move that decided the game."),
    ],
    plan: {
      attack: "You were thinking: attack. The engine’s idea here was to trade: Rxf5 wins a whole piece.",
      defend: "You were thinking: defend. The engine’s idea here was to trade: Rxf5 wins a whole piece.",
      trade: "Right instinct. Rxf5 wins the bishop on f5.",
      improve: "You were thinking: improve. The engine’s idea here was to trade: Rxf5 wins a whole piece.",
      unsure: "The engine’s idea here was to trade: Rxf5.",
    },
    inBank: true,
    result: "found",
    attempts: 1,
  },
  {
    ply: 40,
    moveLabel: "21.",
    judgement: "blunder",
    playedUci: "f3c6",
    playedSan: "Bxc6",
    bestUci: "c3e2",
    bestSan: "Ne2",
    accept: ["c3e2"],
    line: "c3e2 g3h2 g1h1",
    lineSan: "Ne2 Bh2+ Kh1",
    winBefore: 44,
    winAfter: 20.7,
    intent: "defend",
    ask: "Move 21. The position is still close. What would you play?",
    why: [
      sentence("After Bxc6, Qxc6 wins the bishop: the queen on c7 guards c6."),
      sentence("Ne2 challenges the bishop on g3 and keeps the game level."),
      sentence("You lose about 23 win% points, so this is the move that decided the game."),
    ],
    plan: {
      attack: "You were thinking: attack. The engine’s idea here was to defend: Ne2 challenges the bishop on g3.",
      defend: "Right instinct. After Bxc6, Qxc6 wins the bishop: the queen on c7 guards c6.",
      trade: "You were thinking: trade. The engine’s idea here was to defend: Ne2 challenges the bishop on g3.",
      improve: "You were thinking: improve. The engine’s idea here was to defend: Ne2 challenges the bishop on g3.",
      unsure: "The engine’s idea here was to defend: Ne2.",
    },
    inBank: true,
    result: "revealed",
    attempts: 3,
  },
];

/** The fen after each GAME moment (the Complete page's mini boards). */
export const GAME_MOMENT_FENS_AFTER: Record<number, string> = {
  32: "r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/1PNNB2P/P1P1BPP1/R2Q1RK1 b - - 0 17",
  36: "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1PQB1P1/R4RK1 b - - 2 19",
  40: "r3r1k1/p1q2ppb/2B2n1p/8/8/1PNNP1bP/P1PQ2P1/R4RK1 b - - 0 21",
};

// ── ReviewDTO in every state the screen renders ─────────────────────────────────────────────────────────────────
export const REVIEW_FIXTURE_STATES = ["none", "queued", "running", "failed", "terminal", "skipped", "done", "clean"] as const;
export type ReviewFixtureState = (typeof REVIEW_FIXTURE_STATES)[number];

const bestPrefix = (best: string, n: number) => best.split(" ").slice(0, n).join(" ");

function gameAnalysis(graded: number, extra: Partial<ReviewAnalysis> = {}): ReviewAnalysis {
  const done = graded === GAME.plies;
  const zero = Array(13).fill(0) as number[];
  return {
    version: 1,
    engineLabel: "Stockfish 18",
    depthLabel: "depth 18",
    gradedPlies: graded,
    totalPlies: GAME.plies,
    evals: GAME.evals.slice(0, graded + 1),
    best: bestPrefix(GAME.best, graded),
    j: GAME.j.slice(0, graded),
    accuracy: done ? { w: 85, b: 89 } : { w: null, b: null },
    phaseAccuracy: done ? { w: [93, 74, -1], b: [92, 88, -1] } : { w: [], b: [] },
    phases: { middlegamePly: done ? 24 : null, endgamePly: null },
    counts: done ? { w: [...GAME.counts.w], b: [...GAME.counts.b] } : { w: [...zero], b: [...zero] },
    failure: null,
    queue: null,
    ...extra,
  };
}

const GAME_REVIEW: ReviewContentDTO = {
  textStatus: "template",
  summary: [
    sentence("You played at 85 accuracy; your opponent at 89."),
    sentence("The game turned on move 19, when Qd2 missed Rxf5."),
    sentence("3 moments are worth a second look."),
  ],
  coachLine: sentence("The game turned on move 19, when Qd2 missed Rxf5."),
  phaseLine: "Opening equal · middlegame lost the thread · endgame not reached",
  headline: "Missed Rxf5 · move 19",
  isClean: false,
  bestPly: 26,
  bestDecision: null,
  moments: GAME_MOMENTS,
  progress: { momentIndex: 0, startedAt: null, completedAt: null },
};

function gameReview(state: Exclude<ReviewFixtureState, "clean">): ReviewDTO {
  const status: AnalysisStatusWire = state === "terminal" ? "failed" : state;
  let analysis: ReviewAnalysis | null;
  switch (state) {
    case "none":
    case "skipped":
      analysis = null;
      break;
    case "queued":
      analysis = gameAnalysis(0, { queue: { position: 2, etaSec: 40 } });
      break;
    case "running":
      analysis = gameAnalysis(20);
      break;
    case "failed":
      analysis = gameAnalysis(20, { failure: { failedAtPly: 20, retryable: true, retryAt: "2026-11-09T18:45:10.000Z", code: "engine_failed" } });
      break;
    case "terminal":
      analysis = gameAnalysis(20, { failure: { failedAtPly: 20, retryable: false, retryAt: null, code: "engine_failed" } });
      break;
    case "done":
      analysis = gameAnalysis(GAME.plies);
      break;
  }
  return {
    v: 1,
    ref: FIXTURE_GAME_REF,
    status,
    game: {
      mode: "online",
      source: "replay",
      startFen: INITIAL_FEN,
      startPly: 0,
      tc: { label: "Rapid 10+0", timeClass: "rapid", initialSec: 600, incSec: 0 },
      result: "0-1",
      endLabel: "0–1 resigned",
      playedAt: FIXTURE_PLAYED_AT,
      playedAtLabel: "Nov 9",
      opening: { eco: "C59", name: "Two Knights Defense: Main Line" },
      legend: null,
    },
    players: { w: you("knightowl_88", 1184), b: opp("tal_fan_77", 1203) },
    you: "w",
    moves: GAME.moves,
    san: GAME.san,
    clocks: fixtureClocks(GAME.plies),
    analysis,
    review: state === "done" ? GAME_REVIEW : null,
    share: null,
  };
}

function cleanReview(): ReviewDTO {
  const done = CLEAN.plies;
  return {
    v: 1,
    ref: FIXTURE_CLEAN_REF,
    status: "done",
    game: {
      mode: "bot",
      source: "replay",
      startFen: INITIAL_FEN,
      startPly: 0,
      tc: { label: "Untimed", timeClass: "untimed", initialSec: 0, incSec: 0 },
      result: "1-0",
      endLabel: "1–0 checkmate",
      playedAt: FIXTURE_PLAYED_AT,
      playedAtLabel: "Nov 9",
      opening: { eco: "C41", name: "Philidor Defense" },
      legend: null,
    },
    players: { w: you("knightowl_88", 1184), b: opp("Engine 1200", 1200, "bot") },
    you: "w",
    moves: CLEAN.moves,
    san: CLEAN.san,
    clocks: [],
    analysis: {
      version: 1,
      engineLabel: "Stockfish 18",
      depthLabel: "depth 18",
      gradedPlies: done,
      totalPlies: done,
      evals: [...CLEAN.evals],
      best: CLEAN.best,
      j: CLEAN.j,
      accuracy: { w: 97, b: 71 },
      phaseAccuracy: { w: [98, 96, -1], b: [88, 64, -1] },
      phases: { middlegamePly: 18, endgamePly: null },
      counts: { w: [...CLEAN.counts.w], b: [...CLEAN.counts.b] },
      failure: null,
      queue: null,
    },
    review: {
      textStatus: "template",
      summary: [sentence("You played at 97 accuracy; your opponent at 71."), sentence("Nothing big to fix in this one.")],
      coachLine: sentence("Your best decision: 16.Qb8+, a sacrifice that forced mate."),
      phaseLine: "Opening solid · middlegame won it · endgame not reached",
      headline: "Clean game",
      isClean: true,
      bestPly: 30,
      bestDecision: "Your best decision: 16.Qb8+, a sacrifice that forced mate.",
      moments: [],
      progress: { momentIndex: 0, startedAt: null, completedAt: null },
    },
    share: null,
  };
}

/** A ReviewDTO in one state (`terminal` = failed with no retry left; `clean` = the CLEAN game, done). */
export function reviewFixture(state: ReviewFixtureState = "done", options: { shared?: boolean } = {}): ReviewDTO {
  const dto = state === "clean" ? cleanReview() : gameReview(state);
  if (options.shared) dto.share = { code: FIXTURE_SHARE_CODE, url: `${FIXTURE_SITE_URL}/r/${FIXTURE_SHARE_CODE}`, expiresAt: "2026-12-09T18:50:00.000Z", showUsername: true };
  return dto;
}

// ── Legend comparison (DR/V3LegendCompare.dc.html, DR/V3GameOverLegend.dc.html) ────────────────────────────────
export const OPERA = {
  /** After 9…b5 of Morphy vs Duke Karl / Count Isouard, Paris 1858 (startPly 18). */
  startFen: "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10",
  startPly: 18,
  legendUci: "c3b5 c6b5 c4b5 b8d7 e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 b5d7 f6d7 b3b8 d7b8 d1d8",
  /** The user (White) leaves the path with 12.Ba4 and the game is drawn by repetition on move 17. */
  userUci: "c3b5 c6b5 c4b5 b8d7 b5a4 a8b8 a4b5 b8a8 b5a4 a8b8 a4b5 b8a8 b5a4 a8b8 a4b5 b8a8",
  divergenceFen: "r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R w KQkq - 1 12",
} as const;

export const LEGEND_SUMMARY_VARIANTS = ["diverged", "followed", "opponent_left", "facts_ready"] as const;
export type LegendSummaryVariant = (typeof LEGEND_SUMMARY_VARIANTS)[number];

/** The game-over legend block and A2's `comparison`. */
export function legendSummaryFixture(variant: LegendSummaryVariant = "diverged"): LegendSummaryDTO {
  const compareHref = `/review/${FIXTURE_LEGEND_REF}/legend`;
  switch (variant) {
    case "followed":
      return {
        status: "ready",
        legendName: "Morphy",
        legendResult: "white_won",
        matched: 8,
        compared: 8,
        divergence: null,
        rows: [
          { n: "14.", yours: "Rd1", legend: "Rd1", mark: "match" },
          { n: "15.", yours: "Bxd7+", legend: "Bxd7+", mark: "match" },
          { n: "16.", yours: "Qb8+", legend: "Qb8+", mark: "match" },
          { n: "17.", yours: "Rd8#", legend: "Rd8#", mark: "match" },
        ],
        outcomeLine: "Morphy won this; you won.",
        compareHref,
        replayHref: null,
      };
    case "opponent_left":
      return {
        status: "ready",
        legendName: "Kasparov",
        legendResult: "white_won",
        matched: 6,
        compared: 6,
        divergence: { ply: 13, moveLabel: "25…", userSan: "Kb6", legendSan: "Kxd4", by: "opponent" },
        rows: [
          { n: "23.", yours: "Qd4", legend: "Qd4", mark: "match" },
          { n: "24.", yours: "Rxd4", legend: "Rxd4", mark: "match" },
          { n: "25.", yours: "Re7+", legend: "Re7+", mark: "match" },
        ],
        outcomeLine: "Kasparov won this; you won.",
        compareHref,
        replayHref: null,
      };
    case "facts_ready":
    case "diverged":
      return {
        status: variant === "facts_ready" ? "facts_ready" : "ready",
        legendName: "Morphy",
        legendResult: "white_won",
        matched: 2,
        compared: 3,
        divergence: { ply: 4, moveLabel: "12.", userSan: "Ba4", legendSan: "O-O-O", by: "user" },
        rows: [
          { n: "10.", yours: "Nxb5", legend: "Nxb5", mark: "match" },
          { n: "11.", yours: "Bxb5+", legend: "Bxb5+", mark: "match" },
          { n: "12.", yours: "Ba4", legend: "O-O-O", mark: "split" },
          { n: "13.", yours: "Bb5", legend: "Rxd7", mark: "none" },
          { n: "14.", yours: "Ba4", legend: "Rd1", mark: "none" },
        ],
        outcomeLine: "Morphy won this; you drew.",
        compareHref,
        replayHref: `/practice?game=${FIXTURE_LEGEND_REF}&ply=4`,
      };
  }
}

/** A9's payload: the Opera comparison, with or without the evals at the split and the static explanation. */
export function legendCompareFixture(
  options: { status?: LegendCompareDTO["status"]; withExplanation?: boolean; hasExplanation?: boolean } = {},
): LegendCompareDTO {
  const status = options.status ?? "ready";
  const hasExplanation = options.hasExplanation ?? true;
  return {
    v: 1,
    ref: FIXTURE_LEGEND_REF,
    status,
    attempts: status === "facts_ready" ? 0 : 1,
    analysisStatus: "done",
    legend: { name: "Morphy", fullName: "Paul Morphy", year: 1858, title: "Opera Game, Paris 1858", positionRef: FIXTURE_POSITION_REF },
    you: "w",
    players: { w: you("knightowl_88", 1184), b: opp("martin_k", 1212) },
    startFen: OPERA.startFen,
    startPly: OPERA.startPly,
    matched: 2,
    compared: 3,
    divergence: {
      ply: 4,
      moveLabel: "12.",
      by: "user",
      userUci: "b5a4",
      userSan: "Ba4",
      legendUci: "e1c1",
      legendSan: "O-O-O",
      fenBefore: OPERA.divergenceFen,
    },
    evalAtDivergence: status === "ready" ? { userWin: 41, legendWin: 78 } : null,
    legendResult: "white_won",
    legendTotalMoves: 17,
    userResult: "draw",
    summaryLine: "You matched 2 of 3 moves, then left his path with 12.Ba4.",
    paragraph:
      "You matched Morphy for 2 of 3 moves. On move 12 you played Ba4; Morphy played O-O-O." +
      (status === "ready" ? " After that your winning chances were 41% against 78% for Morphy’s move." : ""),
    outcomeLine: "Morphy won this; you drew.",
    yourLine: {
      uci: OPERA.userUci,
      rows: [
        { n: "10.", w: "Nxb5", b: "cxb5", mark: "match" },
        { n: "11.", w: "Bxb5+", b: "Nbd7", mark: "match" },
        { n: "12.", w: "Ba4", b: "Rb8", mark: "split" },
        { n: "13.", w: "Bb5", b: "Ra8", mark: "none" },
        { n: "14.", w: "Ba4", b: "Rb8", mark: "none" },
        { n: "15.", w: "Bb5", b: "Ra8", mark: "none" },
        { n: "16.", w: "Ba4", b: "Rb8", mark: "none" },
        { n: "17.", w: "Bb5", b: "Ra8", mark: "none" },
      ],
    },
    legendLine: {
      uci: OPERA.legendUci,
      rows: [
        { n: "10.", w: "Nxb5", b: "cxb5", mark: "none" },
        { n: "11.", w: "Bxb5+", b: "Nbd7", mark: "none" },
        { n: "12.", w: "O-O-O", b: "Rd8", mark: "none" },
        { n: "13.", w: "Rxd7", b: "Rxd7", mark: "none" },
        { n: "14.", w: "Rd1", b: "Qe6", mark: "none" },
        { n: "15.", w: "Bxd7+", b: "Nxd7", mark: "none" },
        { n: "16.", w: "Qb8+", b: "Nxb8", mark: "none" },
        { n: "17.", w: "Rd8#", b: null, mark: "none" },
      ],
    },
    practice: { ply: 4, href: `/practice?game=${FIXTURE_LEGEND_REF}&ply=4`, botElo: 1400 },
    hasExplanation,
    explanation:
      hasExplanation && options.withExplanation
        ? {
            fen: OPERA.divergenceFen,
            segments: [
              { visuals: [{ type: "highlight", squares: ["e8", "d7"], color: "rgba(235,185,60,0.4)" }], narration: "Black is behind in development.", startTime: 0, endTime: 24 },
              { visuals: [{ type: "arrow", from: "c3", to: "b5", color: "#0369a1" }], narration: "Nxb5 opens lines on the king.", startTime: 24, endTime: 51 },
              { visuals: [{ type: "showMove", san: "O-O-O" }], narration: "Where you left the path: 12.Ba4.", startTime: 51, endTime: 78 },
              { visuals: [{ type: "arrow", from: "d1", to: "d7", color: "#0369a1" }], narration: "Why O-O-O wins: the d-file.", startTime: 78, endTime: 106 },
              { visuals: [{ type: "showMove", san: "Qb8+" }], narration: "The finish: Qb8+ and Rd8#.", startTime: 106, endTime: 130 },
            ],
            audioFile: "opera-game.mp3",
          }
        : null,
    audioUrl: hasExplanation ? "https://media.playchess.tech/explanations/opera-game.mp3" : null,
    updatedAt: "2026-11-09T18:43:02.000Z",
  };
}

// ── A2 status in the states the game-over card and the poller see ───────────────────────────────────────────────
export const REVIEW_STATUS_FIXTURE_STATES = ["queued", "running", "done", "clean", "failed", "terminal", "skipped", "legend"] as const;
export type ReviewStatusFixtureState = (typeof REVIEW_STATUS_FIXTURE_STATES)[number];

export function reviewStatusFixture(state: ReviewStatusFixtureState = "running"): ReviewStatusDTO {
  const base: ReviewStatusDTO = {
    v: 1,
    analysis: { status: "running", gradedPlies: 35, totalPlies: GAME.plies, failedAtPly: null, retryable: false, retryAt: null, code: null, etaSec: 8 },
    review: { ready: false, accuracy: null, momentsCount: 0, isClean: false, coachLine: null },
    comparison: null,
    bank: null,
  };
  switch (state) {
    case "queued":
      return { ...base, analysis: { ...base.analysis, status: "queued", gradedPlies: 0, etaSec: 25 } };
    case "running":
      return base;
    case "done":
      return {
        ...base,
        analysis: { ...base.analysis, status: "done", gradedPlies: GAME.plies, etaSec: null },
        review: { ready: true, accuracy: 85, momentsCount: 3, isClean: false, coachLine: "The game turned on move 19, when Qd2 missed Rxf5." },
      };
    case "clean":
      return {
        ...base,
        analysis: { ...base.analysis, status: "done", gradedPlies: CLEAN.plies, totalPlies: CLEAN.plies, etaSec: null },
        review: { ready: true, accuracy: 97, momentsCount: 0, isClean: true, coachLine: "Your best decision: 16.Qb8+, a sacrifice that forced mate." },
      };
    case "failed":
      return { ...base, analysis: { ...base.analysis, status: "failed", gradedPlies: 20, failedAtPly: 20, retryable: true, retryAt: "2026-11-09T18:45:10.000Z", code: "worker_stalled", etaSec: null } };
    case "terminal":
      return { ...base, analysis: { ...base.analysis, status: "failed", gradedPlies: 20, failedAtPly: 20, retryable: false, code: "engine_failed", etaSec: null } };
    case "skipped":
      return { ...base, analysis: { ...base.analysis, status: "skipped", gradedPlies: 0, totalPlies: 4, etaSec: null } };
    case "legend":
      return {
        ...base,
        analysis: { ...base.analysis, status: "done", gradedPlies: 16, totalPlies: 16, etaSec: null },
        review: { ready: true, accuracy: 91, momentsCount: 1, isClean: false, coachLine: "The game turned on move 12, when Ba4 missed O-O-O." },
        comparison: legendSummaryFixture("diverged"),
      };
  }
}

// ── Mutations and small responses ───────────────────────────────────────────────────────────────────────────────
export const ANALYSE_RESPONSE_FIXTURE: AnalyseResponse = { status: "queued", position: 2, etaSec: 40 };
export const RETRY_RESPONSE_FIXTURE: RetryResponse = { status: "queued", resumeFromPly: 20, etaSec: 30 };
export const COMPLETE_OUT_FIXTURE: CompleteOut = {
  accuracy: 85,
  moments: 3,
  found: 2,
  revealed: 1,
  isClean: false,
  bestThisMonth: false,
  completedAt: "2026-11-09T18:58:40.000Z",
};

/** The bot `complete` response of a legend-bot game in P3 (analysis queued, the legend block filled). */
export const COMPLETE_RESPONSE_LEGEND_FIXTURE: CompleteResponse = {
  status: "COMPLETED",
  outcome: "DRAW",
  method: "threefold",
  analysis: { status: "queued", etaSec: 20 },
  comparison: legendSummaryFixture("diverged"),
};

export function shareFixture(options: { showUsername?: boolean; imageVersion?: number } = {}): ShareDTO {
  const v = options.imageVersion ?? 1;
  return {
    code: FIXTURE_SHARE_CODE,
    url: `${FIXTURE_SITE_URL}/r/${FIXTURE_SHARE_CODE}`,
    imageUrl: `${FIXTURE_SITE_URL}/r/${FIXTURE_SHARE_CODE}/og?v=${v}`,
    expiresAt: "2026-12-09T18:50:00.000Z",
    showUsername: options.showUsername ?? true,
  };
}

// ── The Complete page (DR/V3RvComplete.dc.html, DR/V3RvCompleteClean.dc.html) ──────────────────────────────────
export const REVIEW_COMPLETE_FIXTURE_STATES = ["default", "nothing", "partial", "noMoments"] as const;
export type ReviewCompleteFixtureState = (typeof REVIEW_COMPLETE_FIXTURE_STATES)[number];

export function reviewCompleteFixture(state: ReviewCompleteFixtureState = "default"): ReviewCompleteView {
  const header = { eyebrow: "Review · vs tal_fan_77 · 0–1", opponentName: "tal_fan_77", resultLabel: "0–1" };
  const moments = GAME_MOMENTS.map((m) => ({
    ply: m.ply,
    moveLabel: m.moveLabel,
    fenAfter: GAME_MOMENT_FENS_AFTER[m.ply] as string,
    playedSan: m.playedSan,
    bestSan: m.bestSan,
    judgement: m.judgement,
    why0: m.why[0]?.t ?? null,
    result: m.result,
  }));
  const base: ReviewCompleteView = {
    v: 1,
    ref: FIXTURE_GAME_REF,
    header,
    accuracy: 85,
    moments,
    found: 2,
    reviewed: 3,
    isClean: false,
    bestDecision: null,
    brilliant: 0,
    standouts: [],
    bestThisMonth: false,
    partial: false,
    shareEnabled: true,
  };
  switch (state) {
    case "default":
      return base;
    case "partial":
      return { ...base, moments: moments.map((m, i) => (i === 2 ? { ...m, result: null } : m)), found: 2, reviewed: 2, partial: true };
    case "noMoments":
      // No moments, not clean: the best decision (GAME's bestPly 26, 14.O-O) is the Best move stat and the one card.
      return {
        ...base,
        accuracy: 88,
        moments: [],
        found: 0,
        reviewed: 0,
        standouts: [
          {
            ply: 26,
            moveLabel: "14.",
            fenAfter: "r1b2rk1/p1q2pp1/2pb1n1p/n7/8/3N3P/PPP1BPP1/RNBQ1RK1 b - - 2 14",
            san: "O-O",
            judgement: "best",
            caption: "14.O-O was your best move.",
          },
        ],
      };
    case "nothing":
      return {
        ...base,
        ref: FIXTURE_CLEAN_REF,
        header: { eyebrow: "Review · vs Engine 1200 · 1–0", opponentName: "Engine 1200", resultLabel: "1–0" },
        accuracy: 97,
        moments: [],
        found: 0,
        reviewed: 0,
        isClean: true,
        bestDecision: "Your best decision was 16.Qb8+, a sacrifice that forced mate.",
        brilliant: 1,
        standouts: [
          { ply: 26, moveLabel: "14.", fenAfter: "4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 1 14", san: "Rd1", judgement: "great", caption: "The only move that keeps the win." },
          { ply: 30, moveLabel: "16.", fenAfter: "1Q2kb1r/p2n1ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 b k - 1 16", san: "Qb8+", judgement: "brilliant", caption: "A sound sacrifice." },
          { ply: 32, moveLabel: "17.", fenAfter: CLEAN.finalFen, san: "Rd8#", judgement: "best", caption: "Checkmate." },
        ],
        bestThisMonth: true,
      };
  }
}

// ── The archive (DR/V3GamesArchive.dc.html) ─────────────────────────────────────────────────────────────────────
/** One row per analysis status and opponent kind, newest first. */
export function gameRowFixtures(): GameRowDTO[] {
  const row = (over: Partial<GameRowDTO> & Pick<GameRowDTO, "ref" | "playedAt" | "playedAtLabel">): GameRowDTO => ({
    color: "w",
    result: "loss",
    opponent: { name: "tal_fan_77", rating: 1203, kind: "member" },
    headline: null,
    opening: { eco: "C59", name: "Two Knights Defense: Main Line" },
    positionTitle: null,
    tc: { label: "Rapid 10+0", timeClass: "rapid" },
    ratingDelta: null,
    source: "replay",
    finalFen: GAME.finalFen,
    analysisStatus: "done",
    momentsCount: 0,
    accuracy: null,
    hasComparison: false,
    ...over,
  });
  return [
    row({ ref: "cm3kc1a2b000cslzp0k3d7f9h", playedAt: "2026-11-11T09:12:00.000Z", playedAtLabel: "Today", analysisStatus: "running", opponent: { name: "Engine 1400", rating: 1400, kind: "bot" }, result: "win", tc: { label: "Blitz 5+3", timeClass: "blitz" } }),
    row({ ref: "cm3kc0z9y000aslzpq2w4e6r8", playedAt: "2026-11-10T21:40:00.000Z", playedAtLabel: "Yesterday", analysisStatus: "queued" }),
    row({ ref: FIXTURE_LEGEND_REF, playedAt: "2026-11-10T19:05:00.000Z", playedAtLabel: "Yesterday", color: "w", result: "draw", opponent: { name: "martin_k", rating: 1212, kind: "member" }, headline: "Left Morphy’s path · move 12", opening: null, positionTitle: "Opera Game, Paris 1858", momentsCount: 1, accuracy: 91, hasComparison: true, finalFen: "r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R w KQk - 13 18" }),
    row({ ref: FIXTURE_GAME_REF, playedAt: FIXTURE_PLAYED_AT, playedAtLabel: "Nov 9", headline: "Missed Rxf5 · move 19", momentsCount: 3, accuracy: 85 }),
    row({ ref: FIXTURE_CLEAN_REF, playedAt: "2026-11-08T16:20:00.000Z", playedAtLabel: "Nov 8", result: "win", opponent: { name: "Engine 1200", rating: 1200, kind: "bot" }, headline: "Clean game", opening: { eco: "C41", name: "Philidor Defense" }, tc: { label: "Untimed", timeClass: "untimed" }, finalFen: CLEAN.finalFen, accuracy: 97 }),
    row({ ref: "cm3kbz8x70008slzp5t7y9u1i", playedAt: "2026-11-07T12:00:00.000Z", playedAtLabel: "Nov 7", analysisStatus: "failed", color: "b", result: "win" }),
    row({ ref: "cm3kbz1q20006slzpm4n6b8v0", playedAt: "2026-11-06T12:00:00.000Z", playedAtLabel: "Nov 6", analysisStatus: "none", tc: { label: "Classical 30+0", timeClass: "classical" } }),
    row({ ref: "cm3kbyv5k0004slzpz1x3c5v7", playedAt: "2026-11-05T12:00:00.000Z", playedAtLabel: "Nov 5", analysisStatus: "skipped", result: "draw", headline: null, finalFen: INITIAL_FEN }),
  ];
}

export function gamesPageMetaFixture(page: "first" | "later" | "last" = "first"): GamesPageMeta {
  if (page === "later") return { nextCursor: "WzEsIjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsIjQyIl0" };
  if (page === "last") return { nextCursor: null };
  return { nextCursor: "WzEsIjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsIjQyIl0", filteredTotal: 37, counts: { all: 37 } };
}

// ── Practice (DR/V3Practice.dc.html) ────────────────────────────────────────────────────────────────────────────
export function practiceContextFixture(source: PracticeContextDTO["source"] = "game"): PracticeContextDTO {
  switch (source) {
    case "game":
      return {
        source,
        fen: OPERA.divergenceFen,
        sideToMove: "w",
        humanColor: "w",
        title: "Find Morphy’s 12.O-O-O",
        fromLabel: "Practice · from move 12",
        botElo: 1400,
        backHref: `/review/${FIXTURE_LEGEND_REF}/legend`,
        compareHref: `/review/${FIXTURE_LEGEND_REF}/legend`,
        planLine: "Castle long and put the rook on the open d-file.",
      };
    case "position":
      return {
        source,
        fen: OPERA.startFen,
        sideToMove: "w",
        humanColor: "w",
        title: "Opera Game, Paris 1858",
        fromLabel: "Practice · from move 10",
        botElo: 1400,
        backHref: "/legends",
        compareHref: null,
        planLine: null,
      };
    case "fen":
      return {
        source,
        fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        sideToMove: "w",
        humanColor: "w",
        title: "Practice from a position",
        fromLabel: null,
        botElo: 1400,
        backHref: "/",
        compareHref: null,
        planLine: null,
      };
  }
}
