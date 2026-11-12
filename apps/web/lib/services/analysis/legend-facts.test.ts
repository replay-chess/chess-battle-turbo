// Legend facts on the web (phase-03 plan §8.9, P3-D24): legendFactsFor reproducing the CA legend fixtures from the
// stored columns (position names, PGN, metadata) the way the lazy insert reads them. The name rule itself is tested
// in @repo/chess-analysis (src/legend/facts.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { ComparisonFactsV1 } from "@repo/db/json";
import { insertLegendFactsSql, legendFactsFor } from "./legend-facts";

describe("legendFactsFor", () => {
  for (const name of ["opera", "kt", "opponent-left", "followed", "short-legend"]) {
    it(`reproduces the ${name} fixture`, () => {
      const f = legendFixture(name);
      // A first name in front: the short name rule must give the fixture's historical name back.
      const full = `Test ${f.historicalName}`;
      const facts = legendFactsFor({
        startFen: f.startFen,
        startPly: legendFixtureFacts(f).startPly,
        moves: legendFixtureMoves(f).join(" "),
        member: f.member,
        legendPgn: f.legendPgn,
        legendMeta: f.metadata,
        legendMoveNumber: null,
        whiteLegendName: f.member === "w" ? full : null,
        blackLegendName: f.member === "b" ? full : null,
        whitePlayerName: null,
        blackPlayerName: null,
      });
      assert.ok(facts);
      ComparisonFactsV1.parse(facts);
      assert.deepEqual(facts, legendFixtureFacts(f));
    });
  }

  it("no name on the member's side, no PGN, a PGN that never reaches the start, or no result → null", () => {
    const f = legendFixture("opera");
    const base = {
      startFen: f.startFen,
      startPly: 18,
      moves: legendFixtureMoves(f).join(" "),
      member: f.member,
      legendPgn: f.legendPgn,
      legendMeta: f.metadata,
      legendMoveNumber: null,
      whiteLegendName: null,
      blackLegendName: null,
      whitePlayerName: "Paul Morphy",
      blackPlayerName: null,
    };
    assert.ok(legendFactsFor(base));
    assert.equal(legendFactsFor({ ...base, whitePlayerName: null }), null);
    assert.equal(legendFactsFor({ ...base, legendPgn: null }), null);
    assert.equal(legendFactsFor({ ...base, legendPgn: "1.d4 d5 2.c4 1-0" }), null);
    assert.equal(legendFactsFor({ ...base, legendPgn: f.legendPgn.replace(/\[Result "[^"]*"\]/, "").replace(/1-0\s*$/, "") }), null);
    assert.equal(legendFactsFor({ ...base, moves: "e2e4 zz99" }), null, "moves that do not replay");
  });

  it("the insert is idempotent (ON CONFLICT DO NOTHING) and returns the existing row otherwise", () => {
    const f = legendFixture("opera");
    const sql = insertLegendFactsSql({ gameId: 7n, userId: 3n, chessPositionId: 11n, facts: legendFixtureFacts(f) });
    assert.match(sql.text, /ON CONFLICT \("gameId", "userId"\) DO NOTHING/);
    assert.match(sql.text, /UNION ALL/);
    assert.doesNotMatch(sql.text, /INSERT INTO jobs/);
  });
});
