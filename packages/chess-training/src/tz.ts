// Time-zone arithmetic with `Intl.DateTimeFormat` only (phase-05 plan §8.4; interface check §0.15: no tz library).
// Browser-safe and pure: every function takes the instant it works on, nothing reads the clock.
//
// `zonedToUtc` resolves a local wall time to an instant. Ordinary times have one answer. A time that occurs twice
// (the fall-back hour) resolves to the EARLIER instant; a time that does not exist (inside a spring-forward gap)
// resolves to the first valid instant after the gap, i.e. the transition itself (America/New_York 2026-03-08 02:30
// → 03:00 EDT). The plan's "two-pass offset correction" finds the ordinary answer; the two extra checks handle the
// ambiguous and the missing cases, which the two-pass method alone gets wrong for zones east of UTC.

export interface YMD {
  y: number;
  /** 1–12 */
  m: number;
  /** 1–31 */
  d: number;
}

export interface LocalParts extends YMD {
  /** 0–23 */
  h: number;
  min: number;
  s: number;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when `Intl` knows the zone (IANA names, `UTC`, `Etc/*`). */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Weekday of a calendar date, 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: YMD): number {
  return (new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay() + 6) % 7;
}

/** The wall-clock fields of `instant` in `timeZone`. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  let y = 0;
  let m = 0;
  let d = 0;
  let h = 0;
  let min = 0;
  let s = 0;
  for (const p of parts) {
    switch (p.type) {
      case "year":
        y = Number(p.value);
        break;
      case "month":
        m = Number(p.value);
        break;
      case "day":
        d = Number(p.value);
        break;
      case "hour":
        h = Number(p.value) % 24;
        break;
      case "minute":
        min = Number(p.value);
        break;
      case "second":
        s = Number(p.value);
        break;
    }
  }
  return { y, m, d, h, min, s, weekday: weekdayOf({ y, m, d }) };
}

/** The zone's offset at `instant` in ms (local wall time − UTC); +05:30 → 19_800_000. */
export function tzOffsetMs(instant: Date | number, timeZone: string): number {
  const t = typeof instant === "number" ? instant : instant.getTime();
  const p = localParts(new Date(t), timeZone);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return wall - (t - (((t % 1000) + 1000) % 1000));
}

function sameWall(t: number, timeZone: string, y: number, m: number, d: number, h: number, min: number): boolean {
  const p = localParts(new Date(t), timeZone);
  return p.y === y && p.m === m && p.d === d && p.h === h && p.min === min;
}

/**
 * The instant at which the wall clock in `timeZone` shows `y-m-d h:min`. Ambiguous (fall-back) times give the earlier
 * instant; times inside a spring-forward gap give the first valid instant after the gap.
 */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Two-pass correction (plan §8.4).
  const o1 = tzOffsetMs(guess, timeZone);
  const t1 = guess - o1;
  const o2 = tzOffsetMs(t1, timeZone);
  const primary = o1 === o2 ? t1 : guess - o2;
  // The offsets a day either side bracket at most one transition: they give every candidate instant.
  const before = guess - tzOffsetMs(guess - DAY_MS, timeZone);
  const after = guess - tzOffsetMs(guess + DAY_MS, timeZone);
  const valid = [primary, before, after].filter((t) => sameWall(t, timeZone, y, m, d, h, min));
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Inside a gap: binary-search the transition between the two readings (minute precision; zones move on minutes).
  let lo = Math.min(before, after);
  let hi = Math.max(before, after);
  const oLo = tzOffsetMs(lo, timeZone);
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
    if (mid === lo) break;
    if (tzOffsetMs(mid, timeZone) === oLo) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** Calendar arithmetic on a date (no zone involved). */
export function addDays(date: YMD, n: number): YMD {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** "YYYY-MM-DD". */
export function formatYmd(date: YMD): string {
  return `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" (throws on anything else, including impossible dates). */
export function parseYmd(key: string): YMD {
  const m = YMD_RE.exec(key);
  if (!m) throw new Error(`not a YYYY-MM-DD day key: ${key}`);
  const date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d));
  if (t.getUTCFullYear() !== date.y || t.getUTCMonth() + 1 !== date.m || t.getUTCDate() !== date.d) {
    throw new Error(`not a calendar date: ${key}`);
  }
  return date;
}

/** The local calendar date of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): YMD {
  const p = localParts(instant, timeZone);
  return { y: p.y, m: p.m, d: p.d };
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function calendarDaysBetween(a: YMD, b: YMD): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}
