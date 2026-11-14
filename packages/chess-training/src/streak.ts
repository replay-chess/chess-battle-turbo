// Day streak (phase-05 plan §8.9, Q13, owner decision D-4): a trained day has at least one graded attempt; one
// missed day is forgiven ("resets if you skip 2 days"). Pure: the caller passes the attempt's training day and
// today's key (`day.ts`), so nothing here reads the clock. Browser-safe.
import { STREAK_MAX_GAP_DAYS } from "./constants";
import { daysBetween, weekKeys } from "./day";
import { WEEKDAYS_LONG } from "./labels";

/** The streak fields of `training_profiles` (`lastActiveDay` as a day key). */
export interface StreakState {
  dayStreak: number;
  dayStreakBest: number;
  lastActiveDay: string | null;
}

/**
 * The streak after a graded attempt on training day `day`: the same or an earlier day (a late offline replay) changes
 * nothing; a gap of 1 or 2 days adds one; a longer gap, or no earlier day, restarts at 1.
 */
export function applyStreak(profile: StreakState, day: string): StreakState {
  if (profile.lastActiveDay === null) {
    return { dayStreak: 1, dayStreakBest: Math.max(profile.dayStreakBest, 1), lastActiveDay: day };
  }
  const gap = daysBetween(profile.lastActiveDay, day);
  if (gap <= 0) return profile;
  const dayStreak = gap <= STREAK_MAX_GAP_DAYS ? profile.dayStreak + 1 : 1;
  return { dayStreak, dayStreakBest: Math.max(profile.dayStreakBest, dayStreak), lastActiveDay: day };
}

/** The streak shown today: the stored streak while the last active day is at most 2 days back, else 0. */
export function displayedStreak(profile: Pick<StreakState, "dayStreak" | "lastActiveDay">, today: string): number {
  if (profile.lastActiveDay === null) return 0;
  return daysBetween(profile.lastActiveDay, today) <= STREAK_MAX_GAP_DAYS ? profile.dayStreak : 0;
}

/** True when this attempt sets a new best (the summary's `streak` milestone). */
export function isNewBestStreak(before: StreakState, after: StreakState): boolean {
  return after.dayStreak > before.dayStreakBest && after.dayStreak > 1;
}

/** Monday → Sunday of today's week: trained that day (from the `training_days` rows with any activity). */
export function streakWeek(trainedDays: Iterable<string>, today: string): boolean[] {
  const set = new Set(trainedDays);
  return weekKeys(today).map((k) => set.has(k));
}

/** The streak block's accessible name: "4-day streak: trained Monday to Thursday", "No training yet this week". */
export function streakAria(current: number, week: readonly boolean[]): string {
  const days = week.flatMap((on, i) => (on ? [WEEKDAYS_LONG[i]!] : []));
  if (current === 0 && days.length === 0) return "No training yet this week";
  const head = `${current}-day streak`;
  if (days.length === 0) return `${head}: no training yet this week`;
  const first = week.indexOf(true);
  const last = week.lastIndexOf(true);
  const contiguous = days.length === last - first + 1;
  if (days.length === 1) return `${head}: trained ${days[0]}`;
  if (contiguous) return `${head}: trained ${WEEKDAYS_LONG[first]} to ${WEEKDAYS_LONG[last]}`;
  return `${head}: trained ${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
}
