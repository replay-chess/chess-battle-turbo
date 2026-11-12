// model.ts: the replay, grades, progress and failure lines, counts, graph and rows against the design fixtures
// (V3ReviewSummary GAME and CLEAN, replayed in @repo/contracts/http/fixtures/review).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLEAN, GAME, reviewFixture } from "@repo/contracts/http/fixtures/review";
import {
  bestUciAt,
  clampPly,
  countRows,
  evalAt,
  evalWords,
  failureLine,
  GRAPH_H,
  GRAPH_MAX_POINTS,
  GRAPH_W,
  graphOf,
  graphX,
  judgementAt,
  moveRows,
  moveText,
  moverOf,
  phaseOf,
  pliesOf,
  positionLabel,
  progressOf,
  reasonAt,
  reviewPlies,
  scoreText,
  secondsUntil,
  stripCells,
  viewerLost,
  whiteShare,
} from "./model";

const done = reviewFixture("done");
const plies = reviewPlies(done);

test("the replay gives one FEN per position and the payload's SAN", () => {
  assert.equal(plies.uci.length, GAME.plies);
  assert.equal(plies.fens.length, GAME.plies + 1);
  assert.deepEqual(plies.san, GAME.san.split(" "));
  assert.equal(plies.fens[GAME.plies], GAME.finalFen);
  assert.equal(plies.startMover, "w");
  assert.deepEqual(plies.moves[0], { from: "e2", to: "e4" });
});

test("the replay marks the king in check and stops at a move that does not replay", () => {
  const clean = reviewFixture("clean");
  const p = reviewPlies(clean);
  assert.equal(p.checks[CLEAN.plies], "e8"); // 17.Rd8#
  const broken = pliesOf(done.game.startFen, 0, "e2e4 e7e5 e1e8 g1f3");
  assert.equal(broken.san.length, 2);
  assert.equal(broken.fens.length, 3);
});

test("move labels follow §8.1 (startPly offsets, … for Black)", () => {
  assert.equal(moveText(plies, 36), "19.Qd2");
  assert.equal(moveText(plies, 35), "18…Bg3");
  const legend = pliesOf("r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R w KQkq - 1 12", 22, "b5a4 a8b8");
  assert.equal(moveText(legend, 0), "12.Ba4");
  assert.equal(moveText(legend, 1), "12…Rb8");
  const black = pliesOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", 1, "e7e5");
  assert.equal(moverOf(black, 0), "b");
  assert.equal(moveText(black, 0), "1…e5");
});

test("judgements, evals and best moves are read only for graded plies", () => {
  const running = reviewFixture("running"); // 20 of 54 graded
  assert.equal(judgementAt(running.analysis, 0), "book");
  assert.equal(judgementAt(running.analysis, 19), "book");
  assert.equal(judgementAt(running.analysis, 20), null);
  assert.equal(evalAt(running.analysis, 20), GAME.evals[20]);
  assert.equal(evalAt(running.analysis, 21), null);
  assert.equal(judgementAt(done.analysis, 36), "miss");
  assert.equal(judgementAt(done.analysis, 40), "blunder");
  assert.equal(bestUciAt(done.analysis, 36), "f1f5");
  assert.equal(bestUciAt(running.analysis, 36), null);
  assert.equal(judgementAt(null, 0), null);
});

test("eval words, scores from the viewer's side and the bar share", () => {
  assert.equal(evalWords(null), "");
  assert.equal(evalWords(30), "About level");
  assert.equal(evalWords(120), "White is better");
  assert.equal(evalWords(-400), "Black is winning");
  assert.equal(evalWords(-100), "Black is better");
  assert.equal(evalWords(30_000), "Checkmate");
  assert.equal(evalWords(29_997), "White is winning");
  assert.equal(scoreText(36, "w"), "+0.4");
  assert.equal(scoreText(36, "b"), "−0.4");
  assert.equal(scoreText(29_997, "w"), "M3");
  assert.equal(scoreText(29_997, "b"), "−M3");
  assert.equal(whiteShare(null), 50);
  assert.ok(whiteShare(1000) > 90);
  assert.ok(whiteShare(-1000) < 10);
});

