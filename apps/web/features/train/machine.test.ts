// The trainer's phase machine and local validation (phase-05 plan §4.4 diagram, §8.3 table, §12.1) on the design
// fixtures (V3BankSession's three positions, V3PuzzleSolve's fork puzzle): every board state is reached by real moves.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionPayloadFixture } from "@repo/contracts/http/fixtures/p05";
import type { TrainItem } from "@repo/contracts/http/train";
import { initialRun, isUserTurn, MARK, step, timerFor, viewOf, type ItemRun } from "./machine";
import { judgeMove, prepareItem, type PreparedItem } from "./validate";

const bank = sessionPayloadFixture("bank");
const puzzles = sessionPayloadFixture("puzzles");
const qc1 = bank.items[0]!; // Qc1 Nxe3 Qxe3, played b3
const rxf5 = bank.items[1]!; // Rxf5 Bh2+ Kh1, played Qd2
const fork = puzzles.items[0]!; // setup Qd5, Nc7+ Kd8 Nxd5

function prep(item: TrainItem): PreparedItem {
  const p = prepareItem(item);
  assert.ok(p, `${item.itemId} replays`);
  return p;
}

function play(p: PreparedItem, run: ItemRun, ...events: Parameters<typeof step>[2][]): ItemRun {
  return events.reduce((r, e) => step(p, r, e), run);
}

test("prepareItem replays the setup, the line and the accepted moves", () => {
  const p = prep(fork);
  assert.equal(p.setup?.san, "Qd5");
  assert.deepEqual(p.line.map((m) => m.san), ["Nc7+", "Kd8", "Nxd5"]);
  assert.equal(p.userSide, "w");
  assert.equal(p.line[0]!.check, "e8");
  const b = prep(qc1);
  assert.equal(b.setup, null);
  assert.equal(b.baseFen, qc1.fen);
});

test("a broken line, an illegal setup or an unreadable FEN is null", () => {
  assert.equal(prepareItem({ ...qc1, solution: ["a1a8"] }), null);
  assert.equal(prepareItem({ ...fork, setup: ["e2e4"] }), null);
  assert.equal(prepareItem({ ...qc1, fen: "not a fen" }), null);
  // An illegal accepted alternative is dropped, not fatal.
  assert.equal(prepareItem({ ...qc1, accept: ["a1a8"] })?.accept.size, 0);
});

test("judgeMove: best, accepted alternative (first move only), wrong; promotions keep their piece", () => {
  const p = prep({ ...qc1, kind: "review_position", solution: ["d1c1"], accept: ["d1d2", "d1e1"] });
  assert.equal(judgeMove(p, 0, "D1C1"), "best");
  assert.equal(judgeMove(p, 0, "d1d2"), "accept");
  assert.equal(judgeMove(p, 0, "b2b3"), "wrong");
  const promo = prep({ ...qc1, fen: "8/4P3/8/8/8/8/k7/7K w - - 0 1", solution: ["e7e8q"], accept: [] });
  assert.equal(judgeMove(promo, 0, "e7e8q"), "best");
  assert.equal(judgeMove(promo, 0, "e7e8n"), "wrong");
});

test("puzzle: setup → solve → reply → solve → graded (first try → Good, rating score 1)", () => {
  const p = prep(fork);
  let run = initialRun(p);
  assert.equal(run.phase, "setup");
  assert.deepEqual(timerFor(run), { event: { type: "setup_done" }, ms: 400 });
  assert.equal(viewOf(fork, p, run).status, "Watch the last move…");
  assert.equal(viewOf(fork, p, run).fen, fork.fen);
  run = step(p, run, { type: "setup_done" });
  let v = viewOf(fork, p, run);
  assert.equal(v.status, "White to move");
  assert.equal(v.mover, "w");
  assert.deepEqual(v.lastMove, ["d8", "d5"]);
  run = step(p, run, { type: "move", uci: "b5c7" });
  assert.equal(run.phase, "reply");
  v = viewOf(fork, p, run);
  assert.equal(v.status, "Good. Black replies…");
  assert.equal(v.mover, null);
  assert.deepEqual(timerFor(run), { event: { type: "reply_done" }, ms: 450 });
  run = step(p, run, { type: "reply_done" });
  assert.equal(viewOf(fork, p, run).status, "Keep going: White to move");
  run = step(p, run, { type: "move", uci: "c7d5" });
  v = viewOf(fork, p, run);
  assert.equal(run.phase, "graded");
  assert.equal(v.status, "Correct.");
  assert.equal(v.suggested, "good");
  assert.equal(v.gradeNote, "Solved first time. Pick Easy if it felt instant.");
  assert.equal(v.score, 1);
  assert.equal(v.firstTry, true);
  assert.equal(v.highlights.d5, MARK.solved);
  assert.deepEqual(v.badge, { sq: "d5", kind: "best" });
  assert.deepEqual(v.coach, { text: fork.text.correct, tone: "good", verified: true });
});

