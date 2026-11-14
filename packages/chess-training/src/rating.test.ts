// rating.ts: the puzzle-rating seed (clamp 800–2200, D-3), provisional rule and one attempt as a Glicko-2 period
// (phase-05 plan §8.7, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isProvisional, ratePuzzle, seedPuzzleRating } from "./rating";

describe("seedPuzzleRating", () => {
  it("adds 300 to blitz, then rapid, then the onboarding rating, then 1200", () => {
    assert.deepEqual(seedPuzzleRating({ blitz: 1184 }), { r: 1484, rd: 250, vol: 0.06 });
    assert.equal(seedPuzzleRating({ blitz: 1184, rapid: 1600 }).r, 1484);
    assert.equal(seedPuzzleRating({ rapid: 1300 }).r, 1600);
    assert.equal(seedPuzzleRating({ initialRating: 1000, ratingBand: "R2000_PLUS" }).r, 1300);
    assert.equal(seedPuzzleRating({}).r, 1500);
  });

  it("uses the onboarding band midpoint when there is no initial rating", () => {
    assert.equal(seedPuzzleRating({ ratingBand: "R1200_1600" }).r, 1700);
    assert.equal(seedPuzzleRating({ ratingBand: "UNDER_800" }).r, 1000);
  });

  it("clamps to 800–2200", () => {
    assert.equal(seedPuzzleRating({ ratingBand: "NEW_TO_CHESS" }).r, 900);
    assert.equal(seedPuzzleRating({ blitz: 300 }).r, 800);
    assert.equal(seedPuzzleRating({ blitz: 2700 }).r, 2200);
    assert.equal(seedPuzzleRating({ ratingBand: "R2000_PLUS" }).r, 2200);
  });

  it("is provisional below 20 rated puzzles", () => {
    assert.equal(isProvisional(0), true);
    assert.equal(isProvisional(19), true);
    assert.equal(isProvisional(20), false);
  });
});

describe("ratePuzzle", () => {
  const me = { r: 1512, rd: 120, vol: 0.06 };

  it("raises the rating for a clean solve of a harder puzzle and lowers it for a miss of an easier one", () => {
    const win = ratePuzzle(me, 1600, 1);
    assert.ok(win.r > me.r && win.delta > 0);
    const loss = ratePuzzle(me, 1400, 0);
    assert.ok(loss.r < me.r && loss.delta < 0);
  });

  it("moves less for a hint (score 0.5) than for a clean solve", () => {
    const clean = ratePuzzle(me, 1512, 1);
    const hint = ratePuzzle(me, 1512, 0.5);
    assert.ok(Math.abs(hint.r - me.r) < Math.abs(clean.r - me.r));
  });

  it("keeps RD inside the PUZZLE preset's bounds and reports the rounded delta", () => {
    let s = { r: 1500, rd: 350, vol: 0.06 };
    for (let i = 0; i < 200; i++) {
      s = ratePuzzle(s, 1500 + ((i * 37) % 400) - 200, i % 3 === 0 ? 0 : 1);
      assert.ok(s.rd >= 50 && s.rd <= 350, `RD ${s.rd} after ${i + 1} puzzles`);
    }
    assert.ok(s.rd < 100, "RD shrinks with practice");
    assert.equal(ratePuzzle({ r: 1500, rd: 30, vol: 0.001 }, 1500, 1).rd, 50, "never below the floor");
    const one = ratePuzzle(me, 1550, 1);
    assert.equal(one.delta, Math.round(one.r) - Math.round(me.r));
    assert.ok(one.vol <= 0.1);
  });
});
