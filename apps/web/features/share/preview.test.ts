// share/preview.ts: §11.3 masking and the preview card's key moment (phase-03 plan §4.3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAME_MOMENTS, reviewFixture } from "@repo/contracts/http/fixtures/review";
import { ANON_PLAYER, opponentName, resultLabel, shareMomentOf, sharePreviewFromReview, sharerName } from "./preview";

test("names: the sharer by name or anonymous; members as Opponent (rating); bots and external players by name", () => {
  assert.equal(sharerName({ name: "knightowl_88", rating: 1184 }, true), "knightowl_88");
  assert.equal(sharerName({ name: "knightowl_88", rating: 1184 }, false), ANON_PLAYER);
  assert.equal(ANON_PLAYER, "A Replay Chess player");
  assert.equal(opponentName({ name: "tal_fan_77", rating: 1203, kind: "member" }), "Opponent (1203)");
  assert.equal(opponentName({ name: "tal_fan_77", rating: null, kind: "member" }), "Opponent");
  assert.equal(opponentName({ name: "Engine 1200", rating: 1200, kind: "bot" }), "Engine 1200");
  assert.equal(opponentName({ name: "Hikaru", rating: 3200, kind: "external" }), "Hikaru");
  assert.equal(opponentName({ name: "Paul Morphy", rating: null, kind: "legend" }), "Paul Morphy");
});

test("the key moment is the largest Win% loss (19.Qd2, 30 points)", () => {
  assert.equal(shareMomentOf(GAME_MOMENTS)?.ply, 36);
  assert.equal(shareMomentOf([]), null);
  const p = sharePreviewFromReview(reviewFixture("done"), true);
  assert.equal(p.title, "knightowl_88 vs Opponent (1203)");
  assert.equal(p.meta, "Rapid 10+0 · 0–1");
  assert.equal(p.accuracy, 85);
  assert.equal(p.caption, "Key moment: 19.Qd2. Rxf5 wins the bishop on f5.");
  assert.deepEqual(p.board, { ply: 36, lastMove: ["d1", "d2"], arrow: ["f1", "f5"], badge: { sq: "d2", kind: "miss" } });
  assert.equal(p.boardLabel, "Key moment: 19.Qd2, marked Miss. Arrow shows Rxf5.");
  assert.equal(sharePreviewFromReview(reviewFixture("done"), false).title, "A Replay Chess player vs Opponent (1203)");
});

test("a clean game shows its best decision on the board; results read with an en dash", () => {
  const p = sharePreviewFromReview(reviewFixture("clean"), true);
  assert.equal(p.title, "knightowl_88 vs Engine 1200");
  assert.equal(p.caption, "Your best decision: 16.Qb8+, a sacrifice that forced mate.");
  assert.deepEqual(p.board, { ply: 30, lastMove: ["b3", "b8"], arrow: null, badge: { sq: "b8", kind: "brilliant" } });
  assert.deepEqual(["1-0", "0-1", "1/2-1/2", "*"].map((r) => resultLabel(r as "1-0")), ["1–0", "0–1", "½–½", "*"]);
});
