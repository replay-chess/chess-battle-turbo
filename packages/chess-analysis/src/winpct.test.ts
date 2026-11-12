// winpct.ts (phase-03 plan §8.2 reference values, RES §3.3).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { NO_SECOND, encodeMate } from "./codec";
import { cpOf, winPct, winSeries, winningChances } from "./winpct";

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

describe("winPct", () => {
  it("matches the RES §3.3 reference table (±0.01)", () => {
    near(winPct(0), 50.0);
    near(winPct(100), 59.1);
    near(winPct(300), 75.11);
    near(winPct(1000), 97.54);
    near(winPct(-1000), 2.46);
    near(winPct(-100), 40.9);
  });

  it("clamps centipawns to ±1000", () => {
    assert.equal(cpOf(1500), 1000);
    assert.equal(cpOf(-9999), -1000);
    assert.equal(winPct(9999), winPct(1000));
    assert.equal(winPct(-2500), winPct(-1000));
  });

  it("counts a mate as ±1000", () => {
    assert.equal(cpOf(29999), 1000);
    assert.equal(cpOf(-29999), -1000);
    assert.equal(cpOf(encodeMate("w", 0)), 1000);
    assert.equal(cpOf(encodeMate("b", 12)), -1000);
    assert.equal(winPct(encodeMate("w", 3)), winPct(1000));
  });

  it("refuses the second-move sentinel", () => {
    assert.throws(() => cpOf(NO_SECOND), RangeError);
  });

  it("is symmetric and bounded", () => {
    for (const cp of [0, 35, 100, 437, 1000]) {
      near(winPct(cp) + winPct(-cp), 100, 1e-9);
      near(winningChances(cp), -winningChances(-cp), 1e-12);
    }
    assert.deepEqual(
      winSeries([0, 100]).map((x) => Math.round(x * 100) / 100),
      [50, 59.1],
    );
  });
});
