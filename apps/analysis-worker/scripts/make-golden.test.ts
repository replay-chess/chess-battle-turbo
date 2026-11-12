// make-golden.ts (phase-03 plan §12.4): the pure parts — canonical JSON, the ten inputs, the stability comparison and
// the argument parser. The engine runs themselves are the nightly arm64 jobs (`p3-goldens`, `p3-label-stability`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonical, compareStability, goldenInputs, parseArgs, STABILITY, type Golden } from "./make-golden";

function golden(judgements: number[], acc: { w: number; b: number }, moments: { w: number[]; b: number[] }): Golden {
  return {
    v: 1,
    id: "g",
    source: "s",
    profile: "sf18-v1",
    gradingVersion: 1,
    engine: "e",
    startFen: "f",
    moves: [],
    analysis: {
      totalPlies: judgements.length,
      gradedPlies: judgements.length,
      evals: [],
      second: [],
      best: [],
      judgements,
      lines: null,
      depthP50: null,
      accuracy: acc,
      counts: null,
      middlegamePly: null,
      endgamePly: null,
    },
    reviews: { w: { moments: moments.w.map((ply) => ({ ply })) }, b: { moments: moments.b.map((ply) => ({ ply })) } },
  };
}

describe("make-golden", () => {
  it("canonical JSON sorts keys at every level, so key order never makes a diff", () => {
    assert.equal(canonical({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), canonical({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
    assert.notEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }), "array order is data");
  });

  it("takes the first ten oracle games, as UCI from the start, with both colours as members", () => {
    const inputs = goldenInputs();
    assert.equal(inputs.length, 10);
    assert.equal(new Set(inputs.map((i) => i.id)).size, 10);
    for (const i of inputs) {
      assert.ok(i.moves.length > 0 && i.moves.every((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)), i.id);
      assert.deepEqual(i.members.map((m) => m.color), ["w", "b"]);
      const results = i.members.map((m) => m.result).sort();
      assert.ok(JSON.stringify(results) === '["DRAW","DRAW"]' || JSON.stringify(results) === '["LOSS","WIN"]', i.id);
    }
  });

  it("stability passes at ≥ 98 % labels, identical moments and accuracy within ±0.5", () => {
    const base = Array.from({ length: 100 }, (_, i) => i % 7);
    const g = golden(base, { w: 80, b: 75 }, { w: [10, 20], b: [31] });
    const twoOff = base.map((j, i) => (i < 2 ? j + 1 : j));
    assert.equal(compareStability(g, golden(twoOff, { w: 80.4, b: 75 }, { w: [10, 20], b: [31] })).pass, true);
    const threeOff = base.map((j, i) => (i < 3 ? j + 1 : j));
    assert.equal(compareStability(g, golden(threeOff, { w: 80, b: 75 }, { w: [10, 20], b: [31] })).pass, false, "97 % < 98 %");
    assert.equal(compareStability(g, golden(base, { w: 80, b: 75 }, { w: [10, 22], b: [31] })).pass, false, "a moved moment");
    assert.equal(compareStability(g, golden(base, { w: 80.6, b: 75 }, { w: [10, 20], b: [31] })).pass, false, "accuracy Δ 0.6");
    assert.equal(STABILITY.minLabelAgreement, 0.98);
  });

  it("parses the modes and refuses an ambiguous or incomplete command line", () => {
    assert.equal(parseArgs(["--engine", "/sf", "--write"]).mode, "write");
    assert.equal(parseArgs(["--engine", "/sf"]).mode, "check");
    assert.equal(parseArgs(["--engine", "/sf", "--stability", "--games", "3"]).games, 3);
    assert.throws(() => parseArgs(["--write"]), /--engine/);
    assert.throws(() => parseArgs(["--engine", "/sf", "--write", "--check"]), /one of/);
    assert.throws(() => parseArgs(["--engine", "/sf", "--games", "11"]), /--games/);
  });
});