test("the Moves tab reason comes from the CA templates", () => {
  assert.equal(reasonAt(plies, done.analysis, 0), "Known opening theory.");
  assert.match(reasonAt(plies, done.analysis, 36), /^Missed Rxf5/);
  assert.equal(reasonAt(plies, reviewFixture("running").analysis, 36), "Still analysing this move.");
});

test("phases follow the status, the writing flag and the content", () => {
  assert.deepEqual(phaseOf(reviewFixture("none"), false), { kind: "none" });
  assert.deepEqual(phaseOf(reviewFixture("queued"), false), { kind: "queued", etaSec: 40, position: 2 });
  assert.deepEqual(phaseOf(reviewFixture("running"), false), { kind: "running" });
  assert.deepEqual(phaseOf(reviewFixture("running"), true), { kind: "writing" });
  assert.deepEqual(phaseOf(reviewFixture("failed"), false), {
    kind: "failed",
    retryable: true,
    retryAt: "2026-11-09T18:45:10.000Z",
    failedAtPly: 20,
  });
  assert.equal((phaseOf(reviewFixture("terminal"), false) as { retryable: boolean }).retryable, false);
  assert.deepEqual(phaseOf(reviewFixture("skipped"), false), { kind: "skipped" });
  assert.deepEqual(phaseOf(done, false), { kind: "done", clean: false, moments: 3 });
  assert.deepEqual(phaseOf(reviewFixture("clean"), false), { kind: "done", clean: true, moments: 0 });
  assert.deepEqual(phaseOf({ ...done, review: null }, false), { kind: "done", clean: false, moments: 0 });
});

test("progress counts full moves (ceil of plies / 2) and writing shows 95 %", () => {
  assert.deepEqual(progressOf({ gradedPlies: 20, totalPlies: 54 }, false), { pct: 37, movesDone: 10, movesTotal: 27 });
  assert.deepEqual(progressOf({ gradedPlies: 45, totalPlies: 121 }, false), { pct: 37, movesDone: 23, movesTotal: 61 });
  assert.deepEqual(progressOf({ gradedPlies: 0, totalPlies: 54 }, false), { pct: 0, movesDone: 1, movesTotal: 27 });
  assert.equal(progressOf({ gradedPlies: 54, totalPlies: 54 }, true).pct, 95);
  assert.deepEqual(progressOf(null, false), { pct: 0, movesDone: 0, movesTotal: 0 });
});

test("the failure line counts moves, not plies (rct-a §4.2)", () => {
  assert.equal(failureLine(0, 54, 31), "The engine stopped at move 16 of 27. Moves 1 to 15 are graded below.");
  assert.equal(failureLine(0, 54, 20), "The engine stopped at move 11 of 27. Moves 1 to 10 are graded below.");
  assert.equal(failureLine(0, 54, 3), "The engine stopped at move 2 of 27. Move 1 is graded below.");
  assert.equal(failureLine(0, 54, 0), "The engine stopped at move 1 of 27. No move was graded before it stopped.");
  assert.equal(failureLine(18, 16, 6), "The engine stopped at move 13 of 17. Moves 10 to 12 are graded below.");
});

test("the retry countdown never goes negative", () => {
  const now = Date.parse("2026-11-09T18:44:45.000Z");
  assert.equal(secondsUntil("2026-11-09T18:45:10.000Z", now), 25);
  assert.equal(secondsUntil("2026-11-09T18:40:00.000Z", now), 0);
  assert.equal(secondsUntil(null, now), null);
});

test("a clean loss is detected from the result and the viewer's colour", () => {
  assert.equal(viewerLost(done), true); // 0-1, viewer White
  assert.equal(viewerLost(reviewFixture("clean")), false);
});

test("count rows: the ten always, Forced and Interesting only when used, You and Opp by colour", () => {
  const rows = countRows(done.analysis!.counts, "w");
  assert.deepEqual(
    rows.map((r) => r.key),
    ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"],
  );
  const best = rows.find((r) => r.key === "best")!;
  assert.deepEqual([best.you, best.opp], [5, 6]);
  const clean = reviewFixture("clean").analysis!;
  const cleanRows = countRows(clean.counts, "w");
  assert.ok(cleanRows.some((r) => r.key === "forced"), "Black has a Forced move in CLEAN (16…Nxb8)");
  assert.ok(!cleanRows.some((r) => r.key === "interesting"), "nobody has an Interesting");
  assert.equal(cleanRows.findIndex((r) => r.key === "forced"), 6, "code order: after book");
  const flipped = countRows(done.analysis!.counts, "b").find((r) => r.key === "best")!;
  assert.deepEqual([flipped.you, flipped.opp], [6, 5]);
});

