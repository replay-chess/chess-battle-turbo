// Time and count labels, formatted on the server in the member's zone so SSR and hydration agree (phase-05 plan
// §8.14, §8.2). Browser-safe (a /labels subpath): no ts-fsrs, no Node built-ins, English names from fixed tables
// (the runtime's Intl locale data never changes a label). Every function takes the instants it compares.
import { MIN_PER_BANK_ITEM, MIN_PER_PUZZLE, MIN_PER_WEAKNESS_ITEM } from "./constants";
import { dayKey } from "./day";
import { calendarDaysBetween, localDate, localParts, parseYmd, weekdayOf, type YMD } from "./tz";

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
 * When a card is due, from the member's side (§8.14): same day (or overdue) "Today", next day "Tomorrow", within 6
 * days the weekday ("Sat"; `long` → "Saturday" for the caught-up list), else "Nov 6".
 *
 * "Day" is the member's training day when `dayStartHour` is given (browser pass D4, P5-FZ-4): the Train hub's header,
 * the plan, the cap and the streak all live on the training day (a 01:00 Sunday visit is still Saturday's), so a batch
 * released at 08:00 Sunday is "tomorrow" there, not "today". Without it (0) the calendar day, as before.
 *
 * With `todayKey` the words count from that day, so they agree with a header that names it: at 04:07 Sunday after a
 * zone change the hub's day is still Saturday (pinned), and its 08:00 Sunday batch is "tomorrow" next to "SATURDAY"
 * (regression: hub-pinned-day-words; it read "today").
 */
export function dayLabel(due: Date, now: Date, timeZone: string, opts: DayWordOptions = {}): string {
  const start = opts.dayStartHour ?? 0;
  return dayKeyLabel(dayKey(due, timeZone, start), opts.todayKey ?? dayKey(now, timeZone, start), opts);
}

/**
 * The day word of training day `key` seen from training day `todayKey` (`dayLabel`'s words). FIX-4 (D-P6-FIX4-2): the
 * next batch is labelled from the day it is served on (`servedByDay`'s key), which a pinned day can make differ from
 * the calendar day of its instant.
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
export function releaseLabel(at: Date, now: Date, timeZone: string, opts: Pick<DayWordOptions, "dayStartHour" | "todayKey"> = {}): string {
  const day = dayLabel(at, now, timeZone, opts);
  const lead = day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day;
  return `${lead} at ${atLabel(at, timeZone)}`;
}

/** "tomorrow at 08:00" for an instant served on training day `key`, seen from training day `todayKey` (FIX-4). */
export function releaseLabelOfDay(at: Date, timeZone: string, key: string, todayKey: string): string {
  const day = dayKeyLabel(key, todayKey);
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