test("hint: ring then arrow on the expected move; Hard suggested, score 0.5; a third hint does nothing", () => {
  const p = prep(rxf5);
  let run = initialRun(p, rxf5.context!.playedUci);
  run = step(p, run, { type: "hint" });
  let v = viewOf(rxf5, p, run);
  assert.equal(v.rings.f1, MARK.hintRing);
  assert.equal(v.arrows.length, 0);
  assert.equal(v.coach?.text, rxf5.text.hint);
  assert.equal(v.hint.label, "Show Arrow");
  assert.equal(v.hintNote, "Hint used · counts as Hard");
  run = step(p, run, { type: "hint" });
  v = viewOf(rxf5, p, run);
  assert.deepEqual(v.arrows, [{ from: "f1", to: "f5", color: MARK.hintArrow }]);
  assert.equal(v.coach?.text, `${rxf5.text.hint} The arrow shows the move.`);
  assert.equal(v.hint.label, "Hint Used");
  assert.equal(v.hint.disabled, true);
  assert.equal(step(p, run, { type: "hint" }), run);
  run = play(p, run, { type: "move", uci: "f1f5" }, { type: "reply_done" }, { type: "move", uci: "g1h1" });
  v = viewOf(rxf5, p, run);
  assert.equal(v.suggested, "hard");
  assert.equal(v.score, 0.5);
  assert.equal(v.firstTry, false);
  assert.equal(v.gradeNote, "Solved with a hint, so Hard is suggested.");
});

test("wrong: the game move gets the game coach line, red squares, streak reset; Try Again goes back", () => {
  const p = prep(rxf5);
  let run = initialRun(p, rxf5.context!.playedUci);
  run = step(p, run, { type: "move", uci: "d1d2" });
  let v = viewOf(rxf5, p, run);
  assert.equal(run.phase, "wrong");
  assert.equal(v.status, "Not quite.");
  assert.deepEqual(v.coach, { text: rxf5.text.wrongGameMove, tone: "bad", verified: true });
  assert.equal(v.highlights.d1, MARK.wrongFrom);
  assert.equal(v.highlights.d2, MARK.wrongTo);
  assert.equal(v.streakReset, true);
  assert.equal(v.mover, null);
  assert.deepEqual(run.wrongMoves, ["d1d2"]);
  run = step(p, run, { type: "retry" });
  assert.equal(run.phase, "solve");
  assert.equal(viewOf(rxf5, p, run).fen, rxf5.fen);
  // Another wrong move: the generic line, not verified.
  run = step(p, run, { type: "move", uci: "a2a3" });
  v = viewOf(rxf5, p, run);
  assert.deepEqual(v.coach, { text: `Not the move. ${rxf5.text.hint}`, tone: "bad", verified: false });
  run = play(p, step(p, run, { type: "retry" }), { type: "move", uci: "f1f5" }, { type: "reply_done" }, { type: "move", uci: "g1h1" });
  v = viewOf(rxf5, p, run);
  assert.equal(v.suggested, "again");
  assert.equal(v.gradeNote, "2 wrong tries, so Again is suggested.");
  assert.equal(v.score, 0);
});

test("show solution: from a wrong move, 600 ms per ply to the end, blue square, no badge, Again", () => {
  const p = prep(qc1);
  let run = step(p, initialRun(p, "b2b3"), { type: "move", uci: "b2b3" });
  run = step(p, run, { type: "show_solution" });
  assert.equal(run.phase, "sol");
  assert.equal(viewOf(qc1, p, run).fen, qc1.fen, "the wrong move is taken back");
  assert.equal(viewOf(qc1, p, run).status, "Here is the solution");
  assert.deepEqual(timerFor(run), { event: { type: "sol_step" }, ms: 600 });
  run = play(p, run, { type: "sol_step" }, { type: "sol_step" }, { type: "sol_step" });
  const v = viewOf(qc1, p, run);
  assert.equal(run.phase, "graded");
  assert.equal(v.status, "Solution shown");
  assert.equal(v.highlights.e3, MARK.shown);
  assert.equal(v.badge, null);
  assert.equal(v.suggested, "again");
  assert.equal(v.coach?.tone, "idle");
  assert.equal(v.gradeNote, "You saw the solution, so Again is suggested: it comes back in under 10 minutes.");
});

