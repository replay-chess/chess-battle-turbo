import assert from "node:assert/strict";
import { test } from "node:test";
import { gameMenuItems } from "./gameMenu";

// regression: D9 — a spectator's ⋯ button was named "More: Resign, Flip Board, Sound"; its menu has no Resign.
test("the ⋯ button names exactly the items of its menu", () => {
  assert.equal(gameMenuItems("spect", 10).label, "More: Flip Board, Sound");
  assert.equal(gameMenuItems("spect", 10).resign, false);
  assert.equal(gameMenuItems("online", 10).label, "More: Resign, Flip Board, Sound");
  assert.equal(gameMenuItems("abort", 0).label, "More: Abort Game, Flip Board, Sound");
  assert.equal(gameMenuItems("bot", 1).label, "More: Resign, Abort Game, Flip Board, Sound");
  assert.equal(gameMenuItems("bot", 2).label, "More: Resign, Offer Draw, Flip Board, Sound");
  assert.equal(gameMenuItems("over", 40).label, "More: Flip Board, Sound");
});
