// Phase-03 plan §7.1 (D1): the Game Review contracts parse every fixture state, refuse the shapes the plan rules
// out, and keep the packed columns (evals, best, j, counts) consistent; the judgement alphabet matches §8.16.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYSE_RESPONSE_FIXTURE,
  CLEAN,
  COMPLETE_OUT_FIXTURE,
  GAME,
  GAME_MOMENTS,
  REVIEW_COMPLETE_FIXTURE_STATES,
  REVIEW_FIXTURE_STATES,
  REVIEW_STATUS_FIXTURE_STATES,
  RETRY_RESPONSE_FIXTURE,
  reviewCompleteFixture,
  reviewFixture,
  reviewStatusFixture,
} from "./fixtures/review";
import {
  AnalyseBody,
  AnalyseResponse,
  annotatedPgnFilename,
  bestTokenCount,
  charOfJudgement,
  CompleteOut,
  J_CHARS,
  JUDGEMENT_CODE_COUNT,
  JUDGEMENT_KEYS,
  judgementOfChar,
  MomentBankBody,
  MomentDTO,
  MomentParams,
  PROGRESS_EVENTS_MAX,
  ProgressBody,
  RetryResponse,
  ReviewAnalysis,
  ReviewCompleteView,
  ReviewDTO,
  reviewPath,
  ReviewStatusDTO,
} from "./review";

const NOW = "2026-11-09T18:50:00.000Z";

describe("judgements and the j alphabet (§8.16)", () => {
  it("has 12 labels in JudgementCode order and one char per code (0 = ungraded)", () => {
    assert.equal(JUDGEMENT_KEYS.length, 12);
    assert.equal(J_CHARS, ".BGbEgkFNIMSX");
    assert.equal(J_CHARS.length, JUDGEMENT_CODE_COUNT);
    assert.equal(new Set(J_CHARS).size, J_CHARS.length);
    assert.deepEqual([...JUDGEMENT_KEYS], [
      "brilliant", "great", "best", "excellent", "good", "book", "forced", "interesting", "inaccuracy", "mistake", "miss", "blunder",
    ]);
  });

  it("maps chars and labels both ways", () => {
    for (const key of JUDGEMENT_KEYS) assert.equal(judgementOfChar(charOfJudgement(key)), key);
    assert.equal(judgementOfChar("."), null);
    assert.equal(judgementOfChar("z"), null);
    assert.equal(judgementOfChar("SS"), null);
    assert.equal(charOfJudgement(null), ".");
    assert.equal(charOfJudgement("miss"), "S");
    assert.equal(charOfJudgement("blunder"), "X");
  });

  it("counts best tokens", () => {
    assert.equal(bestTokenCount(""), 0);
    assert.equal(bestTokenCount("e2e4"), 1);
    assert.equal(bestTokenCount("e2e4 - g1f3"), 3);
  });
});

