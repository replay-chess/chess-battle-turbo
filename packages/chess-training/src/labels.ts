// Time and count labels, formatted on the server in the member's zone so SSR and hydration agree (phase-05 plan
// §8.14, §8.2). Browser-safe (a /labels subpath): no ts-fsrs, no Node built-ins, English names from fixed tables
// (the runtime's Intl locale data never changes a label). Every function takes the instants it compares.
import { MIN_PER_BANK_ITEM, MIN_PER_PUZZLE, MIN_PER_WEAKNESS_ITEM } from "./constants";
import { dayKey } from "./day";
import { calendarDaysBetween, formatYmd, localDate, localParts, parseYmd, weekdayOf, type YMD } from "./tz";

export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Nov 6". */
export function monthDayLabel(date: YMD): string {
  return `${MONTHS_SHORT[date.m - 1]} ${date.d}`;
}

/**
 * An interval as the grade buttons show it (§8.2): under an hour in minutes ("< 10 min" up to 10, "15 min"), then
 * hours ("3 h"), "1 day", "{n} days", "{n} weeks" from 14 days, "{n} months" from 60 days.
 */
export function intervalLabel(days: number): string {
  if (days < 1) {
    const minutes = Math.max(0, Math.round(days * 1440));
    if (minutes <= 10) return "< 10 min";
    if (minutes < 60) return `${minutes} min`;
    return `${Math.round(minutes / 60)} h`;
  }
  const d = Math.round(days);
  if (d < 2) return "1 day";
  if (d < 14) return `${d} days`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  return `${Math.round(d / 30)} months`;
}

/**
 * Day-word options: `long` weekdays; `dayStartHour`, the member's training-day start (0 = the calendar day); `todayKey`,
 * the training day `now` belongs to when the caller holds it (R1's `dayKey`: a day opened under the member's previous
 * zone or day start keeps its key until it ends, `trainingDayAt`), else the day of `now` in `timeZone`.
 */
export type DayWordOptions = { long?: boolean; dayStartHour?: number; todayKey?: string };

/**
 * When a card or a training day comes, from the member's side (§8.14), as a word WITHOUT a clock time: the current
 * day (or overdue) "Today", within 6 days the weekday ("Sat"; `long` → "Saturday" for the caught-up list), else
 * "Nov 6".
 *
 * Without `dayStartHour` the words are calendar days. With it (browser pass D4, P5-FZ-4) the target is the member's
 * TRAINING day (the hub's header, the plan, the cap and the streak live on it), but FIX-5 (item B, D-P6-FIX5-2) words
 * it by the member's CALENDAR at `now`, so a weekday that has already ended on the member's clock is never named: the
 * current training day (`todayKey`, else the day of `now`; a day pinned by a zone change keeps its key) is "Today";
 * a later training day that starts on today's calendar date is "Later today" (between local midnight and the
 * training-day rollover: at 01:00 Sunday, Sunday's day and its 08:00 cards come "later today", not "tomorrow"); the
 * next calendar date's day is "Tomorrow", and so on. A word WITH a clock time uses the calendar date of that instant
 * (`releaseLabel`, `clockDayLabel`): "today at 09:30".
 */
export function dayLabel(due: Date, now: Date, timeZone: string, opts: DayWordOptions = {}): string {
  if (opts.dayStartHour === undefined || (opts.dayStartHour === 0 && opts.todayKey === undefined)) {
    return dayKeyLabel(dayKey(due, timeZone, 0), dayKey(now, timeZone, 0), opts);
  }
  const start = opts.dayStartHour;
  return trainingDayLabel(dayKey(due, timeZone, start), opts.todayKey ?? dayKey(now, timeZone, start), formatYmd(localDate(now, timeZone)), opts);
}

/**
 * FIX-5 (item B): training day `key` worded on the member's calendar: `todayKey` = the clock's training day,
 * `calendarKey` = the calendar date of now in the member's zone (`dayLabel`'s rule; the bank's "Coming up" rows).
 */
