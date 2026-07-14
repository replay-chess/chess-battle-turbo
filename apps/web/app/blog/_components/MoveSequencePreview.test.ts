import assert from "node:assert/strict";
import test from "node:test";
import {
  nextMoveSequenceFrame,
  prepareMoveSequencePreview,
} from "./MoveSequencePreview";

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("prepares the exact pre-move frame and every legal replay frame", () => {
  const preview = prepareMoveSequencePreview(START_FEN, [
    "e2e4",
    "e7e5",
    "g1f3",
  ]);

  assert.equal(preview.positions.length, 4);
  assert.equal(preview.positions[0], START_FEN);
  assert.deepEqual(preview.lastMoves, [
    null,
    { from: "e2", to: "e4" },
    { from: "e7", to: "e5" },
    { from: "g1", to: "f3" },
  ]);
  assert.match(preview.positions.at(-1)!, / b KQkq - 1 2$/);
});

test("rejects malformed and illegal article sequences", () => {
  assert.throws(
    () => prepareMoveSequencePreview(START_FEN, ["e2-e4"]),
    /Invalid UCI move/,
  );
  assert.throws(
    () => prepareMoveSequencePreview(START_FEN, ["e2e5"]),
    /Invalid move/,
  );
});

test("loops from the final replay frame to the initial position", () => {
  assert.equal(nextMoveSequenceFrame(0, 4), 1);
  assert.equal(nextMoveSequenceFrame(2, 4), 3);
  assert.equal(nextMoveSequenceFrame(3, 4), 0);
  assert.equal(nextMoveSequenceFrame(0, 1), 0);
});

test("a single-move replay stops on its resulting position", () => {
  assert.equal(nextMoveSequenceFrame(0, 2, false), 1);
  assert.equal(nextMoveSequenceFrame(1, 2, false), 1);
});
