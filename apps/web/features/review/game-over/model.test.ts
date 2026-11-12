// The game-over review slots as data (phase-03 plan §4.7, §5.8; P3-D29; V3GameOverLegend / V3Game over_* copy):
// every analysis state → primary, accuracy line, coach line and legend block; the seed never regresses the cache.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { legendSummaryFixture, reviewStatusFixture } from "@repo/contracts/http/fixtures/review";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import { ANALYSIS_MIN_PLIES } from "@repo/contracts/internal/jobs";
import { qk } from "@/lib/api/keys";
import {
  GAME_OVER_COPY,
  GAME_OVER_MIN_PLIES,
  accuracyHeadline,
  gameOverModel,
  gradedPct,
  legendLine,
  moveNumberOf,
  replayLink,
  statusFromSeed,
} from "./model";
import { seedReviewStatus, seedReviewStatusFromComplete } from "./seed";

const status = (patch: { analysis?: Partial<ReviewStatusDTO["analysis"]>; review?: Partial<ReviewStatusDTO["review"]>; comparison?: ReviewStatusDTO["comparison"] }): ReviewStatusDTO => {
  const base = reviewStatusFixture("queued");
  return {
    ...base,
    analysis: { ...base.analysis, ...patch.analysis },
    review: { ...base.review, ...patch.review },
    comparison: patch.comparison === undefined ? base.comparison : patch.comparison,
  };
};

describe("gameOverModel", () => {
  it("queued: disabled Analysing · 0% and the queue line under the bar", () => {
    const m = gameOverModel({ status: status({ analysis: { status: "queued", etaSec: 20, gradedPlies: 0, totalPlies: 40 } }), plies: 40, fresh: true });
    assert.deepEqual(m.primary, { kind: "analysing", pct: 0 });
    assert.deepEqual(m.accuracy, { kind: "analysing", label: "Waiting for the engine · about 20 s", pct: 0 });
    assert.equal(m.coachLine, null);
    assert.equal(GAME_OVER_COPY.analysing(0), "Analysing · 0%");
  });

  // regression: game-over-plies-as-moves (FIX-2, review round 2): the line printed plies ("move 39 of 61"); plan 4.1
  // counts moves, ceil(gradedPlies/2) of ceil(totalPlies/2), as the review screen does.
  it("running: the percentage of graded plies (never 100 before done) and the move line in moves", () => {
    const m = gameOverModel({ status: status({ analysis: { status: "running", gradedPlies: 39, totalPlies: 61 } }), plies: 61, fresh: true });
    assert.deepEqual(m.primary, { kind: "analysing", pct: 63 });
    assert.deepEqual(m.accuracy, { kind: "analysing", label: "Analysing · move 20 of 31", pct: 63 });
    const short = gameOverModel({ status: status({ analysis: { status: "running", gradedPlies: 5, totalPlies: 8 } }), plies: 8, fresh: true });
    assert.deepEqual(short.accuracy, { kind: "analysing", label: "Analysing · move 3 of 4", pct: 62 }, "a 4-move game never shows move 5 of 8");
    assert.equal(GAME_OVER_COPY.analysing(64), "Analysing · 64%");
    assert.equal(gradedPct(61, 61), 99);
    assert.equal(gradedPct(0, 0), 0);
  });

  it("done: See What the Coach Thinks, the final accuracy headline and the coach line (≤ 160 chars)", () => {
    const line = "The game turned on move 19, when Qd2 missed Rxf5.";
    const m = gameOverModel({
      status: status({ analysis: { status: "done" }, review: { ready: true, accuracy: 91, momentsCount: 1, isClean: false, coachLine: line } }),
      plies: 34,
      fresh: false,
    });
    assert.deepEqual(m.primary, { kind: "coach" });
    assert.deepEqual(m.accuracy, { kind: "done", label: "Accuracy 91 · 1 moment to learn from" });
    assert.equal(m.coachLine, line);
    assert.equal(GAME_OVER_COPY.coachCta, "See What the Coach Thinks");
    const long = gameOverModel({ status: status({ analysis: { status: "done" }, review: { coachLine: "x".repeat(200) } }), plies: 34, fresh: false });
    assert.equal(long.coachLine?.length, 160);
  });

  it("the accuracy headline: plural moments, a clean game, no accuracy", () => {
    assert.equal(accuracyHeadline(85, 3, false), "Accuracy 85 · 3 moments to learn from");
    assert.equal(accuracyHeadline(97, 0, true), "Accuracy 97 · Clean game");
    assert.equal(accuracyHeadline(null, 2, false), "2 moments to learn from");
    assert.equal(accuracyHeadline(null, 0, false), "Clean game");
  });

  it("failed: Review paused · retrying (or terminal) and Open Review", () => {
    const retry = gameOverModel({ status: status({ analysis: { status: "failed", retryable: true } }), plies: 40, fresh: true });
    assert.deepEqual(retry.primary, { kind: "open" });
    assert.deepEqual(retry.accuracy, { kind: "paused", label: "Review paused · retrying" });
    const terminal = gameOverModel({ status: status({ analysis: { status: "failed", retryable: false } }), plies: 40, fresh: true });
    assert.deepEqual(terminal.accuracy, { kind: "paused", label: "Review paused" });
  });

  it("skipped: nothing; a short game with no status yet: nothing", () => {
    const skipped = gameOverModel({ status: status({ analysis: { status: "skipped" } }), plies: 4, fresh: true });
    assert.deepEqual([skipped.primary, skipped.accuracy, skipped.coachLine], [null, null, null]);
    const short = gameOverModel({ status: undefined, plies: GAME_OVER_MIN_PLIES - 1, fresh: true });
    assert.deepEqual([short.primary, short.accuracy], [null, null]);
  });

  it("none: a fresh finish reads as analysing 0 %; an old unanalysed game offers Open Review", () => {
    const fresh = gameOverModel({ status: undefined, plies: 30, fresh: true });
    assert.deepEqual(fresh.primary, { kind: "analysing", pct: 0 });
    assert.equal(fresh.status, "none");
    const old = gameOverModel({ status: status({ analysis: { status: "none" } }), plies: 30, fresh: false });
    assert.deepEqual(old.primary, { kind: "open" });
    assert.equal(old.accuracy, null);
  });

  it("the legend block shows whatever the analysis state", () => {
    const c = legendSummaryFixture("diverged");
    for (const s of ["queued", "running", "done", "failed", "skipped"] as const) {
      assert.equal(gameOverModel({ status: status({ analysis: { status: s }, comparison: c }), plies: 30, fresh: true }).legend, c, s);
    }
  });

  it("GAME_OVER_MIN_PLIES equals the contract's ANALYSIS_MIN_PLIES", () => {
    assert.equal(GAME_OVER_MIN_PLIES, ANALYSIS_MIN_PLIES);
  });
});

