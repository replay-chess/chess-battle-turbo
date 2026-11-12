import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTEMPTS_MAX,
  PLAN_KEYS,
  ReviewContentV1,
  ReviewProgressPatch,
  buildReviewContent,
  emptyReviewProgress,
  mergeReviewProgress,
  parseLines,
  parseReviewContent,
  parseReviewProgress,
  type ReviewContentV1 as Content,
  type ReviewMomentV1,
} from "./review";

const sentence = (t: string) => ({ t, v: false });

function moment(ply: number, over: Partial<ReviewMomentV1> = {}): ReviewMomentV1 {
  return {
    ply,
    judgement: 12,
    playedUci: "d1d2",
    bestUci: "f1f5",
    accept: ["f1f5"],
    pv: "f1f5 g6f5 e4f5",
    winBefore: 58.2,
    winAfter: 21.4,
    intent: "attack",
    ask: "White to move. What is the most forcing idea here?",
    why: [sentence("Rxf5 wins the pinned knight.")],
    plan: {
      attack: "Right instinct. Rxf5 wins the pinned knight.",
      defend: "You were thinking: defend. The engine's idea here was to attack: Rxf5.",
      trade: "You were thinking: trade. The engine's idea here was to attack: Rxf5.",
      improve: "You were thinking: improve. The engine's idea here was to attack: Rxf5.",
      unsure: "The engine's idea here was to attack: Rxf5.",
    },
    mistakeRef: null,
    ...over,
  };
}

function content(over: Partial<Content> = {}): Content {
  return {
    v: 1,
    source: "template",
    summary: [sentence("You were better out of the opening."), sentence("Move 19 turned the game.")],
    coachLine: sentence("Move 19 turned the game: Rxf5 was winning."),
    phaseLine: "Opening 92 · Middlegame 71 · Endgame 64",
    headline: "Missed Rxf5 · move 19",
    isClean: false,
    bestPly: null,
    bestDecision: null,
    moments: [moment(32, { judgement: 9 }), moment(36, { judgement: 11 }), moment(40)],
    ...over,
  };
}

describe("ReviewContentV1", () => {
  it("accepts the GAME mock shape (3 moments at plies 32/36/40)", () => {
    const c = buildReviewContent(content());
    assert.deepEqual(
      c.moments.map((m) => m.ply),
      [32, 36, 40],
    );
    assert.equal(parseReviewContent(c)?.headline, "Missed Rxf5 · move 19");
  });

  it("accepts a clean game with no moments and a best decision", () => {
    const c = buildReviewContent(
      content({ isClean: true, moments: [], headline: "Clean game", bestPly: 30, bestDecision: "16.Qb8+ forced mate." }),
    );
    assert.equal(c.isClean, true);
  });

  it("rejects more than 3 moments, a 0 (ungraded) judgement, a bad UCI and an incomplete chip map", () => {
    assert.throws(() => buildReviewContent(content({ moments: [moment(1), moment(5), moment(9), moment(13)] })));
    assert.throws(() => buildReviewContent(content({ moments: [moment(1, { judgement: 0 })] })));
    assert.throws(() => buildReviewContent(content({ moments: [moment(1, { bestUci: "Rxf5" })] })));
    const partial = moment(1);
    const fourChips = Object.fromEntries(Object.entries(partial.plan).filter(([chip]) => chip !== "unsure"));
    assert.throws(() => buildReviewContent(content({ moments: [{ ...partial, plan: fourChips as ReviewMomentV1["plan"] }] })));
  });

  it("rejects text over the limits", () => {
    assert.throws(() => buildReviewContent(content({ summary: Array.from({ length: 5 }, () => sentence("x")) })));
    assert.throws(() => buildReviewContent(content({ headline: "x".repeat(81) })));
    assert.throws(() => buildReviewContent(content({ coachLine: sentence("x".repeat(401)) })));
  });

  it("parseReviewContent is tolerant", () => {
    assert.equal(parseReviewContent(null), null);
    assert.equal(parseReviewContent({ v: 2 }), null);
    assert.equal(parseReviewContent("x"), null);
    assert.equal(ReviewContentV1.safeParse(content({ source: "llm" })).success, true);
  });

  it("lists the five plan chips in design order", () => {
    assert.deepEqual(PLAN_KEYS, ["attack", "defend", "trade", "improve", "unsure"]);
  });
});

