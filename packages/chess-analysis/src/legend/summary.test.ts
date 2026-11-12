// The comparison texts and tables (phase-03 plan §4.6, §4.7, §8.9; §12.1 "the LegendSummaryDTO rows and
// replayHref"): every expected string is written in the fixture files by hand from the moves.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { legendFixture, legendFixtureFacts, LEGEND_FIXTURE_REF, loadLegendFixtures } from "../../fixtures/legend";
import {
  comparisonParagraph,
  legendSummary,
  lineRows,
  matchedLine,
  outcomeLine,
  PARAGRAPH_MAX,
  replayHref,
  summaryLine,
  summaryRows,
  LEGEND_SUMMARY_MAX_ROWS,
} from "./summary";

const MOVE_LABEL = /^[1-9]\d{0,3}(?:\.|…)$/;

describe("legend summary texts", () => {
  for (const f of loadLegendFixtures()) {
    describe(f.name, () => {
      const facts = legendFixtureFacts(f);
      const ctx = { startFen: f.startFen, facts };

      it("summary rows (≤ 6, centred on the split)", () => {
        const rows = summaryRows(ctx);
        assert.ok(rows.length <= LEGEND_SUMMARY_MAX_ROWS);
        assert.deepEqual(rows, f.expected.rows);
        for (const r of rows) assert.match(r.n, MOVE_LABEL);
      });

      it("summary, matched and outcome lines", () => {
        assert.equal(summaryLine(facts), f.expected.summaryLine);
        assert.equal(matchedLine(facts), f.expected.matchedLine);
        assert.equal(outcomeLine(facts, f.userResult), f.expected.outcomeLine);
        assert.ok(summaryLine(facts).length <= 200);
        assert.ok(outcomeLine(facts, f.userResult).length <= 120);
      });

      it("the Explanation paragraph", () => {
        const text = comparisonParagraph(facts, { opponentHistoricalName: f.opponentHistoricalName });
        assert.equal(text, f.expected.paragraph);
        assert.ok(text.length <= PARAGRAPH_MAX);
        if (f.expected.paragraphWithEvals) {
          const withEvals = { ...facts, evalAtDivergence: f.expected.paragraphWithEvals.evalAtDivergence };
          assert.equal(comparisonParagraph(withEvals), f.expected.paragraphWithEvals.text);
        }
      });

      it("the replay link", () => {
        assert.equal(replayHref(LEGEND_FIXTURE_REF, facts), f.expected.replayHref);
        const s = legendSummary(ctx, LEGEND_FIXTURE_REF, f.userResult);
        assert.equal(s.replayHref, f.expected.replayHref);
        assert.equal(s.matched, facts.matchedPlies);
        assert.equal(s.compared, facts.comparedPlies);
        assert.deepEqual(s.rows, f.expected.rows);
      });

      it("every SAN in the tables is legal along its line", () => {
        for (const which of ["yours", "legend"] as const) {
          const line = which === "yours" ? facts.userLineUci : facts.legendLineUci;
          const chess = new Chess(f.startFen);
          const sans = line
            .split(" ")
            .map((u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
          const shown = lineRows(ctx, which).flatMap((r) => [r.w, r.b].filter((x): x is string => x !== null));
          assert.deepEqual(shown, sans);
        }
      });
    });
  }

  it("the Your Moves table marks the split row and blanks after it", () => {
    const f = legendFixture("opera");
    const ctx = { startFen: f.startFen, facts: legendFixtureFacts(f) };
    assert.deepEqual(lineRows(ctx, "yours"), f.expected.yourLineRows);
    for (const r of lineRows(ctx, "legend")) assert.equal(r.mark, "none");
  });

  it("the divergence of the game-over block", () => {
    const f = legendFixture("opera");
    const s = legendSummary({ startFen: f.startFen, facts: legendFixtureFacts(f) }, LEGEND_FIXTURE_REF, "draw");
    assert.deepEqual(s.divergence, { ply: 4, moveLabel: "12.", userSan: "Ba4", legendSan: "O-O-O", by: "user" });
    assert.equal(s.legendName, "Morphy");
    assert.equal(s.legendResult, "white_won");
    assert.equal(s.outcomeLine, "Morphy won this; you drew.");
  });

  it("the legend's result reads from the member's side", () => {
    const facts = legendFixtureFacts(legendFixture("opera"));
    assert.equal(
      outcomeLine({ ...facts, side: "b", historicalName: "Isouard" }, "loss"),
      "Isouard lost this; you lost.",
    );
    assert.equal(outcomeLine({ ...facts, legendResult: "draw" }, "win"), "Morphy drew this; you won.");
  });
});
