// caps.ts: the cap formulas, the new-card sub-cap, the counters an attempt adds, the "once a day" rule and the puzzle
// fair-use limit (phase-05 plan §8.5, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { capIncrements, capReachedLine, capState, exceedsPuzzleLimit, isScheduled, waitingLine, type ScheduledInputs } from "./caps";

const base = { cap: 10, newPerDay: 5, bankReviewed: 0, newIntroduced: 0, dueReview: 0, dueNew: 0 };

describe("capState", () => {
  it("shows everything due when it fits under the cap", () => {
    assert.deepEqual(capState({ ...base, dueReview: 3, dueNew: 1 }), { capRemaining: 10, newRemaining: 5, dueShown: 4, waiting: 0, dueRaw: 4 });
  });

  it("holds NEW cards back beyond the new-card sub-cap", () => {
    const s = capState({ ...base, dueReview: 2, dueNew: 9 });
    assert.equal(s.newRemaining, 5);
    assert.equal(s.dueShown, 7);
    assert.equal(s.waiting, 4);
  });

  it("counts today's new intake against the sub-cap", () => {
    const s = capState({ ...base, newIntroduced: 4, dueNew: 3 });
    assert.equal(s.newRemaining, 1);
    assert.equal(s.dueShown, 1);
    assert.equal(s.waiting, 2);
  });

  it("caps the total at the daily cap minus today's reviews", () => {
    const s = capState({ ...base, bankReviewed: 6, dueReview: 9, dueNew: 3 });
    assert.equal(s.capRemaining, 4);
    assert.equal(s.newRemaining, 4, "the sub-cap never exceeds what the cap leaves");
    assert.equal(s.dueShown, 4);
    assert.equal(s.waiting, 8);
  });

  it("reaches zero and never goes negative", () => {
    const s = capState({ ...base, bankReviewed: 12, newIntroduced: 7, dueReview: 6 });
    assert.deepEqual(s, { capRemaining: 0, newRemaining: 0, dueShown: 0, waiting: 6, dueRaw: 6 });
  });

  it("matches the hub fixture: 61 due, cap 10 → 10 shown, 51 waiting", () => {
    const s = capState({ ...base, dueReview: 56, dueNew: 5 });
    assert.equal(s.dueShown, 10);
    assert.equal(waitingLine(s, 10), "51 more wait for later days. FSRS keeps it to 10 a day.");
  });

  it("words the caught-up line when the cap is used up", () => {
    const s = capState({ ...base, bankReviewed: 10, dueReview: 6 });
    assert.equal(waitingLine(s, 10), "You reviewed today's 10 positions. 6 more wait for tomorrow.");
    assert.equal(capReachedLine(10, 6), "You reviewed today's 10 positions. 6 more wait for tomorrow.");
    assert.equal(waitingLine(capState({ ...base, dueReview: 3 }), 10), null);
  });
});

describe("capIncrements", () => {
  const a = { deck: "BANK" as const, countsTowardCap: true, scheduled: true, firstGradeToday: true, pass: 1 as const, stateBefore: "REVIEW" as const };

  it("counts the first FSRS grade of a BANK card today, and NEW intake", () => {
    assert.deepEqual(capIncrements(a), { bankReviewed: 1, newIntroduced: 0 });
    assert.deepEqual(capIncrements({ ...a, stateBefore: "NEW" }), { bankReviewed: 1, newIntroduced: 1 });
  });

  it("bypasses explicit picks and practice (no countsTowardCap), the PUZZLE deck, unscheduled and repeat grades, pass 2", () => {
    const zero = { bankReviewed: 0, newIntroduced: 0 };
    assert.deepEqual(capIncrements({ ...a, countsTowardCap: false }), zero);
    assert.deepEqual(capIncrements({ ...a, deck: "PUZZLE" }), zero);
    assert.deepEqual(capIncrements({ ...a, scheduled: false }), zero);
    assert.deepEqual(capIncrements({ ...a, firstGradeToday: false }), zero);
    assert.deepEqual(capIncrements({ ...a, pass: 2 }), zero);
  });
});

describe("isScheduled (the once-a-day rule)", () => {
  const at = new Date("2026-11-12T19:00:00Z");
  const card: ScheduledInputs = {
    state: "REVIEW",
    due: new Date("2026-11-12T08:00:00Z"),
    lastReview: new Date("2026-11-08T19:00:00Z"),
    reviewedAt: at,
    explicitPick: false,
    practice: false,
    timeZone: "UTC",
    dayStartHour: 4,
  };

  it("reschedules a due card", () => {
    assert.equal(isScheduled(card), true);
  });

  it("reschedules a card due within the next hour (grace)", () => {
    assert.equal(isScheduled({ ...card, due: new Date("2026-11-12T19:59:00Z") }), true);
    assert.equal(isScheduled({ ...card, due: new Date("2026-11-12T20:01:00Z") }), false);
  });

  it("always reschedules NEW, LEARNING and RELEARNING cards (short-term steps, the Again re-queue)", () => {
    for (const state of ["NEW", "LEARNING", "RELEARNING"] as const) {
      assert.equal(isScheduled({ ...card, state, due: new Date("2026-11-20T08:00:00Z") }), true, state);
    }
  });

  it("reschedules an explicit pick that was not reviewed today, once", () => {
    const notDue = { ...card, due: new Date("2026-11-20T08:00:00Z"), explicitPick: true };
    assert.equal(isScheduled(notDue), true);
    assert.equal(isScheduled({ ...notDue, lastReview: new Date("2026-11-12T10:00:00Z") }), false, "already reviewed today");
    // 03:00 belongs to yesterday's training day (day start 04:00): a review then does not block today's.
    assert.equal(isScheduled({ ...notDue, lastReview: new Date("2026-11-12T03:00:00Z") }), true);
  });

  it("logs a not-due, not-picked card as practice", () => {
    assert.equal(isScheduled({ ...card, due: new Date("2026-11-20T08:00:00Z") }), false);
  });

  it("never reschedules in a PRACTICE session", () => {
    assert.equal(isScheduled({ ...card, practice: true }), false);
    assert.equal(isScheduled({ ...card, state: "NEW", practice: true }), false);
  });
});

describe("puzzle fair use", () => {
  it("refuses a create or extend that would pass 400 a day", () => {
    assert.equal(exceedsPuzzleLimit(390, 10), false);
    assert.equal(exceedsPuzzleLimit(391, 10), true);
    assert.equal(exceedsPuzzleLimit(0, 10, 5), true);
  });
});
