import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACC_A, ACC_B, ACC_BONUS, ACC_C, moveAccuracy } from "@repo/chess-analysis/accuracy";
import { BRILLIANT_RULE, EXCELLENT_MAX_LOSS, GREAT_RULE, SEVERITY } from "@repo/chess-analysis/classify";
import { JUDGEMENT_KEYS } from "@repo/chess-analysis/codec";
import { ENGINE_PROFILE, GRADING_CHANGED_AT } from "@repo/chess-analysis/version";
import { WIN_K } from "@repo/chess-analysis/winpct";
import {
  FORMULA,
  HWG_TABS,
  accuracyFormula,
  engineLine,
  failureParagraphs,
  formatDay,
  labelRows,
  tabOfAnchor,
  winFormula,
} from "./content";

describe("how we grade: content from the grader's constants", () => {
  it("lists the 12 labels in JudgementCode order, Interesting marked as not given (P3-D15)", () => {
    const rows = labelRows();
    assert.deepEqual(
      rows.map((r) => r.key),
      [...JUDGEMENT_KEYS],
    );
    assert.equal(rows.length, 12);
    assert.equal(rows.find((r) => r.key === "interesting")!.text, "Not given yet: we need a model of human play to grade it fairly.");
  });

  it("states the severity thresholds the classifier uses", () => {
    const t = Object.fromEntries(labelRows().map((r) => [r.key, r.text]));
    assert.equal(t.inaccuracy, `Loses ${SEVERITY.INACCURACY} to ${SEVERITY.MISTAKE} win% points.`);
    assert.equal(t.mistake, `Loses ${SEVERITY.MISTAKE} to ${SEVERITY.BLUNDER} win% points.`);
    assert.equal(t.blunder, `Loses ${SEVERITY.BLUNDER} or more win% points, or the game.`);
    assert.match(t.excellent!, new RegExp(`at most ${EXCELLENT_MAX_LOSS} win%`));
    assert.match(t.great!, new RegExp(`at least ${GREAT_RULE.MIN_GAP} win%`));
    assert.match(t.brilliant!, new RegExp(`at most ${BRILLIANT_RULE.MAX_LOSS} win%`));
    assert.match(t.brilliant!, new RegExp(`${BRILLIANT_RULE.MAX_CP_BEFORE / 100} pawns`));
    assert.match(t.book!, new RegExp(`first ${ENGINE_PROFILE.bookMaxPly / 2} moves`));
  });

  it("prints the accuracy formula with the published constants and the +1", () => {
    assert.equal(accuracyFormula(), "move accuracy = 103.1668 × e^(−0.04354 × win% loss) − 3.1669 + 1");
    assert.equal(Number(FORMULA.a), Number(ACC_A.toFixed(4)));
    assert.equal(Number(FORMULA.b), Number(ACC_B.toFixed(5)));
    assert.equal(Number(FORMULA.c), Number(ACC_C.toFixed(4)));
    assert.equal(Number(FORMULA.bonus), ACC_BONUS);
    // The printed formula, evaluated, matches the grader within the rounding of the printed constants.
    for (const loss of [0.5, 5, 10, 15, 30]) {
      const printed = Math.min(100, Math.max(0, Number(FORMULA.a) * Math.exp(-Number(FORMULA.b) * loss) - Number(FORMULA.c) + Number(FORMULA.bonus)));
      assert.ok(Math.abs(printed - moveAccuracy(60, 60 - loss)) < 0.01, `loss ${loss}`);
    }
    assert.match(winFormula(), new RegExp(String(WIN_K).replace(".", "\\.")));
  });

  it("the engine line carries the profile's numbers and the change date", () => {
    const line = engineLine();
    assert.match(line, /^Engine: Stockfish 18 on our server, 120,000 positions per move and 1,000,000 for key moments\./);
    assert.ok(line.includes(formatDay(GRADING_CHANGED_AT)));
    assert.equal(formatDay("2026-11-11"), "Nov 11, 2026");
    assert.equal(formatDay("2027-01-02"), "Jan 2, 2027");
  });

  it("maps hash anchors to their tab", () => {
    assert.deepEqual([...HWG_TABS], ["labels", "acc"]);
    for (const k of JUDGEMENT_KEYS) assert.equal(tabOfAnchor(k), "labels");
    assert.equal(tabOfAnchor("failures"), "acc");
    assert.equal(tabOfAnchor("nope"), null);
  });

  it("the failures section names the attempt limit", () => {
    assert.ok(failureParagraphs().some((p) => p.includes("After 4 attempts")));
  });
});
