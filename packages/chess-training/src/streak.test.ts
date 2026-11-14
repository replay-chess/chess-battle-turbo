// streak.ts: the day streak (phase-05 plan §8.9, D-4, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { applyStreak, displayedStreak, isNewBestStreak, streakAria, streakWeek, type StreakState } from "./streak";

const s = (dayStreak: number, dayStreakBest: number, lastActiveDay: string | null): StreakState => ({ dayStreak, dayStreakBest, lastActiveDay });

describe("applyStreak", () => {
  it("starts at 1 with no earlier day", () => {
    assert.deepEqual(applyStreak(s(0, 0, null), "2026-11-12"), s(1, 1, "2026-11-12"));
  });

  it("leaves the streak alone for a second attempt the same day (gap 0)", () => {
    const st = s(4, 9, "2026-11-12");
    assert.equal(applyStreak(st, "2026-11-12"), st);
  });

  it("adds one after a gap of 1 day", () => {
    assert.deepEqual(applyStreak(s(4, 9, "2026-11-11"), "2026-11-12"), s(5, 9, "2026-11-12"));
  });

  it("forgives one missed day (gap 2)", () => {
    assert.deepEqual(applyStreak(s(4, 9, "2026-11-10"), "2026-11-12"), s(5, 9, "2026-11-12"));
  });

  it("restarts at 1 after skipping 2 days (gap 3)", () => {
    assert.deepEqual(applyStreak(s(4, 9, "2026-11-09"), "2026-11-12"), s(1, 9, "2026-11-12"));
  });

  it("raises the best", () => {
    const after = applyStreak(s(9, 9, "2026-11-11"), "2026-11-12");
    assert.deepEqual(after, s(10, 10, "2026-11-12"));
    assert.equal(isNewBestStreak(s(9, 9, "2026-11-11"), after), true);
    assert.equal(isNewBestStreak(s(3, 9, "2026-11-11"), applyStreak(s(3, 9, "2026-11-11"), "2026-11-12")), false);
  });

  it("does not reset today's streak for a late offline attempt from yesterday", () => {
    const today = applyStreak(s(4, 9, "2026-11-11"), "2026-11-12");
    const late = applyStreak(today, "2026-11-11");
    assert.deepEqual(late, today);
  });
});

describe("displayedStreak", () => {
  it("shows the streak while the last active day is at most 2 days back, else 0", () => {
    const st = s(4, 9, "2026-11-10");
    assert.equal(displayedStreak(st, "2026-11-10"), 4);
    assert.equal(displayedStreak(st, "2026-11-11"), 4);
    assert.equal(displayedStreak(st, "2026-11-12"), 4);
    assert.equal(displayedStreak(st, "2026-11-13"), 0);
    assert.equal(displayedStreak(s(0, 0, null), "2026-11-13"), 0);
  });
});

describe("week strip", () => {
  it("marks Monday to Sunday of today's week", () => {
    const week = streakWeek(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-05"], "2026-11-12");
    assert.deepEqual(week, [true, true, true, true, false, false, false]);
  });

  it("names the strip like the hub fixture", () => {
    assert.equal(streakAria(4, [true, true, true, true, false, false, false]), "4-day streak: trained Monday to Thursday");
    assert.equal(streakAria(365, [true, true, true, true, true, true, true]), "365-day streak: trained Monday to Sunday");
    assert.equal(streakAria(0, [false, false, false, false, false, false, false]), "No training yet this week");
    assert.equal(streakAria(2, [true, false, true, false, false, false, false]), "2-day streak: trained Monday and Wednesday");
    assert.equal(streakAria(1, [false, false, true, false, false, false, false]), "1-day streak: trained Wednesday");
    assert.equal(streakAria(3, [false, false, false, false, false, false, false]), "3-day streak: no training yet this week");
  });
});
