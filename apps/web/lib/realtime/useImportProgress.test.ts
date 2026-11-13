import assert from "node:assert/strict";
import { it } from "node:test";
import { ETA_SAMPLES, etaSecOf, pushSample } from "./useImportProgress";

const s = (at: number, imported: number, total: number | null = 2_000, runRef = "crunaaaaaaaaaaaaaaaaaaaaaa") => ({ runRef, at, imported, total });

it("ETA from a 3-sample window; null until it moves; a new run starts a new window", () => {
  let w = pushSample([], s(0, 100));
  assert.equal(etaSecOf(w), null);
  w = pushSample(w, s(2_000, 300));
  assert.equal(etaSecOf(w), 17); // 1700 left at 100 games/s
  w = pushSample(w, s(4_000, 500));
  w = pushSample(w, s(6_000, 700));
  assert.equal(w.length, ETA_SAMPLES);
  assert.equal(etaSecOf(w), 13);
  assert.equal(etaSecOf(pushSample(w, s(8_000, 2_000))), 0);
  assert.equal(etaSecOf([s(0, 0, null), s(1_000, 100, null)]), null, "reading without a total");
  assert.equal(etaSecOf([s(0, 50), s(1_000, 50)]), null, "no progress");
  assert.deepEqual(pushSample(w, s(9_000, 10, 2_000, "cotherrrrrrrrrrrrrrrrrrrrr")).length, 1);
});