describe("ReviewDTO (A1)", () => {
  for (const state of REVIEW_FIXTURE_STATES) {
    it(`parses the ${state} fixture`, () => {
      const r = ReviewDTO.safeParse(reviewFixture(state));
      assert.equal(r.success, true, r.success ? "" : r.error.message);
    });
  }

  it("parses a shared review", () => {
    assert.equal(ReviewDTO.safeParse(reviewFixture("done", { shared: true })).success, true);
  });

  it("the fixture columns are consistent with the moves (one SAN, best and j per ply; one eval per position)", () => {
    for (const g of [GAME, CLEAN]) {
      assert.equal(g.moves.split(" ").length, g.plies);
      assert.equal(g.san.split(" ").length, g.plies);
      assert.equal(bestTokenCount(g.best), g.plies);
      assert.equal(g.j.length, g.plies);
      assert.equal(g.evals.length, g.plies + 1);
      // counts[side][code] tally j by side (White moves on even plies from the initial position).
      for (const side of ["w", "b"] as const) {
        const tally = Array(JUDGEMENT_CODE_COUNT).fill(0) as number[];
        [...g.j].forEach((ch, i) => {
          if ((i % 2 === 0 ? "w" : "b") === side) tally[J_CHARS.indexOf(ch)]! += 1;
        });
        assert.deepEqual(tally, [...g.counts[side]], side);
      }
    }
    // The design's moments sit on the judgements the j column says (§8.5: 32 I, 36 S, 40 X).
    for (const m of GAME_MOMENTS) assert.equal(judgementOfChar(GAME.j.charAt(m.ply)), m.judgement, String(m.ply));
    assert.deepEqual(GAME_MOMENTS.map((m) => m.ply), [32, 36, 40]);
    // P3-D15: INTERESTING is never emitted in GRADING_VERSION 1.
    assert.equal(GAME.j.includes("N") || CLEAN.j.includes("N"), false);
  });

  it("a review payload stays near the §9.2 size (~4.6 KB raw at 80 plies)", () => {
    const size = Buffer.byteLength(JSON.stringify(reviewFixture("done")), "utf8");
    // 54 plies with three full moments; 80 plies adds ≈ 26 × 17 B of columns.
    assert.ok(size <= 6_500, `done review is ${size} B`);
  });

  it("refuses more than 3 moments, an opponent's-eye status and unknown statuses", () => {
    const dto = reviewFixture("done");
    const review = dto.review!;
    assert.equal(ReviewDTO.safeParse({ ...dto, review: { ...review, moments: [...review.moments, review.moments[0]] } }).success, false);
    assert.equal(ReviewDTO.safeParse({ ...dto, status: "writing" }).success, false);
    assert.equal(ReviewDTO.safeParse({ ...dto, status: "DONE" }).success, false, "wire enums are lowercase");
  });

  it("refuses inconsistent analysis columns", () => {
    const a = reviewFixture("done").analysis!;
    const bad = (over: Partial<typeof a>) => ReviewAnalysis.safeParse({ ...a, ...over }).success;
    assert.equal(bad({}), true);
    assert.equal(bad({ gradedPlies: a.totalPlies + 1 }), false);
    assert.equal(bad({ j: `${a.j}b` }), false);
    assert.equal(bad({ evals: [...a.evals, 0] }), false);
    assert.equal(bad({ best: `${a.best} e2e4` }), false);
    assert.equal(bad({ j: a.j.replace("k", "K") }), false, "j alphabet");
    assert.equal(bad({ best: a.best.replace("e2e4", "e2e9") }), false, "best tokens are UCI or -");
    assert.equal(bad({ counts: { w: a.counts.w.slice(0, 12), b: a.counts.b } }), false, "13 counts per side");
    assert.equal(bad({ evals: [30_001] }), false, "mate codes stop at ±30000");
  });

  it("moment shapes: legal-looking moves only, all five chips answered, ≤ 8-ply lines", () => {
    const m = GAME_MOMENTS[0]!;
    assert.equal(MomentDTO.safeParse(m).success, true);
    const fourChips: Partial<typeof m.plan> = { ...m.plan };
    delete fourChips.unsure;
    assert.equal(MomentDTO.safeParse({ ...m, plan: fourChips }).success, false);
    assert.equal(MomentDTO.safeParse({ ...m, line: Array(9).fill("e2e4").join(" ") }).success, false);
    assert.equal(MomentDTO.safeParse({ ...m, accept: [] }).success, false);
    assert.equal(MomentDTO.safeParse({ ...m, playedSan: "b3!?" }).success, false);
    assert.equal(MomentDTO.safeParse({ ...m, moveLabel: "17" }).success, false);
    assert.equal(MomentDTO.safeParse({ ...m, moveLabel: "17…" }).success, true);
    assert.equal(MomentDTO.safeParse({ ...m, why: [] }).success, false);
  });
});

