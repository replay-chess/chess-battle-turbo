// The accuracy oracle (phase-03 plan §8.2 R-ACC-05, §12.1, §12.4): 30 Lichess-analysed games. Our game accuracy
// must be within ±1 of Lichess's per player, and our inaccuracy/mistake/blunder judgements must agree with Lichess's
// on ≥ 90 % of the plies either grader flags.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadOracleGames, oracleBest, oracleEvals, oracleReplay } from "../fixtures/oracle";
import { ORACLE_IDS } from "../scripts/fetch-oracle";
import { gameAccuracy } from "./accuracy";
import { classifyGame } from "./classify";
import { J } from "./codec";
import { winSeries } from "./winpct";

const games = loadOracleGames();
const LICHESS_NAME: Partial<Record<number, string>> = {
  [J.INACCURACY]: "Inaccuracy",
  [J.MISTAKE]: "Mistake",
  [J.BLUNDER]: "Blunder",
};

describe("accuracy oracle", () => {
  it("holds the 30 committed games", () => {
    assert.equal(games.length, 30);
    assert.deepEqual(games.map((g) => g.id).sort(), [...ORACLE_IDS].sort());
  });

  it("reproduces Lichess's accuracy within ±1 for every player of every game", () => {
    const misses: string[] = [];
    let compared = 0;
    for (const g of games) {
      const series = winSeries(oracleEvals(g));
      for (const [color, side] of [
        ["w", "white"],
        ["b", "black"],
      ] as const) {
        const ours = gameAccuracy(series, color, "w");
        const theirs = g.players[side].accuracy;
        assert.ok(ours !== null, `${g.id} ${side}: no accuracy`);
        compared++;
        if (Math.abs(ours - theirs) > 1) misses.push(`${g.id} ${side}: ours ${ours.toFixed(2)}, Lichess ${theirs}`);
      }
    }
    assert.equal(compared, 60);
    assert.deepEqual(misses, []);
  });

  it("rounds to Lichess's published integer for every player", () => {
    const off: string[] = [];
    for (const g of games) {
      const series = winSeries(oracleEvals(g));
      for (const [color, side] of [
        ["w", "white"],
        ["b", "black"],
      ] as const) {
        const ours = Math.round(gameAccuracy(series, color, "w") ?? -1);
        if (ours !== g.players[side].accuracy) off.push(`${g.id} ${side}: ${ours} vs ${g.players[side].accuracy}`);
      }
    }
    assert.deepEqual(off, []);
  });

  it("agrees with Lichess's inaccuracy/mistake/blunder judgements on ≥ 90 % of flagged plies", () => {
    let union = 0;
    let agree = 0;
    for (const g of games) {
      const replay = oracleReplay(g);
      const grades = classifyGame({ replay, evals: oracleEvals(g), best: oracleBest(g, replay) });
      for (const grade of grades) {
        // MISS is ours only; Lichess would show the underlying mistake or blunder.
        const ours = LICHESS_NAME[grade.base] ?? null;
        const theirs = g.analysis[grade.ply]?.judgment ?? null;
        if (ours === null && theirs === null) continue;
        union++;
        if (ours === theirs) agree++;
      }
    }
    assert.ok(union > 300, `only ${union} flagged plies`);
    const rate = agree / union;
    assert.ok(rate >= 0.9, `agreement ${(rate * 100).toFixed(2)} % (${agree}/${union})`);
  });

  it("never emits INTERESTING", () => {
    for (const g of games) {
      const replay = oracleReplay(g);
      const grades = classifyGame({ replay, evals: oracleEvals(g), best: oracleBest(g, replay) });
      assert.ok(grades.every((x) => x.code !== J.INTERESTING && x.code !== J.UNGRADED));
      assert.equal(grades.length, g.analysis.length);
    }
  });
});
