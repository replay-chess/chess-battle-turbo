// accuracy.ts (phase-03 plan §8.2, §12.1): move accuracy table, windows, harmonic floor, phase slices.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  HARMONIC_FLOOR,
  PHASE_NOT_REACHED,
  gameAccuracy,
  moveAccuracy,
  phaseAccuracy,
  stddev,
  volatilityWeights,
  windowSize,
} from "./accuracy";
import { winPct } from "./winpct";

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

describe("moveAccuracy", () => {
  it("matches the RES §3.3 table for Win% losses 0…80 (±0.01)", () => {
    const table: [number, number][] = [
      [0, 100],
      [1, 96.6],
      [2, 92.4],
      [5, 80.82],
      [10, 64.58],
      [15, 51.52],
      [20, 41.02],
      [30, 25.77],
      [40, 15.91],
      [60, 5.4],
      [80, 1.0],
    ];
    for (const [d, acc] of table) near(moveAccuracy(90, 90 - d), d === 0 ? 100 : acc);
  });

  it("is 100 whenever the position did not get worse, and never below 0", () => {
    assert.equal(moveAccuracy(40, 40), 100);
    assert.equal(moveAccuracy(40, 75), 100);
    assert.equal(moveAccuracy(97.54, 2.46), 0);
  });
});

describe("windows and weights", () => {
  it("uses floor(plies / 10) clamped to [2, 8]", () => {
    assert.equal(windowSize(3), 2);
    assert.equal(windowSize(11), 2);
    assert.equal(windowSize(31), 3);
    assert.equal(windowSize(61), 6);
    assert.equal(windowSize(81), 8);
    assert.equal(windowSize(200), 8);
  });

  it("gives exactly one weight per move, reusing the first window w − 2 times", () => {
    const series = Array.from({ length: 41 }, (_, i) => winPct(((i * 37) % 200) - 100));
    const w = volatilityWeights(series);
    assert.equal(w.length, 40);
    const first = Math.max(0.5, Math.min(12, stddev(series.slice(0, 4))));
    assert.deepEqual(w.slice(0, 3), [first, first, first]); // w = 4: two copies, then the first sliding window
    assert.equal(w[3], Math.max(0.5, Math.min(12, stddev(series.slice(1, 5)))));
  });

  it("uses the population standard deviation", () => {
    assert.equal(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  });
});

describe("gameAccuracy", () => {
  it("is null with fewer than 3 positions", () => {
    assert.equal(gameAccuracy([], "w", "w"), null);
    assert.equal(gameAccuracy([50, 55], "w", "w"), null);
    assert.notEqual(gameAccuracy([50, 55, 52], "w", "w"), null);
    assert.notEqual(gameAccuracy([50, 55, 52], "b", "w"), null);
  });

  it("floors a zero move accuracy at 1 in the harmonic mean ([V] item 2)", () => {
    assert.equal(HARMONIC_FLOOR, 1);
    // White: 50 → 97.54 (100), then 97.54 → 2.46 (0). Both moves weigh 12, so the weighted mean is 50 and the
    // harmonic mean is 2 / (1/100 + 1/1) = 1.980.
    const series = [50, 97.54, 97.54, 2.46, 2.46];
    const acc = gameAccuracy(series, "w", "w");
    assert.ok(acc !== null);
    near(acc, (50 + 2 / (1 / 100 + 1)) / 2, 1e-9);
    // Black never lost anything.
    near(gameAccuracy(series, "b", "w") ?? -1, 100, 1e-9);
  });

  it("starts the move parity at the start position's mover (a Black-to-move FEN start)", () => {
    // Only the moves at even offsets lose ground for White (50 → 40 → 30).
    const series = [50, 40, 40, 30, 30];
    assert.ok((gameAccuracy(series, "w", "w") ?? 100) < 100);
    assert.equal(gameAccuracy(series, "b", "w"), 100);
    // With Black to move first, the even offsets are Black's moves, and they gain.
    assert.equal(gameAccuracy(series, "b", "b"), 100);
    assert.equal(gameAccuracy(series, "w", "b"), 100);
  });
});

describe("phaseAccuracy", () => {
  const series = Array.from({ length: 41 }, (_, i) => winPct(i % 3 === 0 ? 30 : i % 3 === 1 ? -20 : 0));

  it("re-runs gameAccuracy on each phase slice", () => {
    const [o, m, e] = phaseAccuracy(series, "w", "w", { middlegamePly: 10, endgamePly: 30 });
    assert.equal(o, gameAccuracy(series.slice(0, 11), "w", "w"));
    assert.equal(m, gameAccuracy(series.slice(10, 31), "w", "w"));
    assert.equal(e, gameAccuracy(series.slice(30, 41), "w", "w"));
  });

  it("gives -1 to a phase with fewer than 2 own moves or never reached", () => {
    assert.deepEqual(phaseAccuracy(series, "w", "w", { middlegamePly: null, endgamePly: null }).slice(1), [
      PHASE_NOT_REACHED,
      PHASE_NOT_REACHED,
    ]);
    // Middlegame of 2 plies: White moves once in it.
    const [, m] = phaseAccuracy(series, "w", "w", { middlegamePly: 10, endgamePly: 12 });
    assert.equal(m, PHASE_NOT_REACHED);
    // The endgame from ply 39: one White move at most.
    const [, , e] = phaseAccuracy(series, "w", "w", { middlegamePly: 10, endgamePly: 39 });
    assert.equal(e, PHASE_NOT_REACHED);
  });

  it("starts each slice with the right mover", () => {
    const [, m] = phaseAccuracy(series, "b", "w", { middlegamePly: 11, endgamePly: 31 });
    assert.equal(m, gameAccuracy(series.slice(11, 32), "b", "b"));
  });

  it("handles an endgame without a middlegame (a FEN start in an endgame)", () => {
    const [o, m, e] = phaseAccuracy(series, "w", "w", { middlegamePly: null, endgamePly: 0 });
    assert.equal(o, PHASE_NOT_REACHED);
    assert.equal(m, PHASE_NOT_REACHED);
    assert.equal(e, gameAccuracy(series, "w", "w"));
  });
});
