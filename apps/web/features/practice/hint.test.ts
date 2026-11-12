import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HINT_ARROW_COLOR } from "@repo/game-core/constants";
import { hintKey, nextHintLevel, practiceHint } from "./hint";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("practice hint", () => {
  it("level 1 names the piece and its square; level 2 adds the arrow", () => {
    assert.deepEqual(practiceHint(START, "g1f3", 1), { level: 1, text: "Hint: look at your knight on g1.", arrow: null });
    const two = practiceHint(START, "e2e4", 2)!;
    assert.equal(two.text, "Hint: look at your pawn on e2. The arrow shows where it goes.");
    assert.deepEqual(two.arrow, { from: "e2", to: "e4", color: HINT_ARROW_COLOR });
  });

  it("refuses a move that is not the side to move's piece", () => {
    assert.equal(practiceHint(START, "e7e5", 1), null);
    assert.equal(practiceHint(START, "x", 1), null);
    assert.equal(practiceHint("bad fen", "e2e4", 1), null);
  });

  it("levels: 1, then 2, then nothing; a new position starts over", () => {
    assert.equal(nextHintLevel(null, START), 1);
    assert.equal(nextHintLevel({ key: hintKey(START), level: 1 }, START), 2);
    assert.equal(nextHintLevel({ key: hintKey(START), level: 2 }, START), null);
    const after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    assert.equal(nextHintLevel({ key: hintKey(START), level: 2 }, after), 1);
    assert.equal(hintKey(START), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "move counters do not reset it");
  });
});
