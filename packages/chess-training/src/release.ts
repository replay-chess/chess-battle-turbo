// Release time and due snapping (phase-05 plan §8.4, rct-b D7). New BANK cards and every interval of a day or more
// land on the member's local release hour (08:00 by default), so "The next batch of 6 arrives tomorrow at 08:00" is
// literally true. Intervals under a day (Again, learning steps) are never snapped. Browser-safe and pure.
import { DEFAULT_RELEASE_HOUR } from "./constants";
import { addDays, localDate, localParts, zonedToUtc } from "./tz";

/** Today's local `releaseHour` if it is still strictly ahead of `now`, else tomorrow's. */
export function nextRelease(now: Date, timeZone: string, releaseHour: number = DEFAULT_RELEASE_HOUR): Date {
  const p = localParts(now, timeZone);
  const today = zonedToUtc(p.y, p.m, p.d, releaseHour, 0, timeZone);
  if (today.getTime() > now.getTime()) return today;
  const t = addDays(p, 1);
  return zonedToUtc(t.y, t.m, t.d, releaseHour, 0, timeZone);
}

/** The release instant on `dueRaw`'s local calendar day. */
export function releaseOnDay(dueRaw: Date, timeZone: string, releaseHour: number = DEFAULT_RELEASE_HOUR): Date {
  const d = localDate(dueRaw, timeZone);
  return zonedToUtc(d.y, d.m, d.d, releaseHour, 0, timeZone);
}

/**
 * Snaps an FSRS due date: an interval of at least one day moves to the release hour of the same local calendar day;
 * a shorter one (Again, a learning step) stays exactly as FSRS computed it.
 */
export function snapDue(dueRaw: Date, scheduledDays: number, timeZone: string, releaseHour: number = DEFAULT_RELEASE_HOUR): Date {
  if (scheduledDays < 1) return dueRaw;
  return releaseOnDay(dueRaw, timeZone, releaseHour);
}

/** "Skip for today": the card waits until the next release (§8.4, W5). */
export function skipUntil(now: Date, timeZone: string, releaseHour: number = DEFAULT_RELEASE_HOUR): Date {
  return nextRelease(now, timeZone, releaseHour);
}
