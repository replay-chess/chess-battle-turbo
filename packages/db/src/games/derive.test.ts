import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INITIAL_FEN,
  clampRating,
  clipName,
  sideToMoveAfter,
  startPlyOf,
  studySecondsFor,
  timeClassOf,
} from "./derive";
import { newGameRef } from "./ref";

describe("timeClassOf (plan 8.11, same table as game-core rules/timeClass)", () => {
  it("maps the nine design time controls", () => {
    const tc = (m: number, inc: number) => timeClassOf({ initialSeconds: m * 60, incrementSeconds: inc });
    assert.deepEqual(
      [tc(1, 0), tc(2, 1), tc(3, 0), tc(3, 2), tc(5, 0), tc(5, 3), tc(10, 0), tc(15, 10), tc(30, 0)],
      ["BULLET", "BULLET", "BLITZ", "BLITZ", "BLITZ", "BLITZ", "RAPID", "RAPID", "CLASSICAL"],
    );
  });

  it("band edges 179/180, 479/480, 1499/1500 and untimed", () => {
    const at = (s: number) => timeClassOf({ initialSeconds: s, incrementSeconds: 0 });
    assert.deepEqual([at(179), at(180), at(479), at(480), at(1499), at(1500)], [
      "BULLET",
      "BLITZ",
      "BLITZ",
      "RAPID",
      "RAPID",
      "CLASSICAL",
    ]);
    assert.equal(timeClassOf(null), "UNTIMED");
    assert.equal(timeClassOf({ initialSeconds: 15, incrementSeconds: 0 }), "BULLET");
  });
});

describe("studySecondsFor (owner Q1) and startPlyOf (plan 8.19)", () => {
  it("0 for the initial position (even with other move counters), 30 otherwise", () => {
    assert.equal(studySecondsFor(INITIAL_FEN), 0);
    assert.equal(studySecondsFor("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 7"), 0);
    assert.equal(studySecondsFor("8/1P5k/8/8/8/8/6K1/8 w - - 0 41"), 30);
  });

  it("startPly = 2·(fullmove − 1) + (black to move)", () => {
    assert.equal(startPlyOf(INITIAL_FEN), 0);
    assert.equal(startPlyOf("8/1P5k/8/8/8/8/6K1/8 w - - 0 41"), 80);
    assert.equal(startPlyOf("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 10"), 19);
    assert.equal(startPlyOf("bad fen"), 0);
  });

  it("side to move after n plies", () => {
    assert.equal(sideToMoveAfter(INITIAL_FEN, 0), "w");
    assert.equal(sideToMoveAfter(INITIAL_FEN, 3), "b");
    assert.equal(sideToMoveAfter("8/8/8/8/8/8/8/k6K b - - 0 1", 1), "w");
  });
});

describe("snapshot clipping", () => {
  it("names fit VarChar(40); ratings fit SMALLINT", () => {
    assert.equal(clipName("x".repeat(50))?.length, 40);
    assert.equal(clipName("   "), null);
    assert.equal(clampRating(1234.4), 1234);
    assert.equal(clampRating(null), null);
    assert.equal(clampRating(99999), 32767);
  });
});

describe("newGameRef", () => {
  it("matches the wire Ref shape and is unique", () => {
    const refs = new Set(Array.from({ length: 2000 }, () => newGameRef()));
    assert.equal(refs.size, 2000);
    for (const ref of refs) assert.match(ref, /^c[a-z0-9]{20,31}$/);
  });
});
