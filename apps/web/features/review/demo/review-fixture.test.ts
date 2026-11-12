// The /dev/ui/review demo states tell one story each (regression: review-demo-contradictions, FIX-2, review round 2:
// state=skipped said "too short" under a 54-ply game; clean_loss's coach line gave the opponent's accuracy as the
// viewer's; no_moments said "3 moments are worth a second look" and showed Miss 1 / Blunder 1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANALYSIS_MIN_PLIES } from "@repo/contracts/http/plain";
import { J_CHARS } from "@repo/contracts/http/review";
import { reviewDemoFixture } from "./review-fixture";

describe("review demo fixtures", () => {
  it("skipped is a game too short to review", () => {
    const dto = reviewDemoFixture("skipped", false, "w");
    const plies = dto.moves.split(" ").filter(Boolean).length;
    assert.ok(plies < ANALYSIS_MIN_PLIES, `${plies} plies`);
    assert.equal(dto.san.split(" ").length, plies);
    assert.equal(dto.clocks.length, plies);
    assert.equal(dto.status, "skipped");
  });

  it("clean_loss: the accuracy sentence is the viewer's own, and the best decision is the viewer's move", () => {
    const dto = reviewDemoFixture("clean_loss", false, "w");
    const acc = dto.analysis!.accuracy;
    assert.equal(dto.you, "b");
    assert.equal(dto.review!.summary[0]!.t, `You played at ${acc.b} accuracy; your opponent at ${acc.w}.`);
    const best = dto.review!.bestPly!;
    assert.equal(best % 2, 1, "a Black ply");
    assert.ok(dto.review!.bestDecision!.includes(dto.san.split(" ")[best]!));
  });

  it("no_moments: no moments, no mistake, miss or blunder of the viewer, and the summary says so", () => {
    const dto = reviewDemoFixture("no_moments", false, "w");
    const r = dto.review!;
    const a = dto.analysis!;
    assert.equal(r.moments.length, 0);
    assert.equal(r.isClean, false);
    assert.doesNotMatch(r.summary.map((s) => s.t).join(" "), /moments? (are|is) worth/);
    const mine = [...a.j].filter((_, i) => (i % 2 === 0 ? "w" : "b") === dto.you);
    assert.ok(!mine.some((ch) => "MSX".includes(ch)));
    const counts = a.counts[dto.you];
    for (const k of ["M", "S", "X"]) assert.equal(counts[J_CHARS.indexOf(k)], 0, k);
    assert.ok(counts[J_CHARS.indexOf("I")]! > 0, "inaccuracies remain: not a clean game");
    assert.equal(
      counts.reduce((x, y) => x + y, 0),
      mine.length,
      "the counts add up to the viewer's plies",
    );
  });
});
