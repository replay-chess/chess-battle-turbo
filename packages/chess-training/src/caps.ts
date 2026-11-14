// The daily cap and the due counts shown (phase-05 plan §8.5; rct-b D6, §3.5), the "once a day" rescheduling rule and
// the puzzle fair-use limit. Pure: the caller passes today's counters and the instants it compares. Browser-safe.
import { DUE_GRACE_MS, PUZZLES_DAILY_LIMIT } from "./constants";
import { dayKey } from "./day";
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
