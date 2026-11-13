// The review's status-dependent copy (phase-03 plan §4.1 "States and transitions", "Copy notes").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANALYSIS_STATUSES } from "@repo/contracts/http/review";
import { accuracyLine, accuracyPhase, COPY, ungradedMove, writingLine } from "./copy";

describe("review copy by status", () => {
  // regression: accuracy-placeholder-forever (FIX-2, review round 2). "Accuracy …" showed for every status but done,
  // so a failed, skipped or never-analysed review kept a placeholder that never resolved.
  it("the accuracy line: final when done, a placeholder only while grading, nothing when none will come", () => {
    assert.deepEqual(
      ANALYSIS_STATUSES.map((s) => [s, accuracyLine(85, 89, accuracyPhase(s))]),
      [
        ["none", null],
        ["queued", "Accuracy …"],
        ["running", "Accuracy …"],
        ["done", "Accuracy 85 · opp 89"],
        ["failed", null],
        ["skipped", null],
      ],
    );
    assert.equal(accuracyLine(85, null, "done"), "Accuracy 85");
    assert.equal(accuracyLine(null, 89, "done"), null);
  });

  // regression: skipped-says-not-reached (FIX-2): a skipped game never ran the engine.
  it("an ungraded move: still coming while live, why not when it never will be", () => {
    assert.deepEqual(ungradedMove("running"), { label: "Not graded yet", reason: null });
    assert.deepEqual(ungradedMove("queued"), { label: "Not graded yet", reason: null });
    assert.deepEqual(ungradedMove("skipped"), { label: "Not graded", reason: COPY.skipped });
    assert.deepEqual(ungradedMove("failed"), { label: "Not graded yet", reason: "The engine did not reach this move." });
    assert.doesNotMatch(`${ungradedMove("skipped").label}. ${ungradedMove("skipped").reason}`, /engine/);
  });
});

describe("analysing copy (plan P3-Q5)", () => {
  it("regression: dev pass D3: no 'under 10 seconds' promise while the dev p50 for 40 plies is above 10 s", () => {
    assert.doesNotMatch(COPY.stepThrough, /10 seconds/);
    assert.match(COPY.stepThrough, /usually within half a minute\.$/);
  });
});

describe("writing line (dev pass D3)", () => {
  it("counts pass 2's deep searches once the worker sends them", () => {
    assert.equal(writingLine(null), "Finding your key moments…");
    assert.equal(writingLine({ at: 2, of: 4 }), "Finding your key moments… · 2 of 4");
    assert.equal(writingLine({ at: 0, of: 0 }), "Finding your key moments…");
  });
});
