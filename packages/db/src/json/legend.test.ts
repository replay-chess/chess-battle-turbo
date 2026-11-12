import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildComparisonFacts, parseComparisonFacts, type ComparisonFactsV1 } from "./legend";

/** The Opera Game legend comparison of the V3GameOverLegend board: the user diverged at 12.Ba4. */
function facts(over: Partial<ComparisonFactsV1> = {}): ComparisonFactsV1 {
  return {
    v: 1,
    side: "w",
    historicalName: "Paul Morphy",
    startPly: 16,
    comparedPlies: 14,
    matchedPlies: 6,
    divergencePly: 6,
    divergenceBy: "user",
    userUci: "b5a4",
    userSan: "Ba4",
    legendUci: "c3b5",
    legendSan: "Nxb5",
    legendResult: "white_won",
    legendTotalMoves: 17,
    userLineUci: "c1g5 b7b5 b5a4",
    legendLineUci: "c1g5 b7b5 c3b5",
    evalAtDivergence: null,
    ...over,
  };
}

describe("ComparisonFactsV1", () => {
  it("accepts facts before and after the worker fills evalAtDivergence", () => {
    assert.equal(buildComparisonFacts(facts()).divergencePly, 6);
    const ready = buildComparisonFacts(facts({ evalAtDivergence: { userWin: 61.3, legendWin: 88.9 } }));
    assert.equal(ready.evalAtDivergence?.legendWin, 88.9);
  });

  it("accepts a game that never left the legend's line", () => {
    const same = buildComparisonFacts(
      facts({ divergencePly: null, divergenceBy: null, userUci: null, userSan: null, legendUci: null, legendSan: null }),
    );
    assert.equal(same.divergenceBy, null);
  });

  it("rejects a bad side, a bad UCI, an unknown result and a Win% out of range", () => {
    assert.throws(() => buildComparisonFacts(facts({ side: "x" as "w" })));
    assert.throws(() => buildComparisonFacts(facts({ userUci: "Ba4" })));
    assert.throws(() => buildComparisonFacts(facts({ legendResult: "1-0" as "draw" })));
    assert.throws(() => buildComparisonFacts(facts({ evalAtDivergence: { userWin: 101, legendWin: 0 } })));
  });

  it("parseComparisonFacts is tolerant", () => {
    assert.equal(parseComparisonFacts(null), null);
    assert.equal(parseComparisonFacts({ v: 1 }), null);
    assert.equal(parseComparisonFacts(facts())?.historicalName, "Paul Morphy");
  });
});
