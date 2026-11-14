// The member's local training day (phase-05 plan §8.4): a session at 02:00 belongs to the previous day (Anki-style
// rollover at 04:00 by default). Day keys are what `training_days.day`, the cap counters, the streak and the plan are
// keyed by. Browser-safe and pure.
//
// The rollover is on the wall clock: the day changes when the local clock shows `dayStartHour`. The plan writes it as
// "the local date of now − dayStartHour hours", which is the same thing on every day except a DST change night,
// where subtracting real hours would roll over an hour early or late; the wall-clock rule keeps `dayKey` and
// `dayStart` exact inverses on those days too.
import { addDays, calendarDaysBetween, formatYmd, localParts, parseYmd, weekdayOf, zonedToUtc } from "./tz";

/** The training day `now` belongs to: the local date, or the day before while the local clock is before `dayStartHour`. */
export function dayKey(now: Date, timeZone: string, dayStartHour: number): string {
  const p = localParts(now, timeZone);
  return formatYmd(p.h < dayStartHour ? addDays(p, -1) : p);
}

/** `key` moved by `n` days. */
export function addDaysToKey(key: string, n: number): string {
  return formatYmd(addDays(parseYmd(key), n));
}

/** Whole days from day `a` to day `b` (b later → positive). */
export function daysBetween(a: string, b: string): number {
  return calendarDaysBetween(parseYmd(a), parseYmd(b));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOfKey(key: string): number {
  return weekdayOf(parseYmd(key));
}

/** The Monday of `key`'s local week. */
export function mondayOf(key: string): string {
  return addDaysToKey(key, -weekdayOfKey(key));
}

/** Monday → Sunday of `key`'s week. */
export function weekKeys(key: string): string[] {
  const monday = mondayOf(key);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
}

/**
 * The UTC instant training day `key` begins (its local `dayStartHour`). Services use it as the lower bound of "today"
 * (`reviewedAt >= dayStart(today)`) and of "this week" (`dayStart(monday)`).
 */
export function dayStart(key: string, timeZone: string, dayStartHour: number): Date {
  const { y, m, d } = parseYmd(key);
  return zonedToUtc(y, m, d, dayStartHour, 0, timeZone);
}

/** True when `at` falls inside training day `key`. */
export function isInDay(at: Date, key: string, timeZone: string, dayStartHour: number): boolean {
  return dayKey(at, timeZone, dayStartHour) === key;
}

// ── The day in progress across a zone or day-start change (FIX-1 tz-pin; plan §8.10, §7.3 W8, §12.2 R1) ─────────

/** The zone and day-start hour a stored training day was opened in (`training_days."timeZone"`, `"dayStartHour"`). */
export interface DayAnchor {
  day: string;
  timeZone: string;
  dayStartHour: number;
}

/** A training day and its UTC bounds `[start, end)`. */
export interface DayWindow {
  key: string;
  start: Date;
  end: Date;
}

const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
const earlier = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

function naturalWindow(at: Date, timeZone: string, dayStartHour: number): DayWindow {
  const key = dayKey(at, timeZone, dayStartHour);
  return { key, start: dayStart(key, timeZone, dayStartHour), end: dayStart(addDaysToKey(key, 1), timeZone, dayStartHour) };
}

/**
 * The training day `at` belongs to, given the newest stored day row and the zone it was opened in (`anchor`).
 *
 * With no anchor, or one opened under the current zone and day-start hour, this is `dayKey` in the current zone. After a
 * change, the anchored day keeps its key until it ends: it runs from its own start to the LATER of its end in the old
 * zone and its end in the new one, so the key never goes back (moving west lengthens the day) and the day in progress
 * never ends early (moving east keeps it until it ends where it began). After it, the new zone's days follow, the
 * first one starting where the anchored day ended. Before it (an offline replay of an older attempt), days are the
 * anchor's zone's. So a zone change mid-day keeps today's row: the used cap, the frozen plan and the streak stay
 * today's (a member flying east does not get a second day out of the same evening).
 */
export function trainingDayAt(at: Date, timeZone: string, dayStartHour: number, anchor: DayAnchor | null | undefined): DayWindow {
  if (!anchor || (anchor.timeZone === timeZone && anchor.dayStartHour === dayStartHour)) return naturalWindow(at, timeZone, dayStartHour);
  const aStart = dayStart(anchor.day, anchor.timeZone, anchor.dayStartHour);
  const next = addDaysToKey(anchor.day, 1);
  const aEnd = later(dayStart(next, anchor.timeZone, anchor.dayStartHour), dayStart(next, timeZone, dayStartHour));
  const t = at.getTime();
  if (t >= aStart.getTime() && t < aEnd.getTime()) return { key: anchor.day, start: aStart, end: aEnd };
  if (t >= aEnd.getTime()) {
    const n = naturalWindow(at, timeZone, dayStartHour);
    return { key: n.key, start: later(n.start, aEnd), end: n.end };
  }
  const before = naturalWindow(at, anchor.timeZone, anchor.dayStartHour);
  return { key: before.key, start: before.start, end: earlier(before.end, aStart) };
}

/** The anchor of a member's day rows: the newest one that records its zone (rows from before m5b record none). */
export function dayAnchorOf(rows: readonly { day: string; timeZone?: string | null; dayStartHour?: number | null }[]): DayAnchor | null {
  let best: DayAnchor | null = null;
  for (const r of rows) {
    if (!r.timeZone || r.dayStartHour === null || r.dayStartHour === undefined) continue;
    if (!best || r.day > best.day) best = { day: r.day, timeZone: r.timeZone, dayStartHour: Number(r.dayStartHour) };
  }
  return best;
}
