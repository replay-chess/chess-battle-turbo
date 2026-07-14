import assert from "node:assert/strict";
import test from "node:test";
import {
  articleBoardOrientation,
  articleMoveRows,
  articlePvToSan,
  formatArticleEngineScore,
  prepareInteractiveDemo,
} from "./InteractiveAnalysisBoard";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("prepares each legal autoplay position", () => {
  const demo = prepareInteractiveDemo(START_FEN, ["e2e4", "e7e5", "g1f3"]);
  assert.equal(demo.positions.length, 4);
  assert.deepEqual(demo.lastMoves.at(-1), { from: "g1", to: "f3" });
  assert.throws(
    () => prepareInteractiveDemo(START_FEN, ["e2e5"]),
    /Invalid move/,
  );
});

test("groups authored plies into numbered White and Black move rows", () => {
  assert.deepEqual(
    articleMoveRows(START_FEN, ["e2e4", "e7e5", "g1f3", "b8c6"]),
    [
      {
        moveNumber: 1,
        white: { san: "e4", plyIndex: 1 },
        black: { san: "e5", plyIndex: 2 },
      },
      {
        moveNumber: 2,
        white: { san: "Nf3", plyIndex: 3 },
        black: { san: "Nc6", plyIndex: 4 },
      },
    ],
  );
});

test("preserves a Black-to-move starting row and FEN move numbers", () => {
  const blackToMove =
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 10";
  assert.deepEqual(articleMoveRows(blackToMove, ["e7e5", "g1f3", "b8c6"]), [
    {
      moveNumber: 10,
      black: { san: "e5", plyIndex: 1 },
    },
    {
      moveNumber: 11,
      white: { san: "Nf3", plyIndex: 2 },
      black: { san: "Nc6", plyIndex: 3 },
    },
  ]);
});

test("auto orientation puts the side to move at the bottom", () => {
  assert.equal(articleBoardOrientation("auto", START_FEN), "w");
  assert.equal(
    articleBoardOrientation(
      "auto",
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1",
    ),
    "b",
  );
  assert.equal(articleBoardOrientation("black", START_FEN), "b");
});

test("converts engine principal variations to SAN", () => {
  assert.equal(
    articlePvToSan(START_FEN, ["e2e4", "e7e5", "g1f3", "b8c6"]),
    "e4 e5 Nf3 Nc6",
  );
});

test("normalizes engine scores to White perspective", () => {
  const line = {
    depth: 16,
    multipv: 1,
    scoreCp: 55,
    scoreMate: null,
    pv: ["e7e5"],
  };
  assert.equal(formatArticleEngineScore(line, START_FEN), "+0.55");
  assert.equal(
    formatArticleEngineScore(
      line,
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1",
    ),
    "−0.55",
  );
});
