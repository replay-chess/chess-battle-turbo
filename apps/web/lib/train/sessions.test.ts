// W2's pure parts (phase-05 plan §7.3 W2 step 2, §8.6): the filter key, the resume index, the daily puzzle limit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterKeyOf, puzzleDailyLimit, resumeIndexOf } from "./sessions.server";

describe("W2 helpers", () => {
  it("the filter key ignores the source and the order of explicit picks, and changes with the day and the spec", () => {
    const a = filterKeyOf({ kind: "bank", source: "hub", cardRefs: ["m_b", "m_a"], practice: false }, "2026-11-12");
    const b = filterKeyOf({ kind: "bank", source: "bank", cardRefs: ["m_a", "m_b"], practice: false }, "2026-11-12");
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, filterKeyOf({ kind: "bank", source: "hub", cardRefs: ["m_a", "m_b"], practice: false }, "2026-11-13"));
    assert.notEqual(a, filterKeyOf({ kind: "bank", source: "hub", cardRefs: ["m_a"], practice: false }, "2026-11-12"));
    assert.notEqual(
      filterKeyOf({ kind: "puzzles", source: "nav", theme: "fork" }, "2026-11-12"),
      filterKeyOf({ kind: "puzzles", source: "nav", theme: "pin" }, "2026-11-12"),
    );
  });

  it("the resume index: the first item neither graded nor skipped", () => {
    const items = [{ itemId: "i1" }, { itemId: "i2", skipped: true }, { itemId: "i3" }, { itemId: "i1b" }];
    assert.equal(resumeIndexOf(items, new Set()), 0);
    assert.equal(resumeIndexOf(items, new Set(["i1"])), 2);
    assert.equal(resumeIndexOf(items, new Set(["i1", "i3", "i1b"])), 4);
  });

  it("TRAIN_PUZZLES_DAILY_LIMIT overrides the 400 default when it is a positive integer", () => {
    assert.equal(puzzleDailyLimit({}), 400);
    assert.equal(puzzleDailyLimit({ TRAIN_PUZZLES_DAILY_LIMIT: "50" }), 50);
    assert.equal(puzzleDailyLimit({ TRAIN_PUZZLES_DAILY_LIMIT: "-3" }), 400);
  });
});
