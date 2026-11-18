// The version rule (phase-06 plan §8.16, §12.1): the first READY profile bumps, a new top-1 bumps, a new member of the
// top 3 bumps; reordering within the top 3 does not; INSUFFICIENT and FAILED never bump.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weaknessBumped } from "./version";

const ready = (prevTop: string[] | null, topKeys: string[], hadReady = true) => weaknessBumped({ status: "READY", hadReady, prevTop, topKeys });

describe("weaknessBumped", () => {
  it("bumps on the first READY profile", () => {
    assert.equal(ready(null, ["fork", "hangingPiece", "rc:timePressure"], false), true);
    assert.equal(ready(["fork"], ["fork"], false), true, "a previous INSUFFICIENT row does not count as ready");
  });
  it("bumps when the top pattern changes", () => {
    assert.equal(ready(["fork", "hangingPiece", "pin"], ["hangingPiece", "fork", "pin"]), true);
  });
  it("bumps when a new pattern enters the top 3", () => {
    assert.equal(ready(["fork", "hangingPiece", "pin"], ["fork", "hangingPiece", "skewer"]), true);
    assert.equal(ready(["fork", "hangingPiece"], ["fork", "hangingPiece", "pin"]), true);
  });
  it("does not bump on a reorder below the top, an unchanged top 3 or a shrinking list", () => {
    assert.equal(ready(["fork", "hangingPiece", "pin"], ["fork", "pin", "hangingPiece"]), false);
    assert.equal(ready(["fork", "hangingPiece", "pin"], ["fork", "hangingPiece", "pin"]), false);
    assert.equal(ready(["fork", "hangingPiece", "pin"], ["fork", "hangingPiece"]), false);
  });
  it("never bumps for INSUFFICIENT or FAILED", () => {
    for (const status of ["INSUFFICIENT", "FAILED"] as const) {
      assert.equal(weaknessBumped({ status, hadReady: false, prevTop: null, topKeys: [] }), false);
      assert.equal(weaknessBumped({ status, hadReady: true, prevTop: ["fork"], topKeys: ["pin"] }), false);
    }
  });
});