test("the graph: viewer side up, ticks for the viewer's errors only, x by position", () => {
  const g = graphOf(done.analysis!, plies, "w");
  const points = g.line.split(" ");
  assert.equal(points.length, GAME.plies + 1);
  assert.equal(points[0]!.split(",")[0], "0.0");
  assert.ok(Number(points[0]!.split(",")[1]) < GRAPH_H / 2, "White is slightly better at the start: above the midline");
  assert.equal(points[points.length - 1]!.split(",")[0], GRAPH_W.toFixed(1));
  assert.ok(g.area.startsWith(`0,${GRAPH_H} `));
  assert.ok(g.area.endsWith(`${GRAPH_W.toFixed(1)},${GRAPH_H}`));
  assert.deepEqual(
    g.ticks.map((t) => [t.ply, t.key]),
    [
      [32, "inaccuracy"],
      [36, "miss"],
      [40, "blunder"],
      [44, "inaccuracy"], // 23.Rxf6 (the mock's INTERESTING, graded INACCURACY: P3-D15)
    ],
  );
  for (const t of g.ticks) assert.equal(moverOf(plies, t.ply), "w");
  // Black's view: the line is mirrored.
  const gb = graphOf(done.analysis!, plies, "b");
  const yW = Number(points[10]!.split(",")[1]);
  const yB = Number(gb.line.split(" ")[10]!.split(",")[1]);
  assert.ok(Math.abs(yW + yB - GRAPH_H) < 0.11);
  assert.equal(graphX(27, 54), 270);
});

test("the graph stops at the graded plies and downsamples long games", () => {
  const running = reviewFixture("running");
  const g = graphOf(running.analysis!, reviewPlies(running), "w");
  assert.equal(g.line.split(" ").length, 21);
  const evals = Array.from({ length: 401 }, (_, i) => (i % 2 ? 30 : -30));
  const long = graphOf({ gradedPlies: 400, totalPlies: 400, evals, j: "", best: "" }, plies, "w");
  const n = long.line.split(" ").length;
  assert.ok(n <= GRAPH_MAX_POINTS + 1, `${n} points`);
  assert.equal(long.line.split(" ").pop()!.split(",")[0], GRAPH_W.toFixed(1));
});

test("move rows pair White and Black, with judgements once graded", () => {
  const rows = moveRows(plies, done.analysis);
  assert.equal(rows.length, 27);
  assert.deepEqual(rows[18]!.w, { ply: 36, san: "Qd2", text: "19.Qd2", key: "miss" });
  assert.equal(rows[18]!.b!.text, "19…Bh7");
  const running = moveRows(plies, reviewFixture("running").analysis);
  assert.equal(running[18]!.w!.key, null);
  const black = pliesOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", 1, "e7e5 g1f3");
  const br = moveRows(black, null);
  assert.equal(br[0]!.w, null);
  assert.equal(br[0]!.b!.text, "1…e5");
  assert.equal(br[1]!.w!.text, "2.Nf3");
});

test("the strip shows 7 plies around the current one, clamped at both ends", () => {
  assert.deepEqual(
    stripCells(plies, done.analysis, 36).map((c) => c.ply),
    [33, 34, 35, 36, 37, 38, 39],
  );
  assert.deepEqual(
    stripCells(plies, done.analysis, 0).map((c) => c.ply),
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    stripCells(plies, done.analysis, 53).map((c) => c.ply),
    [47, 48, 49, 50, 51, 52, 53],
  );
  assert.deepEqual(
    stripCells(plies, done.analysis, -1).map((c) => c.ply),
    [0, 1, 2, 3, 4, 5, 6],
  );
});

test("position labels and the ply clamp", () => {
  assert.equal(positionLabel(plies, 36), "After 19.Qd2");
  assert.equal(positionLabel(plies, -1), "Start position");
  assert.equal(clampPly(plies, 999), 53);
  assert.equal(clampPly(plies, -7), -1);
  assert.equal(clampPly(plies, Number.NaN), 53);
});
