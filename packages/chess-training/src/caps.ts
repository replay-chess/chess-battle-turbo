// The daily cap and the due counts shown (phase-05 plan §8.5; rct-b D6, §3.5), the "once a day" rescheduling rule and
// the puzzle fair-use limit. Pure: the caller passes today's counters and the instants it compares. Browser-safe.
import { DUE_GRACE_MS, PUZZLES_DAILY_LIMIT } from "./constants";
import { addDaysToKey, dayKey, daysBetween, dayStart } from "./day";
import type { CardState } from "./mastery";

export interface CapInputs {
  /** `TrainingProfile.bankDailyCap` (default 10). */
  cap: number;
  /** `TrainingProfile.newPerDay` (default 5, inside the cap). */
  newPerDay: number;
  /** Today's `training_days.bankReviewed`. */
  bankReviewed: number;
  /** Today's `training_days.newIntroduced`. */
  newIntroduced: number;
  /** Due BANK cards not NEW (statement (a) `due_review`). */
  dueReview: number;
  /** Due BANK cards still NEW (statement (a) `due_new`). */
  dueNew: number;
}

export interface CapState {
  capRemaining: number;
  newRemaining: number;
  /** The due count the member sees ("4 due"). */
  dueShown: number;
  /** Due cards held back for later days by the cap. */
  waiting: number;
  /** Every due card, cap or not. */
  dueRaw: number;
}

/**
 * capRemaining = max(0, cap − reviewed); newRemaining = max(0, min(newPerDay − introduced, capRemaining));
 * dueShown = min(dueReview + min(dueNew, newRemaining), capRemaining); waiting = dueReview + dueNew − dueShown.
 */
export function capState(i: CapInputs): CapState {
  const capRemaining = Math.max(0, i.cap - i.bankReviewed);
  const newRemaining = Math.max(0, Math.min(i.newPerDay - i.newIntroduced, capRemaining));
  const dueShown = Math.min(i.dueReview + Math.min(i.dueNew, newRemaining), capRemaining);
  const dueRaw = i.dueReview + i.dueNew;
  return { capRemaining, newRemaining, dueShown, waiting: dueRaw - dueShown, dueRaw };
}

/** Cards that fall due after `now`: the instant they become due (a skipped card: its skip end) and whether NEW. */
export interface Arrival {
  at: Date;
  isNew: boolean;
  n: number;
}

export interface ServeInputs extends CapInputs {
  /** Future dues, any order (statement (a) `arrivals`). */
  arrivals: readonly Arrival[];
  now: Date;
  timeZone: string;
  dayStartHour: number;
  /** Today's training day key (the clock's: a zone change can pin it). */
  today: string;
  /**
   * The instant today's training day ends (the clock's `dayEndUtc`). A day pinned by a zone or day-start change
   * (`trainingDayAt`) can end later than the current zone's own rollover; the next day starts here, never earlier
   * (FIX-4, D-P6-FIX4-2). Default: the current zone's start of the next day.
   */
  todayEnd?: Date;
  /** Training days projected, today included (default 14: today and the 13 the bank's "Coming up" covers). */
  days?: number;
}

export interface ServedDay {
  /** 0 = the rest of today (after `dueShown`), 1 = tomorrow, … */
  offset: number;
  key: string;
  /** BANK reviews the due queue serves that day under the cap. */
  n: number;
  /** When the first of them can be served: the day's start for cards carried over, else the first arrival. */
  at: Date;
}

/**
 * The reviews each coming training day serves, as the due queue really serves them (§8.5, §8.6): every day at most
 * `cap` BANK reviews, NEW ones at most `newPerDay` of them; review cards before NEW ones; a card the cap holds back stays
 * due and is served first thing on a later day, with that day's arrivals. Today serves `dueShown` now and, while the cap
 * leaves room, the cards that fall due later today. It assumes the member reviews what each day serves (the cards a
 * review reschedules are not known yet, so they are not counted). Every "next batch" and "Coming up" number comes
 * from here, so none of them can promise more than the cap.
 */
