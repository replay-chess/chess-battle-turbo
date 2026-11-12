// complete/copy.ts: the state of each fixture, the lead, the stat tiles and the moment lines (phase-03 plan §4.2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewCompleteFixture } from "@repo/contracts/http/fixtures/review";
import {
  bestMonthLine,
  completeLead,
  completeStateOf,
  completeTitle,
  firstOpenMomentNumber,
  momentPlayedLine,
  momentResultLine,
  statTiles,
} from "./copy";

test("each fixture maps to its board state", () => {
  for (const s of ["default", "nothing", "partial", "noMoments"] as const) assert.equal(completeStateOf(reviewCompleteFixture(s)), s);
  const unfinished = { ...reviewCompleteFixture("default"), reviewed: 2, partial: false };
  assert.equal(completeStateOf(unfinished), "partial", "fewer results than moments is partial even after Finish");
});

test("titles and leads (every number computed)", () => {
  const d = reviewCompleteFixture("default");
  assert.equal(completeTitle("default"), "Review complete");
  assert.equal(completeLead(d, "default"), "3 moments reviewed.");
  assert.equal(completeLead(reviewCompleteFixture("partial"), "partial"), "2 of 3 moments reviewed.");
  assert.equal(completeTitle("nothing"), "Clean game");
  assert.equal(completeLead(reviewCompleteFixture("nothing"), "nothing"), "Your best decision was 16.Qb8+, a sacrifice that forced mate.");
  assert.equal(completeTitle("noMoments"), "No turning points in this game.");
  assert.equal(completeLead({ ...d, moments: d.moments.slice(0, 1), reviewed: 1 }, "default"), "1 moment reviewed.");
});

test("stat tiles: Accuracy · Moments · Found; clean: Accuracy · Brilliant · Best this month only when true", () => {
  const tiles = (s: Parameters<typeof reviewCompleteFixture>[0]) =>
    statTiles(reviewCompleteFixture(s), completeStateOf(reviewCompleteFixture(s))).map((t) => `${t.label}=${t.value}`);
  assert.deepEqual(tiles("default"), ["Accuracy=85", "Moments=3", "Found=2"]);
  assert.deepEqual(tiles("nothing"), ["Accuracy=97", "Brilliant=1", "Best this month=✓"]);
  const notBest = { ...reviewCompleteFixture("nothing"), bestThisMonth: false };
  assert.deepEqual(statTiles(notBest, "nothing").map((t) => t.label), ["Accuracy", "Brilliant"]);
  // regression: no-moments-best-move (FIX-2, review round 2): plan 4.2 noMoments = "Accuracy, Best move"; the tile
  // only showed for a standout, which a game with no moments never had.
  assert.deepEqual(tiles("noMoments"), ["Accuracy=88", "Best move=14.O-O"]);
  assert.deepEqual(statTiles({ ...reviewCompleteFixture("noMoments"), standouts: [] }, "noMoments").map((t) => t.label), ["Accuracy"]);
  assert.equal(statTiles({ ...reviewCompleteFixture("default"), accuracy: null }, "default")[0]!.value, "—");
});

test("moment lines and the resume target", () => {
  const [m1, m2, m3] = reviewCompleteFixture("default").moments;
  assert.equal(momentPlayedLine(m1!), "You played 17.b3 · best was Qc1");
  assert.equal(momentResultLine(m1!), "Inaccuracy · you found it on retry");
  assert.equal(momentResultLine(m2!), "Miss · you found it");
  assert.equal(momentResultLine(m3!), "Blunder · you saw the answer");
  assert.equal(momentResultLine({ ...m3!, result: null }), "Blunder · not reviewed yet");
  assert.equal(firstOpenMomentNumber(reviewCompleteFixture("partial").moments), 3);
  assert.equal(firstOpenMomentNumber(reviewCompleteFixture("default").moments), null);
  assert.equal(bestMonthLine(97), "Accuracy 97 is your best this month.");
  assert.equal(bestMonthLine(null), null);
});
