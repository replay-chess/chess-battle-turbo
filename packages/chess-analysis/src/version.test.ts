// version.ts (phase-03 plan §8.13, §8.14).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ENGINE_COLUMN_MAX,
  ENGINE_PROFILE,
  GRADING_CHANGED_AT,
  GRADING_VERSION,
  analysisEngine,
  analysisFreshness,
  profileOf,
} from "./version";

describe("version", () => {
  it("is GRADING_VERSION 1 with profile sf18-v1 at the plan's budget (P3-D9)", () => {
    assert.equal(GRADING_VERSION, 1);
    assert.match(GRADING_CHANGED_AT, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ENGINE_PROFILE.id, "sf18-v1");
    assert.deepEqual(ENGINE_PROFILE.pass1, { nodes: 120_000, multipv: 2 });
    assert.deepEqual(ENGINE_PROFILE.pass2, { nodes: 1_000_000, multipv: 3, maxPositions: 6, maxSeconds: 60 });
    assert.equal(ENGINE_PROFILE.threads, 1);
    assert.equal(ENGINE_PROFILE.hashMb, 64);
    assert.equal(ENGINE_PROFILE.minPlies, 6);
    assert.equal(ENGINE_PROFILE.bookMaxPly, 30);
  });

  it("builds the engine column value and refuses one that does not fit varchar(48)", () => {
    assert.equal(analysisEngine("sf18-armv8dp-1a2b3c4d"), "sf18-armv8dp-1a2b3c4d/sf18-v1");
    assert.throws(() => analysisEngine("x".repeat(ENGINE_COLUMN_MAX)), RangeError);
    assert.throws(() => analysisEngine("bad id"), RangeError);
    assert.equal(profileOf("sf18-armv8dp-1a2b3c4d/sf18-v1"), "sf18-v1");
    assert.equal(profileOf("legacy"), null);
  });

  it("tells a current analysis from a regrade (same profile) and a re-run (another profile)", () => {
    const engine = analysisEngine("sf18-armv8dp-1a2b3c4d");
    assert.equal(analysisFreshness({ version: GRADING_VERSION, engine }), "current");
    assert.equal(analysisFreshness({ version: GRADING_VERSION - 1, engine }), "regrade");
    assert.equal(analysisFreshness({ version: GRADING_VERSION, engine: "sf17-x/sf17-v1" }), "rerun");
    assert.equal(analysisFreshness({ version: GRADING_VERSION, engine: "lichess" }), "rerun");
  });
});
