// W1's pure rules (phase-05 plan §7.3 W1 step 1, §11): the reviewedAt clamp, too-old, and the rating-integrity check.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampReviewedAt, isBadItem, isTooOld, REVIEWED_AT_FUTURE_MS, REVIEWED_AT_PAST_MS } from "./attempts.server";
import { NOW } from "./test-rows";

const DAY = 86_400_000;

describe("W1 rules", () => {
  it("reviewedAt is clamped to [now − 7 d, now + 5 min]", () => {
    assert.equal(clampReviewedAt(new Date(NOW.getTime() - 10 * DAY).toISOString(), NOW).getTime(), NOW.getTime() - REVIEWED_AT_PAST_MS);
    assert.equal(clampReviewedAt(new Date(NOW.getTime() + DAY).toISOString(), NOW).getTime(), NOW.getTime() + REVIEWED_AT_FUTURE_MS);
    assert.equal(clampReviewedAt(new Date(NOW.getTime() - 60_000).toISOString(), NOW).getTime(), NOW.getTime() - 60_000);
  });

  it("too old: flagged stale by the outbox, or older than 14 days by the server's clock", () => {
    assert.equal(isTooOld({ reviewedAt: new Date(NOW.getTime() - DAY).toISOString(), stale: true }, NOW), true);
    assert.equal(isTooOld({ reviewedAt: new Date(NOW.getTime() - 15 * DAY).toISOString() }, NOW), true);
    assert.equal(isTooOld({ reviewedAt: new Date(NOW.getTime() - 10 * DAY).toISOString() }, NOW), false);
  });

  it("a first wrong move that solves the position is a bad item", () => {
    assert.equal(isBadItem({ wrongMovesUci: ["f1f5"] }, ["f1f5"], []), true);
    assert.equal(isBadItem({ wrongMovesUci: ["d1c1"] }, ["f1f5"], ["d1c1"]), true);
    assert.equal(isBadItem({ wrongMovesUci: ["d1d2", "f1f5"] }, ["f1f5"], []), false);
    assert.equal(isBadItem({ wrongMovesUci: [] }, ["f1f5"], []), false);
    // FIX-1 alt-mate: a mate "reported wrong" where the stored move mates is a move that solves the position.
    const mateFen = "6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1";
    assert.equal(isBadItem({ wrongMovesUci: ["b1b8"] }, ["a1a8"], [], mateFen), true);
    assert.equal(isBadItem({ wrongMovesUci: ["a1a7"] }, ["a1a8"], [], mateFen), false);
  });
});
