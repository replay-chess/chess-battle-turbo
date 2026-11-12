// The review's status-dependent copy (phase-03 plan §4.1 "States and transitions", "Copy notes").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANALYSIS_STATUSES } from "@repo/contracts/http/review";
import { accuracyLine, accuracyPhase, COPY, ungradedMove } from "./copy";

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