test("review position: an accepted non-best move solves it with Good and names the best", () => {
  const item: TrainItem = { ...qc1, kind: "review_position", solution: ["d1c1"], accept: ["d1d2"] };
  const p = prep(item);
  const run = step(p, initialRun(p), { type: "move", uci: "d1d2" });
  const v = viewOf(item, p, run);
  assert.equal(run.phase, "graded");
  assert.equal(run.solvedBy, "accept");
  assert.equal(v.suggested, "good");
  assert.equal(v.gradeNote, "Good enough. The engine's best was Qc1.");
  assert.deepEqual(v.badge, { sq: "d2", kind: "good" });
});

test("moves outside the member's turn and events in the wrong phase change nothing", () => {
  const p = prep(fork);
  const setup = initialRun(p);
  assert.equal(step(p, setup, { type: "move", uci: "b5c7" }), setup);
  assert.equal(isUserTurn(setup), false);
  const reply = play(p, setup, { type: "setup_done" }, { type: "move", uci: "b5c7" });
  assert.equal(step(p, reply, { type: "move", uci: "c7d5" }), reply);
  assert.equal(step(p, reply, { type: "retry" }), reply);
  assert.equal(step(p, reply, { type: "sol_step" }), reply);
});

test("wrong moves are capped at 10 (AttemptIn.wrongMovesUci)", () => {
  const p = prep(qc1);
  let run = initialRun(p);
  for (let i = 0; i < 12; i++) run = play(p, run, { type: "move", uci: i % 2 ? "a2a3" : "a2a4" }, { type: "retry" });
  assert.equal(run.wrongs, 12);
  assert.equal(run.wrongMoves.length, 10);
});

// FIX-1 alt-mate (plan §8.1 step 2): any checkmate solves a ply whose stored move mates, in a Lichess puzzle (accept is
// always empty there) and at any ply of a longer line. The reviewer's two positions.
test("an alternative mate solves a Lichess puzzle's mating ply (accept is empty for shard puzzles)", () => {
  const mateIn1: TrainItem = { ...fork, itemId: "m1", fen: "7k/5ppp/8/8/8/8/5PPP/RR4K1 b - - 0 1", setup: ["h8g8"], solution: ["a1a8"], accept: [] };
  const p = prep(mateIn1);
  assert.equal(judgeMove(p, 0, "a1a8"), "best");
  assert.equal(judgeMove(p, 0, "b1b8"), "accept", "Rb8# is as good");
  assert.equal(judgeMove(p, 0, "a1a7"), "wrong");
  const run = play(p, initialRun(p), { type: "setup_done" }, { type: "move", uci: "b1b8" });
  assert.equal(run.phase, "graded");
  assert.equal(run.wrongs, 0);
  const v = viewOf(mateIn1, p, run);
  assert.equal(v.suggested, "good");
  assert.equal(v.firstTry, true);
  assert.equal(v.score, 1, "a correct mate scores 1 for Glicko");
  assert.equal(v.fen, run.accepted!.fen);
});

test("an alternative mate at the last ply of a 3-ply line solves it", () => {
  const line: TrainItem = { ...fork, itemId: "m3", fen: "6k1/5ppp/8/8/8/8/n4PPP/RR4K1 w - - 0 1", setup: [], solution: ["a1a2", "g8h8", "b1b8"], accept: [] };
  const p = prep(line);
  assert.deepEqual([...p.matePlies], [2]);
  let run = play(p, { ...initialRun(p), phase: "solve" }, { type: "move", uci: "a1a2" }, { type: "reply_done" });
  assert.equal(run.ply, 2);
  assert.equal(judgeMove(p, 2, "a2a8"), "accept", "Ra8# instead of Rb8#");
  run = step(p, run, { type: "move", uci: "a2a8" });
  assert.equal(run.phase, "graded");
  assert.equal(run.wrongs, 0);
  assert.equal(run.ply, 3);
});