describe("the over_legend copy", () => {
  it("user left the path: the board's sentence, gender-neutral, with the Replay link from the split move", () => {
    const c = legendSummaryFixture("diverged");
    const line = legendLine(c);
    assert.equal(line.kind, "diverged");
    if (line.kind !== "diverged") return;
    const text = `${line.lead}${line.matched}${line.middle}${line.yours}${line.between}${line.theirs}${line.end}`;
    const d = c.divergence!;
    assert.equal(
      text,
      `You matched ${c.legendName} for ${c.matched} of ${c.compared} moves, then left ${c.legendName}’s path with ` +
        `${d.moveLabel}${d.userSan} (${c.legendName} played ${d.moveLabel}${d.legendSan}).`,
    );
    const replay = replayLink(c)!;
    assert.equal(replay.href, c.replayHref);
    assert.equal(replay.label, `Replay from Move ${moveNumberOf(d.moveLabel)}`);
    assert.equal(replay.ply, d.ply);
    assert.equal(GAME_OVER_COPY.compareWith("Morphy"), "Compare with Morphy");
  });

  it("followed to the end: one line and no Replay link; the opponent left: the original game's move", () => {
    const followed = legendSummaryFixture("followed");
    assert.deepEqual(legendLine(followed), { kind: "followed", text: "You followed Morphy to the end." });
    assert.equal(replayLink(followed), null);
    const opp = legendLine(legendSummaryFixture("opponent_left"));
    assert.equal(opp.kind, "diverged");
    if (opp.kind === "diverged") {
      assert.equal(opp.middle, " moves before the game left Kasparov’s path on ");
      assert.equal(opp.yours, "25…Kb6");
      assert.equal(opp.theirs, "25…Kxd4");
    }
  });

  it("moveNumberOf reads 12. and 25…", () => {
    assert.equal(moveNumberOf("12."), 12);
    assert.equal(moveNumberOf("25…"), 25);
    assert.equal(moveNumberOf("?"), 1);
  });
});

describe("seeding qk.review.status", () => {
  it("a seed fills an empty cache or a `none`; it never overwrites a real state", () => {
    const seeded = statusFromSeed(undefined, { status: "queued", etaSec: 19 }, 40)!;
    assert.equal(seeded.analysis.status, "queued");
    assert.equal(seeded.analysis.etaSec, 19);
    assert.equal(seeded.analysis.totalPlies, 40);
    assert.equal(seeded.comparison, null);
    assert.equal(seeded.bank, null);
    const none = status({ analysis: { status: "none", totalPlies: 40 } });
    assert.equal(statusFromSeed(none, { status: "skipped" }, 4)!.analysis.status, "skipped");
    assert.equal(statusFromSeed(none, { status: "queued" }, 0)!.analysis.totalPlies, 40, "the known total is kept");
    const running = status({ analysis: { status: "running", gradedPlies: 10 } });
    assert.equal(statusFromSeed(running, { status: "queued", etaSec: 30 }, 40), null, "an event or A2 answer came first");
  });

  it("a seed's legend block fills a missing one, even when the state is newer", () => {
    const c = legendSummaryFixture("diverged");
    const running = status({ analysis: { status: "running" }, comparison: null });
    assert.equal(statusFromSeed(running, { status: "queued", comparison: c }, 40)!.comparison, c);
    assert.equal(statusFromSeed(status({ analysis: { status: "running" }, comparison: c }), { status: "queued", comparison: null }, 40), null);
  });

  it("seedReviewStatus / seedReviewStatusFromComplete write the query cache", () => {
    const qc = new QueryClient();
    seedReviewStatus(qc, "cref", { status: "queued", etaSec: 12 }, 30);
    assert.equal(qc.getQueryData<ReviewStatusDTO>(qk.review.status("cref"))?.analysis.status, "queued");
    seedReviewStatusFromComplete(qc, "cbot", { analysis: { status: "queued", etaSec: 20 }, comparison: legendSummaryFixture("diverged") }, 34);
    const bot = qc.getQueryData<ReviewStatusDTO>(qk.review.status("cbot"))!;
    assert.equal(bot.analysis.etaSec, 20);
    assert.equal(bot.analysis.totalPlies, 34, "the game's length from the request, so the card's percentage is right at once");
    assert.equal(bot.comparison?.legendName, "Morphy");
    // A pre-P3 replay (`none`, no block) over an existing state changes nothing.
    seedReviewStatusFromComplete(qc, "cref", { analysis: { status: "none", etaSec: null }, comparison: null }, 30);
    assert.equal(qc.getQueryData<ReviewStatusDTO>(qk.review.status("cref"))?.analysis.status, "queued");
  });
});
