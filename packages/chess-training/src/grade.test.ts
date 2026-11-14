// grade.ts: the §8.3 table (suggested grade, note, firstTry, Glicko score, solve streak), the override flag and the
// Again re-queue (§8.6), all of which the runner and the server must apply identically.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  gradeNote,
  gradeOutcome,
  isFirstTry,
  isOverridden,
  objectiveScore,
  requeueAfterAgain,
  requeueIndex,
  solveStreakAfter,
  streakReset,
  suggestedGrade,
} from "./grade";
import { SESSION_ITEMS_MAX } from "./constants";

describe("the §8.3 table", () => {
  const rows = [
    {
      what: "solved, no hint, no wrong move",
      f: { shown: false, wrongs: 0, hints: 0 },
      suggested: "good",
      note: "Solved first time. Pick Easy if it felt instant.",
      firstTry: true,
      score: 1,
      streak: 6,
    },
    {
      what: "solved after hint step 1",
      f: { shown: false, wrongs: 0, hints: 1 },
      suggested: "hard",
      note: "Solved with a hint, so Hard is suggested.",
      firstTry: false,
      score: 0.5,
      streak: 5,
    },
    {
      what: "solved after hint step 2",
      f: { shown: false, wrongs: 0, hints: 2 },
      suggested: "hard",
      note: "Solved with a hint, so Hard is suggested.",
      firstTry: false,
      score: 0.5,
      streak: 5,
    },
    {
      what: "one wrong move, then solved",
      f: { shown: false, wrongs: 1, hints: 0 },
      suggested: "again",
      note: "One wrong try, so Again is suggested.",
      firstTry: false,
      score: 0,
      streak: 0,
    },
    {
      what: "solution shown after a wrong move",
      f: { shown: true, wrongs: 1, hints: 0 },
      suggested: "again",
      note: "You saw the solution, so Again is suggested: it comes back in under 10 minutes.",
      firstTry: false,
      score: 0,
      streak: 0,
    },
    {
      what: "solution shown from the menu",
      f: { shown: true, wrongs: 0, hints: 0 },
      suggested: "again",
      note: "You saw the solution, so Again is suggested: it comes back in under 10 minutes.",
      firstTry: false,
      score: 0,
      streak: 0,
    },
    {
      what: "review position solved with an accepted non-best move",
      f: { shown: false, wrongs: 0, hints: 0, acceptedNonBest: true },
      suggested: "good",
      note: "Good enough. The engine's best was Qc1.",
      firstTry: true,
      score: 1,
      streak: 6,
    },
  ] as const;

  for (const r of rows) {
    it(r.what, () => {
      assert.equal(suggestedGrade(r.f), r.suggested);
      assert.equal(gradeNote(r.f, { bestSan: "Qc1" }), r.note);
      assert.equal(isFirstTry(r.f), r.firstTry);
      assert.equal(objectiveScore(r.f), r.score);
      assert.equal(solveStreakAfter(5, r.f), r.streak);
      assert.equal(streakReset(r.f), r.streak === 0);
      assert.deepEqual(gradeOutcome(r.f, { bestSan: "Qc1" }), {
        suggested: r.suggested,
        note: r.note,
        firstTry: r.firstTry,
        score: r.score,
        streakReset: r.streak === 0,
      });
    });
  }

  it("counts several wrong tries in the note", () => {
    assert.equal(gradeNote({ shown: false, wrongs: 3, hints: 1 }), "3 wrong tries, so Again is suggested.");
    assert.equal(suggestedGrade({ shown: false, wrongs: 3, hints: 1 }), "again");
  });

  it("flags an override whenever the chosen grade differs from the suggestion (D-10)", () => {
    assert.equal(isOverridden("good", "good"), false);
    assert.equal(isOverridden("easy", "good"), true);
    assert.equal(isOverridden("good", "again"), true);
  });
});

describe("Again re-queue", () => {
  type It = { itemId: string; pass: 1 | 2; label: string };
  const items = (n: number): It[] => Array.from({ length: n }, (_, i) => ({ itemId: `i${i + 1}`, pass: 1, label: `item ${i + 1}` }));

  it("puts the copy 3 items later, or at the end when fewer remain (min(i + 4, length))", () => {
    assert.equal(requeueIndex(0, 10), 4);
    assert.equal(requeueIndex(5, 10), 9);
    assert.equal(requeueIndex(7, 10), 10);
    assert.equal(requeueIndex(9, 10), 10);
  });

  it("inserts a pass-2 copy with id + b", () => {
    const r = requeueAfterAgain(items(10), 0, (it) => ({ ...it, label: `${it.label} again` }));
    assert.equal(r.requeued, true);
    assert.equal(r.at, 4);
    assert.deepEqual(
      r.items.map((x) => x.itemId),
      ["i1", "i2", "i3", "i4", "i1b", "i5", "i6", "i7", "i8", "i9", "i10"],
    );
    assert.deepEqual(r.items[4], { itemId: "i1b", pass: 2, label: "item 1 again" });
  });

  it("appends at the end near the end of the session", () => {
    const r = requeueAfterAgain(items(3), 2, (it) => it);
    assert.deepEqual(
      r.items.map((x) => x.itemId),
      ["i1", "i2", "i3", "i3b"],
    );
  });

  it("never re-queues a pass-2 copy, and never adds the same copy twice", () => {
    const once = requeueAfterAgain(items(6), 1, (it) => it);
    const copyAt = once.items.findIndex((x) => x.itemId === "i2b");
    const again = requeueAfterAgain(once.items, copyAt, (it) => it);
    assert.equal(again.requeued, false);
    assert.deepEqual(again.items, once.items);
    const replay = requeueAfterAgain(once.items, 1, (it) => it);
    assert.equal(replay.requeued, false, "a replayed grade does not add a second copy");
    assert.equal(replay.items.length, once.items.length);
  });

  it("takes no copy once the list holds SESSION_ITEMS_MAX items (a full puzzle stream: FIX-1 stream-40)", () => {
    const full = requeueAfterAgain(items(SESSION_ITEMS_MAX), 30, (it) => it);
    assert.equal(full.requeued, false);
    assert.equal(full.items.length, SESSION_ITEMS_MAX);
    const room = requeueAfterAgain(items(SESSION_ITEMS_MAX - 1), 30, (it) => it);
    assert.equal(room.requeued, true);
    assert.equal(room.items.length, SESSION_ITEMS_MAX);
  });

  it("ignores an index outside the list", () => {
    const r = requeueAfterAgain(items(2), 5, (it) => it);
    assert.equal(r.requeued, false);
    assert.equal(r.items.length, 2);
  });
});
