import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendCompareFixture } from "@repo/contracts/http/fixtures/review";
import { StaticExplanation } from "@repo/contracts/http/legend";
import { explanationBoardAt, narrationLength, segmentAt, wordAt } from "./explanation";

const fixture = () => StaticExplanation.parse(legendCompareFixture({ status: "ready", withExplanation: true }).explanation);

describe("static narration board", () => {
  it("segment at a time and the narration's length", () => {
    const e = fixture();
    assert.equal(segmentAt(e.segments, 0), 0);
    assert.equal(segmentAt(e.segments, 51), 2);
    assert.equal(segmentAt(e.segments, 77.9), 2);
    assert.equal(segmentAt(e.segments, 500), 4);
    assert.equal(narrationLength(e), 130);
  });

  it("applies the earlier segments' cues, then the current segment's reached cues", () => {
    const e = fixture();
    const start = explanationBoardAt(e, { t: 1 });
    assert.equal(start.fen, e.fen);
    assert.deepEqual(start.highlights, { e8: "rgba(235,185,60,0.4)", d7: "rgba(235,185,60,0.4)" });
    assert.deepEqual(start.arrows, []);
    const third = explanationBoardAt(e, { t: 52 });
    assert.deepEqual(third.last, ["e1", "c1"], "12.O-O-O shown in segment 3");
    assert.equal(third.arrows.length, 1);
    assert.notEqual(third.fen, e.fen);
  });

  it("timed cues wait for their trigger time", () => {
    const e = StaticExplanation.parse({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      segments: [
        {
          narration: "One",
          startTime: 0,
          endTime: 10,
          visuals: [
            { type: "showMove", san: "e4", triggerTime: 2 },
            { type: "showMove", san: "e5", triggerTime: 4 },
            { type: "arrow", from: "g1", to: "f3", triggerTime: 6 },
            { type: "annotateSquare", square: "e4", symbol: "!" },
          ],
        },
      ],
    });
    assert.equal(explanationBoardAt(e, { t: 1 }).last, null);
    assert.deepEqual(explanationBoardAt(e, { t: 3 }).last, ["e2", "e4"]);
    assert.deepEqual(explanationBoardAt(e, { t: 5 }).last, ["e7", "e5"]);
    assert.equal(explanationBoardAt(e, { t: 5 }).arrows.length, 0);
    assert.equal(explanationBoardAt(e, { t: 7 }).arrows.length, 1);
    assert.deepEqual(explanationBoardAt(e, { t: 0 }).badges, [{ sq: "e4", kind: "great" }]);
    // manual mode: the whole segment at once
    assert.deepEqual(explanationBoardAt(e, { segment: 0 }).last, ["e7", "e5"]);
  });

  it("resets, undoes and clears; ignores what does not replay", () => {
    const e = StaticExplanation.parse({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      segments: [
        { narration: "a", startTime: 0, endTime: 5, visuals: [{ type: "showMove", san: "d4" }, { type: "showMove", san: "Qh5" }, { type: "highlight", squares: ["d4", "zz"] }] },
        { narration: "b", startTime: 5, endTime: 9, visuals: [{ type: "undoMoves", count: 1 }, { type: "clearVisuals" }, { type: "showEvalBar", score: 35, description: "White is a little better" }] },
        { narration: "c", startTime: 9, endTime: 12, visuals: [{ type: "resetBoard" }, { type: "showMove", san: "g1f3" }] },
      ],
    });
    const a = explanationBoardAt(e, { segment: 0 });
    assert.deepEqual(a.last, ["d2", "d4"], "the illegal Qh5 is skipped");
    assert.deepEqual(a.highlights, { d4: "yellow" });
    const b = explanationBoardAt(e, { segment: 1 });
    assert.equal(b.fen.split(" ")[0], "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
    assert.deepEqual(b.highlights, {});
    assert.deepEqual(b.evalBar, { score: 35, description: "White is a little better" });
    const c = explanationBoardAt(e, { segment: 2 });
    assert.deepEqual(c.last, ["g1", "f3"], "a UCI cue works too");
    assert.equal(c.evalBar, null);
  });

  it("the spoken word from the alignment", () => {
    const a = { words: ["Black", "is", "behind"], startTimes: [0, 0.5, 0.8], endTimes: [0.4, 0.7, 1.2] };
    assert.equal(wordAt(a, 0.1), 0);
    assert.equal(wordAt(a, 0.45), -1);
    assert.equal(wordAt(a, 1), 2);
    assert.equal(wordAt(undefined, 1), -1);
  });
});
