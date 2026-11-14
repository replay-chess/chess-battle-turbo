// The game-over bank line (phase-05 plan §4.8, T12): copy, move numbers and every hidden case.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewStatusFixture } from "@repo/contracts/http/fixtures/review";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import { bankLineText, bankMoveNumber, bankSlotLine, gameOverMode } from "./bank-line";

test("move numbers follow the review's rule, from any start ply", () => {
  assert.equal(bankMoveNumber(0, 0), 1);
  assert.equal(bankMoveNumber(0, 1), 1);
  assert.equal(bankMoveNumber(0, 24), 13);
  assert.equal(bankMoveNumber(0, 36), 19);
  assert.equal(bankMoveNumber(21, 0), 11, "a game from a position with Black to move at move 11");
});

test("singular and plural lines (T12)", () => {
  assert.equal(bankLineText({ count: 1, plies: [24] }, 0), "+1 position added to your Mistake Bank (move 13).");
  assert.equal(bankLineText({ count: 2, plies: [36, 24] }, 0), "+2 positions added to your Mistake Bank (moves 13, 19).");
  assert.equal(bankLineText({ count: 2, plies: [24, 25] }, 0), "+2 positions added to your Mistake Bank (move 13).", "same move, both colours");
  assert.equal(bankLineText({ count: 1, plies: [] }, 0), "+1 position added to your Mistake Bank.");
});

test("hidden: no bank, nothing added, or the analysis not done", () => {
  assert.equal(bankLineText(null, 0), null);
  assert.equal(bankLineText(undefined, 0), null);
  assert.equal(bankLineText({ count: 0, plies: [] }, 0), null, "a clean game, or every moment opted out");
  const done = reviewStatusFixture("done") as ReviewStatusDTO;
  assert.equal(bankSlotLine({ ...done, bank: { count: 1, plies: [24] } }, 0), "+1 position added to your Mistake Bank (move 13).");
  assert.equal(bankSlotLine({ ...done, bank: null }, 0), null, "train off / not known yet");
  for (const status of ["queued", "running", "failed", "skipped", "none"] as const) {
    const s = { ...done, analysis: { ...done.analysis, status }, bank: { count: 1, plies: [24] } };
    assert.equal(bankSlotLine(s, 0), null, status);
  }
  assert.equal(bankSlotLine(undefined, 0), null);
});

test("the telemetry mode of each game kind", () => {
  assert.equal(gameOverMode("BOT"), "bot");
  assert.equal(gameOverMode("FRIEND"), "friend");
  assert.equal(gameOverMode("TOURNAMENT"), "tournament");
  assert.equal(gameOverMode("ONLINE"), "online");
});