export function trainingDayLabel(key: string, todayKey: string, calendarKey: string, opts: Pick<DayWordOptions, "long"> = {}): string {
  if (key <= todayKey) return "Today";
  if (key <= calendarKey) return "Later today";
  return dayKeyLabel(key, calendarKey, opts);
}

/** A clock time's day word (FIX-5 item B): the calendar date of `at` in the member's zone against now's ("today"). */
export function clockDayLabel(at: Date, now: Date, timeZone: string, opts: Pick<DayWordOptions, "long"> = {}): string {
  return dayKeyLabel(dayKey(at, timeZone, 0), dayKey(now, timeZone, 0), opts);
}

/** A day word mid-sentence: "today", "later today", "tomorrow" lower-cased; weekdays and dates as they are. */
export function dayWordInSentence(label: string): string {
  return label === "Today" || label === "Tomorrow" || label === "Later today" ? label.toLowerCase() : label;
}

/**
 * The day word of day `key` seen from day `todayKey`: same day (or before) "Today", the next "Tomorrow", within 6
 * days the weekday, else "Nov 6".
 */
export function dayKeyLabel(key: string, todayKey: string, opts: Pick<DayWordOptions, "long"> = {}): string {
  const target = parseYmd(key);
  const diff = calendarDaysBetween(parseYmd(todayKey), target);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 6) return (opts.long ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[weekdayOf(target)]!;
  return monthDayLabel(target);
}

/** When a game was played: "today", "yesterday", else "Oct 27" (§8.14; bank rows and plan titles). */
export function playedAtLabel(at: Date, now: Date, timeZone: string): string {
  const date = localDate(at, timeZone);
  const diff = calendarDaysBetween(date, localDate(now, timeZone));
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return monthDayLabel(date);
}

/** "morning" 05:00–11:59, "afternoon" 12:00–17:59, else "evening" (Home greeting). */
export function greetingPart(now: Date, timeZone: string): "morning" | "afternoon" | "evening" {
  const h = localParts(now, timeZone).h;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening";
}

/** "08:00" (24-hour `HH:mm`, the design's clock format). */
export function atLabel(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${pad2(p.h)}:${pad2(p.min)}`;
}

/**
 * When the next batch arrives, for a sentence: "today at 08:00", "tomorrow at 08:00", "Sat at 08:00", "Nov 6 at 08:00"
 * (the day word as `dayLabel`, on the training day when `dayStartHour` is given).
 */
export function releaseLabel(at: Date, now: Date, timeZone: string): string {
  // FIX-5 (item B): a clock time is worded by its calendar date ("today at 09:30" at 06:11 the same morning), whatever
  // training day it falls in.
  const day = clockDayLabel(at, now, timeZone);
  const lead = day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day;
  return `${lead} at ${atLabel(at, timeZone)}`;
}

/** "Thursday" for a day key. */
export function weekdayLabel(key: string, opts: { short?: boolean } = {}): string {
  return (opts.short ? WEEKDAYS_SHORT : WEEKDAYS_LONG)[weekdayOf(parseYmd(key))]!;
}

/** "~2 min" (estimates in plan subtitles and CTAs). */
export function minutesLabel(minutes: number): string {
  return `~${Math.max(1, Math.round(minutes))} min`;
}

/** Rounded minutes for a number of items (§8.6): 0.75 per bank item, 1.3 per puzzle, 0.5 per weakness item; min 1. */
export function estimateMinutes(items: { bank?: number; puzzles?: number; weakness?: number; lessonSec?: number }): number {
  const raw =
    (items.bank ?? 0) * MIN_PER_BANK_ITEM +
    (items.puzzles ?? 0) * MIN_PER_PUZZLE +
    (items.weakness ?? 0) * MIN_PER_WEAKNESS_ITEM +
    (items.lessonSec ?? 0) / 60;
  return raw <= 0 ? 0 : Math.max(1, Math.round(raw));
}

/** "Mastery 2 of 5" (the dots' accessible name, §8.8). */
export function masteryAria(mastery: number): string {
  return `Mastery ${mastery} of 5`;
}

/** "1 mistake" / "3 mistakes". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
