// extract/extractMistakes.ts (phase-05 plan §8.1, §7.6 J1): the rows of one game from its grading. The design mock
// GAME (P3's fixture, knightowl_88 as White) has its key moments at plies 32, 36 and 40: the three V3BankSession
// positions, so the extraction must give cards for exactly those plies with the design's themes ("Recapture first",
// "Loose piece", "Defended pawn"), the Lichess-shaped record (FEN before the setup move, the setup move, the solution),
// the item keys from the position hash, and new cards due at the member's next 08:00.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { decodeMove, encodeMove, J } from "@repo/chess-analysis/codec";
import { epdHash } from "@repo/chess-analysis/epd";
import { GAME_MOMENTS, mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import type { LineSearchResult } from "@repo/chess-analysis/puzzle/line";
import { replaySan } from "@repo/chess-analysis/replay";
import { primaryOf } from "@repo/chess-analysis/themes/index";
import { dayKey } from "@repo/chess-training/day";
import { mistakeItemKey } from "@repo/chess-training/items";
import { nextRelease } from "@repo/chess-training/release";
import { primaryTheme as displayPrimary } from "@repo/chess-training/themes";
import { EXTRACT_VERSION } from "@repo/contracts/internal/jobs";
import type { GameMember } from "../pipeline/types";
import { acceptOf, buildBankPlan, pgTimestamp, UNKNOWN_OPPONENT, type ExtractInput } from "./extractMistakes";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const gi = mockGradeInput("GAME");
const lines: Record<number, { pv: string[]; accept: string[] }> = {};
for (const m of GAME_MOMENTS) {
  const line = replaySan(m.lineStart, m.line).uci;
  lines[m.ply] = { pv: line, accept: [line[0]!] };
}
const result = gradeAnalysis({
  startFen: INITIAL_FEN,
  startPly: 0,
  moves: gi.replay.uci,
  evals: gi.evals,
  second: gi.second ?? [],
  best: gi.best ?? [],
  lines,
  isBook: gi.isBook,
  members: [{ side: "w", result: "loss" }],
});

const white: GameMember = {
  color: "w",
  userId: "41",
  userRef: "cuserwhite000000000000001",
  result: "LOSS",
  training: {
    timeZone: "America/New_York",
    dayStartHour: 4,
    releaseHour: 8,
    bankDailyCap: 10,
    newPerDay: 5,
    endedAtMs: Date.parse("2026-11-12T18:40:00Z"),
    opponentName: "tal_fan_77",
  },
};

function input(over: Partial<ExtractInput> = {}): ExtractInput {
  return {
    gameId: "900",
    startPly: 0,
    replay: gi.replay,
    evals: gi.evals,
    second: gi.second ?? [],
    best: gi.best ?? [],
    judgements: result.judgements,
    lines: result.lines,
    division: result.division,
    moments: { w: (result.reviews.w?.moments ?? []).map((m) => m.ply) },
    members: [white],
    completedAtMs: Date.parse("2026-11-12T18:40:00Z"),
    timeClass: "BLITZ",
    ecoCode: "C50",
    colorUnknown: false,
    now: NOW,
    ...over,
  };
}

const noEngine = { search: null, reply: null };
const meta = { source: "live" as const, clockMs: () => 0 };

describe("buildBankPlan on the design game", () => {
  it("the review's key moments are plies 32, 36 and 40 (P3)", () => {
    assert.deepEqual(
      (result.reviews.w?.moments ?? []).map((m) => m.ply),
      [32, 36, 40],
    );
  });

  it("cards for exactly the key-moment plies, ≤ 4 mistakes, one occurrence each", async () => {
    const plan = await buildBankPlan(input(), noEngine, meta);
    assert.ok(plan.mistakes.length >= 3 && plan.mistakes.length <= 4, `${plan.mistakes.length} mistakes`);
    assert.equal(plan.occurrences.length, plan.mistakes.length);
    assert.deepEqual(
      plan.cards.map((c) => c.ply),
      [32, 36, 40],
    );
    assert.deepEqual(plan.momentPlies, [32, 36, 40]);
    assert.deepEqual(plan.userIds, ["41"]);
    assert.equal(plan.version, EXTRACT_VERSION);
    for (const o of plan.occurrences) assert.equal(o.moment, [32, 36, 40].includes(o.ply));
  });

  it("records the Lichess shape: FEN before the setup move, the setup move, the best move; themes as designed", async () => {
    const plan = await buildBankPlan(input(), noEngine, meta);
    const expected: Record<number, { theme: string; judgement: string; source: string }> = {
      32: { theme: "rc:recapture", judgement: "INACCURACY", source: "OWN_ERROR" },
      36: { theme: "hangingPiece", judgement: "MISS", source: "MISSED_PUNISH" },
      40: { theme: "rc:defendedTarget", judgement: "BLUNDER", source: "OWN_ERROR" },
    };
    for (const m of GAME_MOMENTS) {
      const row = plan.mistakes.find((x) => x.lastPly === m.ply)!;
      assert.ok(row, `a mistake for ply ${m.ply}`);
      const replay = gi.replay;
      assert.equal(row.fen, replay.fens[m.ply - 1]);
      assert.equal(row.setupUci, replay.uci[m.ply - 1]);
      assert.equal(row.playedUci, replay.uci[m.ply]);
      assert.equal(row.solution, m.uci, "a review position stores the best move alone");
      assert.equal(row.isPuzzle, false, "the mock's second move is as good as the best: never unique");
      assert.equal(row.epdHash, epdHash(replay.fens[m.ply] as string).toString());
      assert.equal(row.primaryTheme, expected[m.ply]!.theme);
      assert.equal(row.judgement, expected[m.ply]!.judgement);
      assert.equal(row.source, expected[m.ply]!.source);
      assert.equal(row.moveNumber, Math.floor(m.ply / 2) + 1);
      assert.equal(row.lastOpponentName, "tal_fan_77");
      assert.equal(row.lastPlayedAt, "2026-11-12 18:40:00.000");
      assert.equal(row.timeClass, "BLITZ");
      assert.equal(row.color, "w");
      assert.ok(row.themes.includes(row.primaryTheme));
      assert.equal(primaryOf(row.themes), row.primaryTheme);
      assert.equal(displayPrimary(row.themes), row.primaryTheme, "the display side ranks the themes the same way");
      assert.ok(row.winBefore > row.winAfterPlayed);
      const card = plan.cards.find((c) => c.ply === m.ply)!;
      assert.equal(card.itemKey, mistakeItemKey(BigInt(row.epdHash)));
      assert.equal(card.kind, "REVIEW_POSITION");
    }
    // The refutation is the stored best move of the position after the played move (the opponent's reply).
    assert.equal(plan.mistakes.find((x) => x.lastPly === 32)!.refuteUci, decodeMove(gi.best?.[33] ?? 0));
  });

  it("new cards are due at the member's next local release; the day is the member's local training day", async () => {
    const plan = await buildBankPlan(input(), noEngine, meta);
    const due = pgTimestamp(nextRelease(NOW, "America/New_York", 8));
    assert.equal(due, "2026-11-13 13:00:00.000", "08:00 New York (EST) the next morning");
    for (const c of plan.cards) assert.equal(c.due, due);
    for (const m of plan.mistakes) assert.equal(m.due, due);
    assert.deepEqual(plan.days, [{ userId: "41", day: dayKey(NOW, "America/New_York", 4) }]);
  });

  it("FIX-2: after a zone change mid-day the bank-due day is the pinned day in progress (as the web counts it)", async () => {
    // The member opened 2026-11-12 in Los Angeles (its row records the zone) and is now in Tokyo: at 2026-11-13 05:00Z
    // Tokyo's natural day is the 13th, but the day in progress (and its used cap) is still LA's 12th.
    const now = new Date("2026-11-13T05:00:00.000Z");
    const moved: GameMember = {
      ...white,
      training: { ...white.training!, timeZone: "Asia/Tokyo", dayAnchor: { day: "2026-11-12", timeZone: "America/Los_Angeles", dayStartHour: 4 } },
    };
    assert.equal(dayKey(now, "Asia/Tokyo", 4), "2026-11-13", "the natural key would move");
    const plan = await buildBankPlan(input({ members: [moved], now }), noEngine, meta);
    assert.deepEqual(plan.days, [{ userId: "41", day: "2026-11-12" }]);
    // Without a recorded zone (no anchor) it is the natural key, as before.
    const plain = await buildBankPlan(input({ members: [{ ...white, training: { ...white.training!, timeZone: "Asia/Tokyo" } }], now }), noEngine, meta);
    assert.deepEqual(plain.days, [{ userId: "41", day: "2026-11-13" }]);
  });

  it("a member without a profile or an opponent name gets the defaults", async () => {
    const bare: GameMember = { color: "w", userId: "41", userRef: white.userRef, result: "LOSS" };
    const plan = await buildBankPlan(input({ members: [bare] }), noEngine, meta);
    assert.equal(plan.cards[0]!.due, pgTimestamp(nextRelease(NOW, "UTC", 8)));
    assert.equal(plan.mistakes[0]!.lastOpponentName, UNKNOWN_OPPONENT);
    assert.equal(plan.members[0]!.cap, 10);
    assert.equal(plan.members[0]!.newPerDay, 5);
  });

  it("a game whose colours are unknown extracts nothing but is marked extracted", async () => {
    const plan = await buildBankPlan(input({ colorUnknown: true }), noEngine, meta);
    assert.deepEqual([plan.mistakes.length, plan.cards.length, plan.occurrences.length], [0, 0, 0]);
    assert.deepEqual(plan.userIds, ["41"]);
  });
});

describe("buildBankPlan: scored puzzles", () => {
  it("a unique winning best move is a puzzle: the line grows through the engine searches", async () => {
    // Make 19.Rxf5 (ply 36) unique and winning: +270 after it, −40 for the second-best move.
    const evals = [...gi.evals];
    const second = [...(gi.second ?? [])];
    evals[36] = 270;
    second[36] = -40;
    const asked: string[] = [];
    const search = async (fen: string): Promise<LineSearchResult> => {
      asked.push(fen);
      return { best: "h1g1", eval: 260, second: 250, pv: ["h1g1"] };
    };
    const plan = await buildBankPlan(input({ evals, second }), { search, reply: async () => null }, meta);
    const row = plan.mistakes.find((x) => x.lastPly === 36)!;
    assert.equal(row.isPuzzle, true);
    assert.ok(row.uniquenessGap !== null && row.uniquenessGap > 0.5);
    // Rxf5 Bh2+ (the stored PV's reply), then one search: Kh1 is not unique (gap ≈ 0) → the line stays Rxf5.
    assert.equal(asked.length, 1);
    assert.equal(row.solution, "f1f5");
    assert.equal(plan.cards.find((c) => c.ply === 36)!.kind, "MISTAKE");
    assert.equal(plan.lineSearches, 1);
  });

  it("a failed line search keeps the first move and reports it", async () => {
    const evals = [...gi.evals];
    const second = [...(gi.second ?? [])];
    evals[36] = 270;
    second[36] = -40;
    const errors: unknown[] = [];
    const plan = await buildBankPlan(
      input({ evals, second }),
      {
        search: async () => {
          throw new Error("engine down");
        },
        reply: null,
        onLineError: (e) => errors.push(e),
      },
      meta,
    );
    assert.equal(plan.mistakes.find((x) => x.lastPly === 36)!.solution, "f1f5");
    assert.equal(errors.length, 1);
  });
});

describe("buildBankPlan: one position twice in one game", () => {
  it("one mistake row and one card, two occurrences", async () => {
    // Knights out and back: the start position comes back before plies 8 and 12.
    const shuffle = ["Nf3", "Nf6", "Ng1", "Ng8"];
    const san = [...shuffle, ...shuffle, ...shuffle, "Nf3", "Nf6"];
    const replay = replaySan(INITIAL_FEN, san);
    const n = replay.uci.length;
    const evals = Array.from({ length: n + 1 }, () => 0);
    const judgements = Array.from({ length: n }, () => J.BEST as number);
    const best = Array.from({ length: n + 1 }, () => 0);
    for (const p of [8, 12]) {
      judgements[p] = J.BLUNDER;
      evals[p + 1] = -700;
      best[p] = encodeMove("e2e4");
    }
    assert.equal(replay.epds[8], replay.epds[12]);
    const plan = await buildBankPlan(
      input({
        replay,
        evals,
        second: evals,
        best,
        judgements,
        lines: {},
        division: { middlegamePly: null, endgamePly: null },
        moments: { w: [8, 12] },
      }),
      noEngine,
      meta,
    );
    assert.equal(plan.mistakes.length, 1);
    assert.equal(plan.mistakes[0]!.lastPly, 12, "the later ply's record");
    assert.deepEqual(
      plan.occurrences.map((o) => o.ply),
      [8, 12],
    );
    assert.equal(plan.cards.length, 1);
  });
});

describe("acceptOf (FIX-1 alt-mate)", () => {
  it("a mating best move accepts every other mate in one, beyond the stored MultiPV alternatives", () => {
    // Four back-rank mates; the analysis kept only two alternatives (MultiPV 3).
    const fen = "6k1/5ppp/8/8/8/8/5PPP/RRRQ2K1 w - - 0 1";
    assert.deepEqual(acceptOf(fen, "a1a8", true, ["b1b8", "c1c8"]).sort(), ["b1b8", "c1c8", "d1d8"]);
  });

  it("a non-mating scored puzzle accepts nothing; a review position keeps its close alternatives", () => {
    assert.deepEqual(acceptOf(INITIAL_FEN, "e2e4", true, ["d2d4"]), []);
    assert.deepEqual(acceptOf(INITIAL_FEN, "e2e4", false, ["d2d4", "g1f3"]), ["d2d4", "g1f3"]);
  });
});
