// Every Chess.com `time_class` and Lichess `speed` value → P2's TimeClass (phase-04 plan §8.6, §8.7, §12.1 row 4),
// and the RatingsV1 bucket each one folds into (§6.4).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  CHESSCOM_TIME_CLASSES,
  LICHESS_PERF_TYPES,
  LICHESS_SPEEDS,
  chessComTimeClass,
  lichessTimeClass,
  ratingBucketOf,
} from "../time-class";

describe("time classes", () => {
  it("maps every Chess.com time_class", () => {
    assert.deepEqual(
      CHESSCOM_TIME_CLASSES.map((c) => [c, chessComTimeClass(c)]),
      [
        ["bullet", "BULLET"],
        ["blitz", "BLITZ"],
        ["rapid", "RAPID"],
        ["daily", "DAILY"],
      ],
    );
    assert.equal(chessComTimeClass("classical"), null);
    assert.equal(chessComTimeClass("toString"), null);
  });

  it("maps every Lichess speed (ultraBullet → BULLET, correspondence → DAILY)", () => {
    assert.deepEqual(
      LICHESS_SPEEDS.map((s) => [s, lichessTimeClass(s)]),
      [
        ["ultraBullet", "BULLET"],
        ["bullet", "BULLET"],
        ["blitz", "BLITZ"],
        ["rapid", "RAPID"],
        ["classical", "CLASSICAL"],
        ["correspondence", "DAILY"],
      ],
    );
    assert.equal(lichessTimeClass("chess960"), null);
    assert.equal(lichessTimeClass("constructor"), null);
    assert.equal(LICHESS_PERF_TYPES, "ultraBullet,bullet,blitz,rapid,classical,correspondence");
  });

  it("folds stored classes into rating buckets", () => {
    assert.equal(ratingBucketOf("BULLET"), "bullet");
    assert.equal(ratingBucketOf("CLASSICAL"), "classical");
    assert.equal(ratingBucketOf("DAILY"), "daily");
    assert.equal(ratingBucketOf("UNTIMED"), null);
  });
});
