import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewPath as ctReviewPath } from "@repo/contracts/http/review";
import { gameOverReviewPath, gamePath, reviewCompletePath, reviewPath, reviewSharePath } from "./paths";

test("the review's paths: the contract's reviewPath, and its nested pages", () => {
  const ref = "cm3k9x2p10007slzpqa8hd4fe";
  assert.equal(reviewPath, ctReviewPath, "one builder, no copy");
  assert.equal(reviewPath(ref, { tab: "coach", ply: 0, moment: 1 }), `/review/${ref}?tab=coach&ply=0&m=1`);
  assert.equal(reviewCompletePath(ref), `/review/${ref}/complete`);
  assert.equal(reviewSharePath(ref), `/review/${ref}/share`);
  assert.equal(gamePath(ref), `/game/${ref}`);
});

test("regression: review-opened-source: the game-over CTA names its source (?from=game_over), not the referrer", () => {
  const href = gameOverReviewPath("cm3k9x2p10007slzpqa8hd4fe");
  assert.equal(new URL(href, "http://x").pathname, "/review/cm3k9x2p10007slzpqa8hd4fe");
  assert.equal(new URL(href, "http://x").searchParams.get("from"), "game_over");
});
