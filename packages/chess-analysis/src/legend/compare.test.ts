// compareWithLegend on the legend fixtures (phase-03 plan §12.1 `CA/src/legend/compare.test.ts`, §8.9): Opera
// 12.Ba4 vs 12.O-O-O (2 of 3), Kasparov–Topalov 27.Qc3+ vs 27.b4+ (`user`), the opponent leaving first
// (`opponent`), a game that follows the legend to its end (no divergence), and a legend score shorter than the game;
// the LegendSummaryDTO pieces (rows, outcome line, replay link) are in summary.test.ts.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { legendFixture, legendFixtureFacts, loadLegendFixtures } from "../../fixtures/legend";
import { Chess } from "chess.js";
import { compareWithLegend, followedLegend, followedToTheEnd, HISTORICAL_NAME_MAX, LEGEND_LINE_MAX_PLIES } from "./compare";
import { legendLineFrom } from "./slice";

const factsOf = legendFixtureFacts;

describe("compareWithLegend: the fixtures", () => {
  for (const f of loadLegendFixtures()) {
    it(`${f.name}: exact facts`, () => {
      const facts = factsOf(f);
      const { legendLineUci, ...rest } = facts;
      const expected = f.expected.facts;
      assert.deepEqual(rest, Object.fromEntries(Object.entries(expected).filter(([k]) => k !== "legendLineUci")));
      if (expected.legendLineUci !== undefined) assert.equal(legendLineUci, expected.legendLineUci);
      if (f.expected.legendLinePrefix) assert.ok(legendLineUci.startsWith(f.expected.legendLinePrefix));
      if (f.expected.legendLinePlies) assert.equal(legendLineUci.split(" ").length, f.expected.legendLinePlies);
      assert.equal(followedToTheEnd(facts), f.expected.followedToTheEnd);
    });
  }

  it("Opera: matched 2 of 3, split at 12.Ba4 / 12.O-O-O by the user", () => {
    const facts = factsOf(legendFixture("opera"));
    assert.equal(facts.matchedPlies, 2);
    assert.equal(facts.comparedPlies, 3);
    assert.equal(facts.divergenceBy, "user");
    assert.deepEqual([facts.userSan, facts.legendSan], ["Ba4", "O-O-O"]);
  });

  it("Kasparov–Topalov: 27.Qc3+ against 27.b4+, by the user, after six matching plies", () => {
    const facts = factsOf(legendFixture("kt"));
    assert.equal(facts.divergenceBy, "user");
    assert.equal(facts.divergencePly, 6);
    assert.deepEqual([facts.userSan, facts.legendSan], ["Qc3+", "b4+"]);
    // The six plies before the divergence equal the legend's; three of them are the member's own.
    assert.equal(facts.matchedPlies, 3);
  });

  it("the opponent leaving first stops the comparison there", () => {
    const facts = factsOf(legendFixture("opponent-left"));
    assert.equal(facts.divergenceBy, "opponent");
    assert.equal(facts.matchedPlies, facts.comparedPlies);
    assert.deepEqual([facts.userSan, facts.legendSan], ["Qxe7", "Kb6"]);
  });

  it("following the legend to its end has no divergence and finishes it the legend's way", () => {
    const facts = factsOf(legendFixture("followed"));
    assert.equal(facts.divergencePly, null);
    assert.ok(followedLegend(facts));
    assert.ok(followedToTheEnd(facts));
  });

  it("a legend score shorter than the game: followed as far as it goes, not to the end", () => {
    const facts = factsOf(legendFixture("short-legend"));
    assert.equal(facts.divergencePly, null);
    assert.ok(followedLegend(facts));
    assert.ok(!followedToTheEnd(facts));
    assert.equal(facts.comparedPlies, 2);
  });

  it("a transposition back into the line does not undo the first divergence", () => {
    // From the Opera position: 10.Nxb5 cxb5 11.Bxb5+ Nbd7 then 12.Bd2 (not 12.O-O-O); whatever follows, ply 4 stays
    // the divergence even if the member later reaches a position of the legend's line.
    const f = legendFixture("opera");
    const line = legendLineFrom(f.legendPgn, f.startFen);
    assert.ok(line);
    const facts = compareWithLegend({
      startFen: f.startFen,
      startPly: 18,
      moves: ["c3b5", "c6b5", "c4b5", "b8d7", "g5d2", "a8d8", "d2g5"],
      member: "w",
      legendUci: line.uci,
      historicalName: "Morphy",
      legendResult: "white_won",
      legendTotalMoves: 17,
    });
    assert.equal(facts.divergencePly, 4);
    assert.equal(facts.matchedPlies, 2);
    assert.equal(facts.comparedPlies, 3);
  });

  it("a member playing Black counts Black's plies", () => {
    const f = legendFixture("opera");
    const line = legendLineFrom(f.legendPgn, f.startFen);
    assert.ok(line);
    const facts = compareWithLegend({
      startFen: f.startFen,
      startPly: 18,
      moves: ["c3b5", "c6b5", "c4b5", "e7d7"],
      member: "b",
      legendUci: line.uci,
      historicalName: "Duke Karl / Count Isouard",
      legendResult: "white_won",
      legendTotalMoves: 17,
    });
    assert.equal(facts.side, "b");
    assert.equal(facts.matchedPlies, 1);
    assert.equal(facts.comparedPlies, 2);
    assert.equal(facts.divergencePly, 3);
    assert.equal(facts.divergenceBy, "user");
    assert.equal(facts.userSan, "Qd7");
    assert.equal(facts.legendSan, "Nbd7");
  });

  it("cuts the historical name to the facts' 40 characters and the lines to 120 plies", () => {
    const f = legendFixture("followed");
    const line = legendLineFrom(f.legendPgn, f.startFen);
    assert.ok(line);
    const long = "x".repeat(HISTORICAL_NAME_MAX + 5);
    const facts = compareWithLegend({
      startFen: f.startFen,
      startPly: 18,
      moves: line.uci,
      member: "w",
      legendUci: line.uci,
      historicalName: long,
      legendResult: "white_won",
      legendTotalMoves: 17,
    });
    assert.equal(facts.historicalName.length, HISTORICAL_NAME_MAX);
  });

  // regression: followed-to-the-end-truncated-lines (FIX-2, review round 2). Both stored lines are cut at 120 plies,
  // so a member who stopped before a longer legend's last move compared equal to the legend.
  it("a legend longer than the stored lines: stopping early is not finishing it the legend's way", () => {
    let seed = 5;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let line: string[] = [];
    while (line.length < 130) {
      const c = new Chess();
      line = [];
      for (let i = 0; i < 140 && !c.isGameOver(); i++) {
        const ms = c.moves({ verbose: true });
        const m = ms[Math.floor(rnd() * ms.length)]!;
        c.move(m);
        line.push(`${m.from}${m.to}${m.promotion ?? ""}`);
      }
    }
    line = line.slice(0, 130);
    const start = new Chess().fen();
    const base = { startFen: start, startPly: 0, member: "w" as const, historicalName: "Morphy", legendResult: "white_won" as const, legendTotalMoves: 65 };
    const stopped = compareWithLegend({ ...base, moves: line.slice(0, 124), legendUci: line });
    assert.equal(stopped.divergencePly, null);
    assert.equal(stopped.userLineUci.split(" ").length, LEGEND_LINE_MAX_PLIES);
    assert.ok(followedLegend(stopped));
    assert.ok(!followedToTheEnd(stopped));
    // Under the cap the lines are whole, so an exact finish still counts.
    const short = line.slice(0, LEGEND_LINE_MAX_PLIES - 1);
    assert.ok(followedToTheEnd(compareWithLegend({ ...base, moves: short, legendUci: short })));
    assert.ok(!followedToTheEnd(compareWithLegend({ ...base, moves: short.slice(0, -1), legendUci: short })));
  });

  it("refuses a game whose moves do not replay to the divergence", () => {
    const f = legendFixture("opera");
    assert.throws(() =>
      compareWithLegend({
        startFen: f.startFen,
        startPly: 18,
        moves: ["c3b5", "e2e4", "c4b5"],
        member: "w",
        legendUci: ["c3b5", "c6b5", "c4b5"],
        historicalName: "Morphy",
        legendResult: "white_won",
        legendTotalMoves: 17,
      }),
    );
  });
});
