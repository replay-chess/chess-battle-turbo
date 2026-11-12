// moments.ts: correctness against `accept`, the board of each phase, the best line, the copy and the tallies
// (phase-03 plan §4.1 `moment.*`, §8.5, §8.8), on the design's GAME fixture (moments at plies 32, 36, 40).
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAME_MOMENTS, reviewFixture } from "@repo/contracts/http/fixtures/review";
import { reviewPlies } from "./model";
import {
  destsOf,
  firstOpenMoment,
  foundLine,
  isAnswered,
  isAsking,
  judgeTry,
  lineOf,
  momentBoard,
  momentHeader,
  momentSentences,
  PLAN_CHIPS,
  resumeIndex,
  sanOf,
  tallyResults,
  triedLine,
} from "./moments";

const dto = reviewFixture("done");
const plies = reviewPlies(dto);
const [m1, m2, m3] = GAME_MOMENTS as [(typeof GAME_MOMENTS)[0], (typeof GAME_MOMENTS)[0], (typeof GAME_MOMENTS)[0]];

test("a try is found iff it is in `accept`: first try FOUND, later FOUND_RETRY; best vs an alternative", () => {
  assert.deepEqual(judgeTry(m1, "c3d5", 0), { correct: false, result: null, acceptedAs: null });
  assert.deepEqual(judgeTry(m1, "d1c1", 0), { correct: true, result: "found", acceptedAs: "best" });
  assert.deepEqual(judgeTry(m1, "d1c1", 2), { correct: true, result: "found_retry", acceptedAs: "best" });
  const wide = { accept: ["d1c1", "e3d4"], bestUci: "d1c1" };
  assert.deepEqual(judgeTry(wide, "e3d4", 0), { correct: true, result: "found", acceptedAs: "alt" });
  assert.deepEqual(judgeTry({ accept: ["e7e8q"], bestUci: "e7e8q" }, "e7e8n", 0).correct, false, "the promotion piece counts");
  assert.equal(judgeTry({ accept: ["e7e8q"], bestUci: "e7e8q" }, "E7E8Q", 0).correct, true);
});

test("ask / tried: the position before the move, the previous move, input for the mover, rings on a wrong try", () => {
  const ask = momentBoard({ plies, moment: m1, phase: "ask", tried: null, accepted: null, lineN: -1 });
  assert.equal(ask.fen, plies.fens[32]);
  assert.deepEqual(ask.lastMove, [plies.moves[31]!.from, plies.moves[31]!.to]);
  assert.equal(ask.mover, "w");
  assert.equal(ask.label, "Before move 17 · White to move");
  assert.equal(ask.position, 32);
  assert.deepEqual(ask.rings, {});
  const tried = momentBoard({ plies, moment: m1, phase: "tried", tried: "c3d5", accepted: null, lineN: -1 });
  assert.deepEqual(tried.rings, { c3: "cb-bad", d5: "cb-bad" });
  assert.equal(tried.fen, ask.fen, "a wrong try is never played on the board");
  const pick = momentBoard({ plies, moment: m1, phase: "pickLine", tried: null, accepted: null, lineN: -1 });
  assert.equal(pick.mover, "w", "the board still takes a move while a plan chip is picked");
});

test("found: the position after the accepted move, the Best badge and a green square", () => {
  const b = momentBoard({ plies, moment: m1, phase: "found", tried: null, accepted: "d1c1", lineN: -1 });
  assert.equal(b.mover, null);
  assert.deepEqual(b.lastMove, ["d1", "c1"]);
  assert.deepEqual(b.badge, { sq: "c1", kind: "best", label: "Best" });
  assert.deepEqual(b.highlights, { c1: "green" });
  assert.deepEqual(b.arrows, []);
  assert.equal(b.label, "You found Qc1");
  assert.equal(b.fen.split(" ")[1], "b", "Black to move after Qc1");
});

test("reveal: the played move with its badge and the best move as the green arrow", () => {
  const b = momentBoard({ plies, moment: m2, phase: "reveal", tried: null, accepted: null, lineN: -1 });
  assert.equal(b.fen, plies.fens[37]);
  assert.deepEqual(b.lastMove, ["d1", "d2"]);
  assert.deepEqual(b.badge, { sq: "d2", kind: "miss", label: "Miss" });
  assert.deepEqual(b.arrows, [{ from: "f1", to: "f5", color: "mq-best" }]);
  assert.equal(b.label, "After 19.Qd2 · arrow shows Rxf5");
  assert.equal(b.position, 37);
});