describe("ReviewStatusDTO (A2) and the A3/A4/A5/A6/A7 bodies", () => {
  for (const state of REVIEW_STATUS_FIXTURE_STATES) {
    it(`parses the ${state} status fixture`, () => {
      const r = ReviewStatusDTO.safeParse(reviewStatusFixture(state));
      assert.equal(r.success, true, r.success ? "" : r.error.message);
    });
  }

  it("bank stays null in P3", () => {
    assert.equal(ReviewStatusDTO.safeParse({ ...reviewStatusFixture("done"), bank: { added: 1, plies: [32], due: 0 } }).success, false);
  });

  it("A3 defaults the reason to opened and takes regrade", () => {
    assert.deepEqual(AnalyseBody.parse({}), { reason: "opened" });
    assert.deepEqual(AnalyseBody.parse({ reason: "regrade" }), { reason: "regrade" });
    assert.equal(AnalyseBody.safeParse({ reason: "backfill" }).success, false, "clients cannot claim worker reasons");
    assert.equal(AnalyseResponse.safeParse(ANALYSE_RESPONSE_FIXTURE).success, true);
    assert.equal(AnalyseResponse.safeParse({ ...ANALYSE_RESPONSE_FIXTURE, status: "failed" }).success, false);
    assert.equal(RetryResponse.safeParse(RETRY_RESPONSE_FIXTURE).success, true);
  });

  it("A5 caps events at 50, the moment index at 3, and validates each event", () => {
    const event = { type: "attempt", ply: 32, at: NOW, uci: "d1c1", correct: true };
    assert.equal(ProgressBody.safeParse({ momentIndex: 1, events: [event] }).success, true);
    assert.equal(ProgressBody.safeParse({ momentIndex: 1, events: Array(PROGRESS_EVENTS_MAX).fill(event) }).success, true);
    assert.equal(ProgressBody.safeParse({ momentIndex: 1, events: Array(PROGRESS_EVENTS_MAX + 1).fill(event) }).success, false);
    assert.equal(ProgressBody.safeParse({ momentIndex: 4, events: [] }).success, false);
    assert.equal(ProgressBody.safeParse({ momentIndex: 0, events: [{ ...event, uci: "d1c1qq" }] }).success, false);
    assert.equal(ProgressBody.safeParse({ momentIndex: 0, events: [{ ...event, type: "hint" }] }).success, false);
    assert.equal(ProgressBody.safeParse({ momentIndex: 0, events: [{ type: "plan_picked", ply: 32, at: NOW, chip: "attack" }] }).success, true);
    assert.equal(ProgressBody.safeParse({ momentIndex: 0, events: [{ type: "viewed", ply: 32, at: "yesterday" }] }).success, false);
  });

  it("A6 params coerce the ply from the path; the body is a boolean", () => {
    assert.deepEqual(MomentParams.parse({ ref: "cm3k9x2p10007slzpqa8hd4fe", ply: "36" }), { ref: "cm3k9x2p10007slzpqa8hd4fe", ply: 36 });
    assert.equal(MomentParams.safeParse({ ref: "cm3k9x2p10007slzpqa8hd4fe", ply: "-1" }).success, false);
    assert.equal(MomentParams.safeParse({ ref: "42", ply: "1" }).success, false, "refs only, never ids");
    assert.equal(MomentBankBody.safeParse({ inBank: "yes" }).success, false);
  });

  it("A7's out and the Complete page view parse in every state", () => {
    assert.equal(CompleteOut.safeParse(COMPLETE_OUT_FIXTURE).success, true);
    for (const state of REVIEW_COMPLETE_FIXTURE_STATES) {
      const r = ReviewCompleteView.safeParse(reviewCompleteFixture(state));
      assert.equal(r.success, true, `${state}: ${r.success ? "" : r.error.message}`);
    }
    const partial = reviewCompleteFixture("partial");
    assert.equal(partial.partial, true);
    assert.equal(partial.reviewed, 2);
  });
});

describe("paths and file names", () => {
  it("reviewPath keeps ?tab, ?ply and ?m", () => {
    assert.equal(reviewPath("cm3k9x2p10007slzpqa8hd4fe"), "/review/cm3k9x2p10007slzpqa8hd4fe");
    assert.equal(reviewPath("cm3k9x2p10007slzpqa8hd4fe", { moment: 1 }), "/review/cm3k9x2p10007slzpqa8hd4fe?m=1");
    assert.equal(reviewPath("cm3k9x2p10007slzpqa8hd4fe", { tab: "moves", ply: 36 }), "/review/cm3k9x2p10007slzpqa8hd4fe?tab=moves&ply=36");
  });

  it("the annotated PGN file name is slugged and dated in UTC", () => {
    assert.equal(
      annotatedPgnFilename("knightowl_88", "tal_fan_77", new Date("2026-11-09T23:59:00.000Z")),
      "replaychess-knightowl_88-vs-tal_fan_77-2026-11-09.pgn",
    );
    assert.equal(annotatedPgnFilename("José Raúl / Capablanca", "???", new Date(0)), "replaychess-jose-raul-capablanca-vs-player-1970-01-01.pgn");
  });
});
