// caps.ts: the cap formulas, the new-card sub-cap, the counters an attempt adds, the "once a day" rule and the puzzle
// fair-use limit (phase-05 plan §8.5, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { capIncrements, capReachedLine, capState, exceedsPuzzleLimit, isScheduled, servedByDay, waitingLine, type ScheduledInputs } from "./caps";

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

describe("servedByDay (staging fix: every next-batch count respects the cap)", () => {
  const now = new Date("2026-11-12T06:00:00.000Z");
  const at8 = (d: number) => new Date(Date.UTC(2026, 10, 12 + d, 8));
  const proj = (o: Partial<Parameters<typeof servedByDay>[0]>) =>
    servedByDay({ ...base, arrivals: [], now, timeZone: "UTC", dayStartHour: 4, today: "2026-11-12", ...o }).map((d) => [d.offset, d.n, d.at.toISOString()]);

  it("today's room takes the cards released later today; the rest come tomorrow from the day's start, then with the release", () => {
    assert.deepEqual(proj({ dueReview: 4, arrivals: [{ at: at8(0), isNew: false, n: 20 }, { at: at8(2), isNew: false, n: 3 }] }), [
      [0, 6, "2026-11-12T08:00:00.000Z"],
      [1, 10, "2026-11-13T04:00:00.000Z"],
      [2, 7, "2026-11-14T04:00:00.000Z"],
    ]);
  });

  it("reviews come before NEW cards, and NEW ones stay within newPerDay", () => {
    assert.deepEqual(proj({ bankReviewed: 10, arrivals: [{ at: at8(1), isNew: true, n: 8 }, { at: at8(1), isNew: false, n: 7 }] }), [
      [1, 10, "2026-11-13T08:00:00.000Z"],
      [2, 5, "2026-11-14T04:00:00.000Z"],
    ]);
  });

  it("regression: bank-next-batch-past (FIX-4 item 2) — a day pinned past the zone's rollover: the next batch starts when it ends, never before now", () => {
    // Saturday 2026-11-14 was opened in UTC; the member then moved to Asia/Calcutta. At 23:12Z (04:42 IST Sunday) the
    // clock's day is still Saturday until 04:00Z (09:30 IST); staging labelled the held-back cards "today 04:00"
    // (22:30Z: the IST day start, already past).
    const at = new Date("2026-11-14T23:12:00.000Z");
    const end = new Date("2026-11-15T04:00:00.000Z");
    const pinned = (o: Partial<Parameters<typeof servedByDay>[0]>) =>
      servedByDay({ ...base, dueReview: 125, arrivals: [], now: at, timeZone: "Asia/Calcutta", dayStartHour: 4, today: "2026-11-14", todayEnd: end, ...o });
    const days = pinned({});
    assert.equal(days[0]!.key, "2026-11-15");
    assert.equal(days[0]!.offset, 1);
    assert.equal(days[0]!.at.toISOString(), end.toISOString(), "Sunday starts where Saturday ends (09:30 IST)");
    assert.ok(days.every((d) => d.at.getTime() > at.getTime()), "no batch in the past");
    // An arrival at 08:00 IST Sunday (02:30Z) falls in the pinned Saturday: today's, while the cap leaves room.
    const room = pinned({ dueReview: 0, arrivals: [{ at: new Date("2026-11-15T02:30:00.000Z"), isNew: false, n: 3 }] });
    assert.deepEqual(room.map((d) => [d.offset, d.key, d.n, d.at.toISOString()]), [[0, "2026-11-14", 3, "2026-11-15T02:30:00.000Z"]]);
    // Every instant around both rollovers: a batch is never before the instant, and a later day never starts before
    // the clock's day ends.
    for (const iso of ["2026-11-14T22:29:00Z", "2026-11-14T22:31:00Z", "2026-11-15T02:29:00Z", "2026-11-15T03:59:00Z"]) {
      const t = new Date(iso);
      for (const d of pinned({ now: t, arrivals: [{ at: new Date("2026-11-15T02:30:00.000Z"), isNew: false, n: 2 }] })) {
        assert.ok(d.at.getTime() > t.getTime(), `${iso}: ${d.key} at ${d.at.toISOString()}`);
        if (d.offset > 0) assert.ok(d.at.getTime() >= end.getTime(), `${iso}: day ${d.key} starts after the pinned day`);
      }
    }
    // Unpinned (no todayEnd): the zone's own days, as before.
    const natural = servedByDay({ ...base, dueReview: 125, arrivals: [], now: new Date("2026-11-15T00:00:00.000Z"), timeZone: "Asia/Calcutta", dayStartHour: 4, today: "2026-11-15" });
    assert.equal(natural[0]!.at.toISOString(), "2026-11-15T22:30:00.000Z");
  });

  it("nothing due and nothing ahead: no day; arrivals past the window or already due are not arrivals", () => {
    assert.deepEqual(proj({}), []);
    assert.deepEqual(proj({ arrivals: [{ at: at8(20), isNew: false, n: 3 }, { at: new Date(now.getTime() - 1), isNew: false, n: 3 }] }), []);
  });
});

describe("FIX-6 (item 1): cards graded today do not use the cap again", () => {
  it("capState shows them on top of today's capped work", () => {
    // The cap is used (10 reviewed); 10 cards graded Again today are due (4 now, 6 later today): 10 left, none capped.
    assert.equal(capState({ ...base, bankReviewed: 10, dueReview: 30, dueAgain: 4, againLater: 6 }).dueShown, 10);
    // 3 reviewed, 3 of the due reviews were graded today: 3 + min(27, 7) = 10.
    assert.equal(capState({ ...base, bankReviewed: 3, dueReview: 30, dueAgain: 3 }).dueShown, 10);
    assert.equal(capState({ ...base, bankReviewed: 3, dueReview: 30 }).dueShown, 7, "without them: the cap's 7");
  });
});