test("line: the best line replays ply by ply from the position before the moment", () => {
  const line = lineOf(plies.fens[36]!, m2.line);
  assert.deepEqual(
    line.map((p) => p.san),
    ["Rxf5", "Bh2+", "Kh1"],
  );
  assert.equal(line[1]!.check, "g1", "Bh2+ checks the king on g1");
  const start = momentBoard({ plies, moment: m2, phase: "line", tried: null, accepted: null, lineN: 0 });
  assert.equal(start.label, "Best line from move 19");
  assert.equal(start.fen, plies.fens[36]);
  const two = momentBoard({ plies, moment: m2, phase: "line", tried: null, accepted: null, lineN: 2 });
  assert.equal(two.label, "Best line · Rxf5 Bh2+");
  assert.deepEqual(two.lastMove, ["g3", "h2"]);
  assert.equal(two.check, "g1");
  const over = momentBoard({ plies, moment: m2, phase: "line", tried: null, accepted: null, lineN: 99 });
  assert.equal(over.label, "Best line · Rxf5 Bh2+ Kh1", "clamped to the line's end");
  assert.deepEqual(lineOf(plies.fens[36]!, "f1f5 a1a8"), lineOf(plies.fens[36]!, "f1f5"), "an illegal ply ends the replay");
  assert.deepEqual(lineOf("not a fen", "e2e4"), []);
});

test("dests and SAN come from the position (chess.js)", () => {
  const d = destsOf(plies.fens[32]!);
  assert.ok(d.get("d1")?.includes("c1"));
  assert.ok(d.get("c3")?.includes("d5"));
  assert.equal(d.get("e8"), undefined, "the side not to move has no targets");
  assert.equal(sanOf(plies.fens[32]!, "c3d5"), "Nd5");
  assert.equal(sanOf(plies.fens[32]!, "a1a8"), "a1a8", "an illegal move keeps its UCI");
});

test("phase groups, chips and copy", () => {
  assert.deepEqual(
    (["ask", "tried", "pickLine", "found", "found_retry", "reveal", "line"] as const).map((p) => [isAsking(p), isAnswered(p)]),
    [
      [true, false],
      [true, false],
      [true, false],
      [false, true],
      [false, true],
      [false, true],
      [false, true],
    ],
  );
  assert.deepEqual(
    PLAN_CHIPS.map((c) => c.label),
    ["Attack", "Defend", "Trade", "Improve a Piece", "Not Sure"],
  );
  assert.equal(momentHeader(0, 3, 17), "Moment 1 of 3 · Move 17");
  assert.equal(triedLine("Nd5"), "Not quite: Nd5 isn’t the move here. Try again, or reveal the answer.");
  assert.equal(foundLine(m1, "Qc1", "best"), "You found it: Qc1 is the engine’s move. In the game you played b3.");
  assert.equal(foundLine(m1, "Bd4", "alt"), "You found it: Bd4 is as good as the engine’s Qc1. In the game you played b3.");
  assert.deepEqual(momentSentences(m1, "ask"), [{ t: m1.ask, v: false }]);
  assert.equal(momentSentences(m1, "reveal").length, m1.why.length);
});

test("resume and tallies", () => {
  assert.equal(resumeIndex(null, 3), 0);
  assert.equal(resumeIndex({ momentIndex: 2, completedAt: null }, 3), 2);
  assert.equal(resumeIndex({ momentIndex: 3, completedAt: null }, 3), 2, "clamped to the last moment");
  assert.equal(resumeIndex({ momentIndex: 2, completedAt: "2026-11-09T18:58:40.000Z" }, 3), 0, "a finished walkthrough starts over");
  assert.deepEqual(tallyResults({ 0: "found_retry", 1: "revealed", 2: "found" }, 3), { moments: 3, found: 1, found_retry: 1, revealed: 1 });
  assert.deepEqual(tallyResults({ 1: "revealed" }, 3), { moments: 3, found: 0, found_retry: 0, revealed: 1 });
  assert.equal(firstOpenMoment(["found", null, "revealed"]), 1);
  assert.equal(firstOpenMoment(["found"]), null);
  assert.equal(m3.ply, 40);
});