describe("ReviewProgressV1", () => {
  it("a NULL column reads as empty progress; malformed reads as null", () => {
    assert.deepEqual(parseReviewProgress(null), emptyReviewProgress());
    assert.equal(parseReviewProgress({ v: 1, momentIndex: 4, results: {}, attempts: {}, planChips: {}, bankOptOut: [] }), null);
    assert.equal(parseReviewProgress({ v: 1, momentIndex: 0, results: { x: "FOUND" }, attempts: {}, planChips: {}, bankOptOut: [] }), null);
    assert.equal(parseReviewProgress({ v: 1, momentIndex: 0, results: {}, attempts: {}, planChips: {}, bankOptOut: [1, 2, 3, 4] }), null);
  });

  it("the patch accepts ply keys only", () => {
    assert.equal(ReviewProgressPatch.safeParse({ results: { "32": "FOUND" } }).success, true);
    assert.equal(ReviewProgressPatch.safeParse({ results: { "-1": "FOUND" } }).success, false);
    assert.equal(ReviewProgressPatch.safeParse({ planChips: { "32": "panic" } }).success, false);
  });
});

describe("mergeReviewProgress (TS twin of review_progress_merge)", () => {
  it("starts from empty progress", () => {
    const p = mergeReviewProgress(null, { results: { "32": "FOUND" }, attempts: { "32": 1 }, planChips: { "32": "attack" } }, 1);
    assert.deepEqual(p, {
      v: 1,
      momentIndex: 1,
      results: { "32": "FOUND" },
      attempts: { "32": 1 },
      planChips: { "32": "attack" },
      bankOptOut: [],
    });
  });

  it("is monotonic: momentIndex never goes back, a result is never overwritten, attempts keep the max", () => {
    const stored = { ...emptyReviewProgress(), momentIndex: 2, results: { "32": "FOUND_RETRY" as const }, attempts: { "32": 3 } };
    const p = mergeReviewProgress(stored, { results: { "32": "REVEALED", "36": "FOUND" }, attempts: { "32": 2, "36": 1 } }, 1);
    assert.equal(p.momentIndex, 2);
    assert.deepEqual(p.results, { "32": "FOUND_RETRY", "36": "FOUND" });
    assert.deepEqual(p.attempts, { "32": 3, "36": 1 });
  });

  it("clamps momentIndex to 0..3 and attempts to ATTEMPTS_MAX; the latest chip wins; bankOptOut is carried", () => {
    const stored = { ...emptyReviewProgress(), planChips: { "32": "attack" as const }, bankOptOut: [40] };
    const p = mergeReviewProgress(stored, { attempts: { "32": 99 }, planChips: { "32": "defend" } }, 9);
    assert.equal(p.momentIndex, 3);
    assert.equal(p.attempts["32"], ATTEMPTS_MAX);
    assert.equal(p.planChips["32"], "defend");
    assert.deepEqual(p.bankOptOut, [40]);
    assert.equal(mergeReviewProgress(null, {}, null).momentIndex, 0);
    assert.equal(mergeReviewProgress(null, {}, -2).momentIndex, 0);
  });
});

describe("LinesV1", () => {
  it("NULL is {}; flagged plies parse; a bad key or alt reads as null", () => {
    assert.deepEqual(parseLines(null), {});
    assert.deepEqual(parseLines({ "40": { pv: "f1f5 g6f5", alts: ["f1f5"], d: 368 } }), {
      "40": { pv: "f1f5 g6f5", alts: ["f1f5"], d: 368 },
    });
    assert.equal(parseLines({ x: { pv: "", alts: [], d: 0 } }), null);
    assert.equal(parseLines({ "4": { pv: "", alts: ["Nf3"], d: 0 } }), null);
  });
});
