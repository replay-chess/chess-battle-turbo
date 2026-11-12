import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canTakeBack, endOf, lineLabels, liveDests, playMove, positionAt, resultText, sideAfter, takeBack, type PracticeGame } from "./runner";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const play = (g: PracticeGame, ...moves: string[]) => moves.reduce<PracticeGame>((acc, m) => {
  const next = playMove(acc, m);
  assert.ok(next, `${m} is legal`);
  return next;
}, g);

describe("practice runner", () => {
  it("plays legal moves only", () => {
    const g = play({ startFen: START, moves: [] }, "e2e4", "e7e5");
    assert.deepEqual(g.moves, ["e2e4", "e7e5"]);
    assert.equal(playMove(g, "e4e5"), null);
    assert.equal(playMove(g, "zz"), null);
    assert.equal(liveDests(g).get("g1")?.includes("f3"), true);
  });

  it("positions along the line, with the move that reached them", () => {
    const g = play({ startFen: START, moves: [] }, "e2e4", "e7e5", "d1h5");
    const live = positionAt(g);
    assert.deepEqual(live.last, ["d1", "h5"]);
    assert.equal(live.label, "2.Qh5");
    assert.equal(live.turn, "b");
    const before = positionAt(g, 1);
    assert.deepEqual(before.last, ["e2", "e4"]);
    assert.equal(positionAt(g, 0).label, null);
    assert.deepEqual(lineLabels(g), ["1.e4", "1…e5", "2.Qh5"]);
  });

  it("Take Back removes your move and the engine's reply (one ply while it thinks)", () => {
    const g = play({ startFen: START, moves: [] }, "e2e4", "e7e5", "g1f3", "b8c6");
    assert.deepEqual(takeBack(g, "w").moves, ["e2e4", "e7e5"]);
    const thinking = play(g, "f1c4");
    assert.deepEqual(takeBack(thinking, "w").moves, g.moves);
    assert.equal(canTakeBack({ startFen: START, moves: [] }, "w"), false);
  });

  it("keeps the engine's first move when the engine started", () => {
    const g = play({ startFen: START, moves: [] }, "e2e4", "c7c5");
    // the user is Black: the engine played 1.e4 first
    assert.deepEqual(takeBack(g, "b").moves, ["e2e4"]);
    assert.equal(canTakeBack({ startFen: START, moves: ["e2e4"] }, "b"), false);
    assert.equal(sideAfter(START, 0), "w");
    assert.equal(sideAfter("8/8/8/8/8/8/8/k6K b - - 0 1", 1), "w");
  });

  it("ends the game on the board: mate, stalemate, repetition", () => {
    const mate = play({ startFen: START, moves: [] }, "f2f3", "e7e5", "g2g4", "d8h4");
    const end = endOf(mate);
    assert.deepEqual(end, { method: "checkmate", winner: "b" });
    assert.equal(resultText(end!, "b"), "Checkmate · you won");
    assert.equal(resultText(end!, "w"), "Checkmate · the engine won");
    const rep = play({ startFen: START, moves: [] }, "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8");
    assert.equal(endOf(rep)?.method, "threefold", "one chess.js game per line sees the repetition");
    assert.equal(resultText({ method: "stalemate", winner: null }, "w"), "Stalemate · draw");
    assert.equal(endOf({ startFen: START, moves: [] }), null);
  });
});
