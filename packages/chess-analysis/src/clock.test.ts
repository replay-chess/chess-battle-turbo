// clock.ts (phase-06 plan §8.3.1, §12.1): clockBefore for p = 0, 1, 2 and the last ply; untimed and DAILY games are
// unknown; the bucket edges at 59 999 / 60 000 / 119 999 / 120 000 / 299 999 / 300 000.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  CLOCK_BUCKET,
  clockBefore,
  clockBucket,
  clockBucketBefore,
  clockBucketKey,
  hasClocks,
  isTimePressure,
  type ClockGame,
} from "./clock";

// A 3+2 blitz game of six plies: each value is the mover's clock after the ply (increment included).
const BLITZ: ClockGame = {
  moveClocksMs: [181_000, 180_500, 150_000, 119_999, 61_000, 59_999],
  initialTimeSeconds: 180,
  timeClass: "BLITZ",
};

describe("clockBefore", () => {
  it("the first move of each side starts from the initial time", () => {
    assert.equal(clockBefore(BLITZ, 0), 180_000);
    assert.equal(clockBefore(BLITZ, 1), 180_000);
  });

  it("later plies read the same side's clock two plies earlier", () => {
    assert.equal(clockBefore(BLITZ, 2), 181_000);
    assert.equal(clockBefore(BLITZ, 3), 180_500);
    assert.equal(clockBefore(BLITZ, 4), 150_000);
    assert.equal(clockBefore(BLITZ, 5), 119_999);
  });

  it("the ply after the last recorded clock still has a clock; two past it does not", () => {
    // The game had 6 plies (offsets 0…5): offsets 6 and 7 would read moveClocksMs[4], [5]; 8 is missing.
    assert.equal(clockBefore(BLITZ, 6), 61_000);
    assert.equal(clockBefore(BLITZ, 7), 59_999);
    assert.equal(clockBefore(BLITZ, 8), null);
  });

  it("an untimed game, a DAILY or UNTIMED class and bad offsets are unknown", () => {
    assert.equal(clockBefore({ ...BLITZ, moveClocksMs: [] }, 0), null);
    assert.equal(clockBefore({ ...BLITZ, moveClocksMs: [] }, 4), null);
    assert.equal(clockBefore({ ...BLITZ, timeClass: "DAILY" }, 4), null);
    assert.equal(clockBefore({ ...BLITZ, timeClass: "UNTIMED" }, 0), null);
    assert.equal(clockBefore(BLITZ, -1), null);
    assert.equal(clockBefore(BLITZ, 2.5), null);
    assert.equal(hasClocks({ ...BLITZ, timeClass: "DAILY" }), false);
    assert.equal(hasClocks(BLITZ), true);
  });

  it("a missing initial time leaves the first two plies unknown, not zero", () => {
    assert.equal(clockBefore({ ...BLITZ, initialTimeSeconds: 0 }, 0), null);
    assert.equal(clockBefore({ ...BLITZ, initialTimeSeconds: null }, 1), null);
    assert.equal(clockBefore({ ...BLITZ, initialTimeSeconds: null }, 2), 181_000);
  });

  it("a negative or non-numeric stored clock is unknown; zero (a flag fall) is known", () => {
    const g: ClockGame = { moveClocksMs: [100_000, -1, 0, Number.NaN], initialTimeSeconds: 120, timeClass: "BLITZ" };
    assert.equal(clockBefore(g, 3), null);
    assert.equal(clockBefore(g, 4), 0);
    assert.equal(clockBefore(g, 5), null);
  });

  it("a legacy row with no time class still reads its clocks", () => {
    assert.equal(clockBefore({ ...BLITZ, timeClass: null }, 3), 180_500);
  });
});

describe("clockBucket", () => {
  it("cuts at the plan's edges", () => {
    assert.equal(clockBucket(59_999), CLOCK_BUCKET.LT1);
    assert.equal(clockBucket(60_000), CLOCK_BUCKET.ONE_TO_2);
    assert.equal(clockBucket(119_999), CLOCK_BUCKET.ONE_TO_2);
    assert.equal(clockBucket(120_000), CLOCK_BUCKET.TWO_TO_5);
    assert.equal(clockBucket(299_999), CLOCK_BUCKET.TWO_TO_5);
    assert.equal(clockBucket(300_000), CLOCK_BUCKET.GT5);
    assert.equal(clockBucket(0), CLOCK_BUCKET.LT1);
  });

  it("unknown is 0", () => {
    assert.equal(clockBucket(null), CLOCK_BUCKET.UNKNOWN);
    assert.equal(clockBucket(undefined), CLOCK_BUCKET.UNKNOWN);
    assert.equal(clockBucket(-5), CLOCK_BUCKET.UNKNOWN);
    assert.equal(clockBucket(Number.POSITIVE_INFINITY), CLOCK_BUCKET.UNKNOWN);
  });

  it("buckets per ply and the time-pressure rule use the same clock", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((p) => clockBucketBefore(BLITZ, p)),
      [2, 2, 2, 2, 2, 3, 3, 4],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((p) => isTimePressure(BLITZ, p)),
      [false, false, false, false, false, false, false, true],
    );
    assert.equal(isTimePressure({ ...BLITZ, moveClocksMs: [] }, 7), false);
  });

  it("names buckets 1…4 and nothing else", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(clockBucketKey), [null, "gt5", "2to5", "1to2", "lt1", null]);
  });
});