export function servedByDay(i: ServeInputs): ServedDay[] {
  const now = i.now.getTime();
  const days = i.days ?? 14;
  const today = capState(i);
  const shownReviews = Math.min(i.dueReview, today.capRemaining);
  const shownNew = today.dueShown - shownReviews;
  let reviews = i.dueReview - shownReviews;
  let fresh = i.dueNew - shownNew;
  // The training days are the clock's (FIX-4, D-P6-FIX4-2): today runs until `todayEnd` (a pinned day can outlast the
  // zone's own rollover), every later day is the current zone's and starts no earlier than `todayEnd`. So an arrival
  // before `todayEnd` is today's, and no day after today can start (or be labelled) before today has ended.
  const todayEnd = (i.todayEnd ?? dayStart(addDaysToKey(i.today, 1), i.timeZone, i.dayStartHour)).getTime();
  const offsetOf = (at: Date) => (at.getTime() < todayEnd ? 0 : Math.max(1, daysBetween(i.today, dayKey(at, i.timeZone, i.dayStartHour))));
  const startOf = (key: string) => new Date(Math.max(dayStart(key, i.timeZone, i.dayStartHour).getTime(), todayEnd));
  const byDay = new Map<number, Arrival[]>();
  for (const a of i.arrivals) {
    if (a.n <= 0 || a.at.getTime() <= now) continue;
    const d = offsetOf(a.at);
    if (d < days) byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  const out: ServedDay[] = [];
  for (let d = 0; d < days; d++) {
    const capLeft = d === 0 ? today.capRemaining - today.dueShown : i.cap;
    const newLeft = d === 0 ? today.newRemaining - shownNew : Math.max(0, Math.min(i.newPerDay, i.cap));
    const carried = d > 0 && Math.min(reviews + Math.min(fresh, newLeft), capLeft) > 0;
    const arrivals = [...(byDay.get(d) ?? [])].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const a of arrivals) {
      if (a.isNew) fresh += a.n;
      else reviews += a.n;
    }
    const takeReviews = Math.min(reviews, Math.max(0, capLeft));
    const takeNew = Math.min(fresh, Math.max(0, newLeft), Math.max(0, capLeft - takeReviews));
    reviews -= takeReviews;
    fresh -= takeNew;
    const n = takeReviews + takeNew;
    if (n === 0) continue;
    const key = addDaysToKey(i.today, d);
    const first = arrivals.find((a) => !a.isNew || takeNew > 0) ?? arrivals[0];
    out.push({ offset: d, key, n, at: carried || !first ? startOf(key) : first.at });
  }
  return out;
}

/** "6 more wait for later days. FSRS keeps it to 10 a day." while the cap holds cards back (null otherwise). */
export function waitingLine(s: CapState, cap: number): string | null {
  if (s.capRemaining === 0 && s.dueRaw > 0) return capReachedLine(cap, s.dueRaw);
  if (s.waiting <= 0) return null;
  return `${s.waiting} more wait for later days. FSRS keeps it to ${cap} a day.`;
}

/** The caught-up line when the cap is used up: "You reviewed today's 10 positions. 6 more wait for tomorrow." */
export function capReachedLine(cap: number, waiting: number): string {
  return `You reviewed today's ${cap} positions. ${waiting} more wait for tomorrow.`;
}

/**
 * Counter increments of one graded attempt (§8.5 "Counted"): +1 `bankReviewed` on the first FSRS grade of a BANK card
 * today in a session that counts toward the cap, +1 `newIntroduced` when that card was NEW. Explicit picks, practice
 * and the PUZZLE deck bypass the cap; a pass-2 copy never counts again.
 */
export function capIncrements(a: {
  deck: "BANK" | "PUZZLE" | "OPENING";
  countsTowardCap: boolean;
  scheduled: boolean;
  /** No earlier FSRS grade of this card today. */
  firstGradeToday: boolean;
  pass: 1 | 2;
  stateBefore: CardState;
}): { bankReviewed: number; newIntroduced: number } {
  if (a.deck !== "BANK" || !a.countsTowardCap || !a.scheduled || !a.firstGradeToday || a.pass !== 1) {
    return { bankReviewed: 0, newIntroduced: 0 };
  }
  return { bankReviewed: 1, newIntroduced: a.stateBefore === "NEW" ? 1 : 0 };
}

export interface ScheduledInputs {
  state: CardState;
  due: Date;
  lastReview: Date | null;
  reviewedAt: Date;
  /** "Solve this one", "Drill these 3", `?game=`: an explicit pick. */
  explicitPick: boolean;
  /** A PRACTICE session ("Start Again"): never reschedules. */
  practice: boolean;
  timeZone: string;
  dayStartHour: number;
}

/**
 * The "once a day" rule (§8.5): an attempt reschedules the card iff the card is due (`due ≤ reviewedAt + 1 h`), or
 * it is NEW/LEARNING/RELEARNING (short-term steps, the Again re-queue), or it is an explicit pick not reviewed yet
 * today. Otherwise the attempt is logged as practice (grade kept, `scheduledDays` null, card untouched).
 */
export function isScheduled(i: ScheduledInputs): boolean {
  if (i.practice) return false;
  if (i.state !== "REVIEW") return true;
  if (i.due.getTime() <= i.reviewedAt.getTime() + DUE_GRACE_MS) return true;
  if (i.explicitPick) {
    if (!i.lastReview) return true;
    return dayKey(i.lastReview, i.timeZone, i.dayStartHour) !== dayKey(i.reviewedAt, i.timeZone, i.dayStartHour);
  }
  return false;
}

/** Fair use (§8.5): a create/extend that would pass the daily puzzle limit answers 429; attempts are never rejected. */
export function exceedsPuzzleLimit(puzzlesDone: number, requested: number, limit: number = PUZZLES_DAILY_LIMIT): boolean {
  return puzzlesDone + requested > limit;
}
