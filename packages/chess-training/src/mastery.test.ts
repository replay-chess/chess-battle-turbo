// mastery.ts: card dots, theme EWMA, "New" below 5 attempts and one-time milestones (phase-05 plan §8.8, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { masteryAria } from "./labels";
import { applyThemeAttempt, EMPTY_THEME_MASTERY, isPerfectSession, masteryOf, themePct, type ThemeMasteryState } from "./mastery";

describe("masteryOf", () => {
  it("gives 0 dots while not in review", () => {
    for (const state of ["NEW", "LEARNING", "RELEARNING"] as const) assert.equal(masteryOf(state, 50), 0, state);
  });

  it("buckets stability at 4, 10, 30 and 90 days", () => {
    const cases: [number, number][] = [
      [0.5, 1],
      [3.99, 1],
      [4, 2],
      [9.99, 2],
      [10, 3],
      [29.99, 3],
      [30, 4],
      [89.99, 4],
      [90, 5],
      [400, 5],
    ];
    for (const [s, dots] of cases) assert.equal(masteryOf("REVIEW", s), dots, `S = ${s}`);
  });

  it("names the dots for screen readers", () => {
    assert.equal(masteryAria(2), "Mastery 2 of 5");
  });
});

describe("theme mastery", () => {
  const run = (results: boolean[], from: ThemeMasteryState = EMPTY_THEME_MASTERY) => {
    let s = from;
    const milestones: number[] = [];
    for (const r of results) {
      const next = applyThemeAttempt(s, r);
      if (next.milestone) milestones.push(next.milestone);
      s = { attempts: next.attempts, firstTry: next.firstTry, ewma: next.ewma, milestonePct: next.milestonePct };
    }
    return { s, milestones };
  };

  it("moves the EWMA by α = 0.15 and counts attempts and first tries", () => {
    const a = applyThemeAttempt(EMPTY_THEME_MASTERY, true);
    assert.ok(Math.abs(a.ewma - 0.15) < 1e-12);
    assert.deepEqual([a.attempts, a.firstTry], [1, 1]);
    const b = applyThemeAttempt({ attempts: 1, firstTry: 1, ewma: 0.15, milestonePct: 0 }, false);
    assert.ok(Math.abs(b.ewma - 0.1275) < 1e-12);
    assert.deepEqual([b.attempts, b.firstTry], [2, 1]);
  });

  it("shows New below 5 attempts, then round(100 · ewma)", () => {
    assert.equal(themePct({ attempts: 4, ewma: 0.9 }), null);
    assert.equal(themePct({ attempts: 5, ewma: 0.556 }), 56);
    assert.equal(themePct({ attempts: 20, ewma: 1 }), 100);
  });

  it("fires 50 then 70 once each as the EWMA climbs", () => {
    const { s, milestones } = run(Array(12).fill(true));
    assert.deepEqual(milestones, [50, 70]);
    assert.equal(s.milestonePct, 70);
  });

  it("never fires 70 again after dropping below it and climbing back", () => {
    const climb = run(Array(8).fill(true));
    assert.ok(climb.milestones.includes(70));
    const drop = run(Array(6).fill(false), climb.s);
    assert.ok(drop.s.ewma < 0.5);
    assert.deepEqual(drop.milestones, []);
    const back = run(Array(8).fill(true), drop.s);
    assert.ok(back.s.ewma >= 0.7);
    assert.deepEqual(back.milestones, [], "70 already announced; the 90 mark is not reached in 8 attempts");
    const higher = run(Array(10).fill(true), back.s);
    assert.deepEqual(higher.milestones, [90]);
  });

  it("does not announce a milestone before 5 attempts", () => {
    const { milestones } = run([true, true, true, true], { attempts: 0, firstTry: 0, ewma: 0.6, milestonePct: 0 });
    assert.deepEqual(milestones, []);
  });

  it("recognises a perfect session", () => {
    assert.equal(isPerfectSession({ total: 10, firstTry: 10, skipped: 0 }), true);
    assert.equal(isPerfectSession({ total: 10, firstTry: 9, skipped: 0 }), false);
    assert.equal(isPerfectSession({ total: 10, firstTry: 10, skipped: 1 }), false);
    assert.equal(isPerfectSession({ total: 0, firstTry: 0, skipped: 0 }), false);
  });
});
