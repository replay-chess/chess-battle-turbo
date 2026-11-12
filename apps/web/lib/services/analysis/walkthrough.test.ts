// A5's event reduction (phase-03 plan §7.2 A5): dedupe by (type, ply, at), time order per moment, the first terminal
// event wins, attempts counted up to it, the latest chip wins. The SQL merge itself runs in
// test/api/review.contract.int.test.ts (monotonic momentIndex, results never overwritten, attempts summed).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgressEvent } from "@repo/contracts/http/review";
import { completeReviewSql, recordProgressSql, reduceProgressEvents, setMomentBankSql } from "./walkthrough";

const at = (s: number) => new Date(Date.UTC(2026, 10, 11, 12, 0, s)).toISOString();
const attempt = (ply: number, s: number, correct: boolean): ProgressEvent => ({ type: "attempt", ply, at: at(s), uci: "e2e4", correct });

describe("reduceProgressEvents", () => {
  it("first try right → FOUND with no wrong attempts", () => {
    assert.deepEqual(reduceProgressEvents([attempt(32, 1, true)]), {
      outcomes: { "32": { r: "FOUND", w: 0 } },
      attempts: { "32": 1 },
      planChips: {},
    });
  });

  it("wrong then right → FOUND with w = 1 (the SQL turns it into FOUND_RETRY); later attempts are ignored", () => {
    const out = reduceProgressEvents([attempt(32, 1, false), attempt(32, 2, true), attempt(32, 3, false)]);
    assert.deepEqual(out.outcomes, { "32": { r: "FOUND", w: 1 } });
    assert.deepEqual(out.attempts, { "32": 2 });
  });

  it("dedupes repeated deliveries by (type, ply, at) and orders by time, not arrival", () => {
    const out = reduceProgressEvents([attempt(36, 5, true), attempt(36, 2, false), attempt(36, 2, false)]);
    assert.deepEqual(out.outcomes, { "36": { r: "FOUND", w: 1 } });
    assert.deepEqual(out.attempts, { "36": 2 });
  });

  it("revealed before any right answer → REVEALED; the chips keep the latest pick", () => {
    const out = reduceProgressEvents([
      attempt(40, 1, false),
      { type: "plan_picked", ply: 40, at: at(2), chip: "attack" },
      { type: "revealed", ply: 40, at: at(3) },
      { type: "plan_picked", ply: 40, at: at(4), chip: "defend" },
      attempt(40, 5, true),
      { type: "viewed", ply: 32, at: at(6) },
      { type: "show_line", ply: 40, at: at(7) },
    ]);
    assert.deepEqual(out.outcomes, { "40": { r: "REVEALED", w: 1 } });
    assert.deepEqual(out.attempts, { "40": 1 });
    assert.deepEqual(out.planChips, { "40": "defend" });
  });

  it("an empty batch is an empty patch (momentIndex alone still moves forward in SQL)", () => {
    assert.deepEqual(reduceProgressEvents([]), { outcomes: {}, attempts: {}, planChips: {} });
  });
});

describe("walkthrough statements", () => {
  it("every write is one statement on the viewer's own row (the `me` CTE) and sets updatedAt", () => {
    const sqls = [
      recordProgressSql(1n, "cref", 1, reduceProgressEvents([attempt(32, 1, true)])),
      setMomentBankSql(1n, "cref", 32, false),
      setMomentBankSql(1n, "cref", 32, true),
      completeReviewSql(1n, "cref"),
    ];
    for (const sql of sqls) {
      assert.equal(typeof sql.text, "string");
      assert.match(sql.text, /^WITH me AS \(/);
      assert.match(sql.text, /gp\."userId" = \$1/);
      assert.match(sql.text, /"updatedAt" = /);
      assert.equal((sql.text.match(/;/g) ?? []).length, 0, "no statement separators");
    }
    assert.match(sqls[0]!.text, /review_progress_merge\(pr\.progress/);
  });
});
