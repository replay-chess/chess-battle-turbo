// Trend (phase-06 plan §8.18 as corrected by FIX-2, D-P6-FIX2-3; §12.1): a direction needs recent ≥ 1.25 × prior
// (worse) or ≤ prior / 1.25 (better) AND the two-sided test of "same rate" at 5 % (events capped at 2 a game, the
// dispersion φ; 1.7 without a baseline); ≥ 300 moves in each window (≥ 60 under a minute for time pressure), else
// unknown; windows use endedAt relative to a fixed computedAt. The rule on real band sides: trend.real.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { err, gameInput } from "../../test/gen";
import { analysedOf } from "./compute";
import { normalCdf, TREND_DISPERSION_DEFAULT, trendOf, trendP, trendWindows } from "./trend";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const DAY = 86_400_000;

/**
 * `nR` recent games and `nP` prior ones (100 moves each, clock lt1 `lt1` moves), spreading `r` and `p` forks one a game
 * (two where needed) and the time-pressure blunders likewise.
 */
function scenario(r: number, p: number, o: { recentDay?: number; priorDay?: number; moves?: number; lt1?: number; tpR?: number; tpP?: number; nR?: number; nP?: number } = {}) {
  const moves = o.moves ?? 100;
  const lt1 = o.lt1 ?? 0;
  const nR = o.nR ?? 3;
  const nP = o.nP ?? 3;
  const share = (k: number, n: number, i: number) => Math.floor(k / n) + (i < k % n ? 1 : 0);
  const mk = (id: string, day: number, forks: number, tp: number) =>
    gameInput({
      gameId: id,
      color: "w",
      endedAt: new Date(NOW.getTime() - day * DAY),
      phaseMoves: [moves - 50, 50, 0],
      clockMoves: [moves - lt1, 0, 0, lt1],
      errors: [...Array.from({ length: forks }, () => err(["fork"])), ...Array.from({ length: tp }, () => err([], { judgement: 1, clockBucket: 4 }))],
    });
  const games = [
    ...Array.from({ length: nR }, (_, i) => mk(`r${i}`, o.recentDay ?? 5, share(r, nR, i), share(o.tpR ?? 0, nR, i))),
    ...Array.from({ length: nP }, (_, i) => mk(`p${i}`, o.priorDay ?? 45, share(p, nP, i), share(o.tpP ?? 0, nP, i))),
  ];
  return trendWindows(analysedOf(games), NOW);
}

describe("trend", () => {
  it("a direction needs a 1.25× effect AND evidence; the label is symmetric in the ratio", () => {
    // 3 + 3 games of 100 moves: 12 vs 4 forks (capped: 6 vs 4) is not evidence: the plan's rule said "worse".
    assert.equal(trendOf(scenario(12, 4), "fork").trend, "same");
    // 30 + 30 games: 40 vs 10 forks (≤ 2 a game) is.
    assert.deepEqual(trendOf(scenario(40, 10, { nR: 30, nP: 30 }), "fork"), { trend: "worse", recent: 40 / 30, prior: 10 / 30 });
    assert.equal(trendOf(scenario(10, 40, { nR: 30, nP: 30 }), "fork").trend, "better", "symmetric");
    // A 1.2× change is never a direction, however many games (here 1,000 vs 1,200 a side over 600 games each).
    assert.equal(trendOf(scenario(1200, 1000, { nR: 600, nP: 600 }), "fork").trend, "same");
    assert.equal(trendOf(scenario(1000, 1200, { nR: 600, nP: 600 }), "fork").trend, "same");
  });

  it("the test: conditional binomial, two-sided, widened by φ", () => {
    assert.equal(trendP(0, 0, 0.5, 1), 1);
    // 20 of 20 in one half: far beyond chance; with φ = 4 less so but still.
    assert.ok(trendP(20, 20, 0.5, 1) < 1e-4);
    assert.ok(trendP(20, 20, 0.5, 4) > trendP(20, 20, 0.5, 1));
    assert.ok(Math.abs(trendP(10, 20, 0.5, 1) - 1) < 1e-6, "exactly the expectation");
    assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 1e-6);
    assert.ok(Math.abs(normalCdf(-1) - 0.158655) < 1e-6);
    assert.equal(TREND_DISPERSION_DEFAULT, 1.7);
  });

  it("no events in either window is the same; a pattern that appears only now needs enough of them", () => {
    assert.equal(trendOf(scenario(0, 0), "fork").trend, "same");
    assert.equal(trendOf(scenario(2, 0), "fork").trend, "same", "2 events: chance");
    assert.equal(trendOf(scenario(30, 0, { nR: 30, nP: 30 }), "fork").trend, "worse");
  });

  it("< 300 moves in either window → unknown", () => {
    assert.equal(trendOf(scenario(40, 10, { nR: 30, nP: 2 }), "fork").trend, "unknown", "the prior window has 200 moves");
    assert.equal(trendOf(scenario(40, 10, { nR: 30, nP: 30, priorDay: 95 }), "fork").trend, "unknown", "the prior games are older than 90 days");
  });

  it("time pressure needs 60 moves under a minute in both windows", () => {
    assert.equal(trendOf(scenario(0, 0, { lt1: 20, tpR: 1, tpP: 14 }), "rc:timePressure").trend, "better");
    assert.equal(trendOf(scenario(0, 0, { lt1: 19, tpR: 1, tpP: 14 }), "rc:timePressure").trend, "unknown");
  });

  it("windows: recent [t − 30 d, t], prior [t − 90 d, t − 30 d)", () => {
    const w = scenario(1, 1, { recentDay: 30, priorDay: 30.0001, nR: 1, nP: 1 });
    assert.equal(w.recent.n, 1);
    assert.equal(w.prior.n, 1);
    const w2 = scenario(1, 1, { recentDay: -1, priorDay: 90, nR: 1, nP: 1 });
    assert.equal(w2.recent.n, 0, "a game after computedAt is in neither window");
    assert.equal(w2.prior.n, 1);
  });
});
