// Daily-sync scheduling (phase-04 plan §8.10, §8.9; D4-27, R-CC-05). Pure and dependency-free: the web (ACC-5's
// auto-import switch), the worker (rescheduling the `import:<id>` row; WK/src/import/schedule.ts re-exports this)
// and `@repo/db` (the backlog slices) share one copy. Time zones use the runtime's `Intl` data (full ICU on Node ≥ 22),
// no time-zone library.
//
// One daily sync per account, at about 03:00 in the member's zone, spread over that hour by a deterministic jitter
// and then snapped to HH:05 UTC, so all the accounts of one UTC hour share one Neon wake (the worker sleeps until
// min("runAt")). Never sooner than 12 h after the last good sync.

/** The local hour a daily sync aims for. */
export const DAILY_SYNC_LOCAL_HOUR = 3;
/** Every daily sync and every backlog slice runs at this minute of a UTC hour. */
export const DAILY_SYNC_UTC_MINUTE = 5;
/** Automatic syncs of one account are at least this far apart (R-CC-05). */
export const AUTO_SYNC_MIN_GAP_MS = 12 * 3_600_000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock fields of an instant in `tz`. Throws a RangeError for an unknown zone. */
export function localParts(tz: string, at: Date): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** The zone's offset from UTC at an instant, in ms (positive east of Greenwich). */
export function zoneOffsetMs(tz: string, atMs: number): number {
  const p = localParts(tz, new Date(atMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads `y-m-d h:mi` (DST-safe), resolved as Postgres `timestamp AT TIME
 * ZONE tz` resolves it, so the SQL in `DB/src/import-backlog.ts` agrees: a wall time in a spring-forward gap gets
 * the offset from before the transition (it lands one gap later on the clock), and one that exists twice
 * (fall back) gets the later instant.
 */
export function zonedInstant(tz: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The true instant is wall − offset with the offset within [−12 h, +14 h]; sample safely on both sides of it.
  const before = zoneOffsetMs(tz, wall - 15 * HOUR_MS);
  const after = zoneOffsetMs(tz, wall + 15 * HOUR_MS);
  const tBefore = wall - before;
  const tAfter = wall - after;
  const okBefore = zoneOffsetMs(tz, tBefore) === before;
  const okAfter = zoneOffsetMs(tz, tAfter) === after;
  if (okBefore && okAfter) return new Date(Math.max(tBefore, tAfter));
  if (okAfter) return new Date(tAfter);
  return new Date(tBefore);
}

/** `hour:minute` local time in `tz` on the local calendar day of `at`. */
export function atLocalTime(tz: string, at: Date, hour: number, minute: number): Date {
  const p = localParts(tz, at);
  return zonedInstant(tz, p.year, p.month, p.day, hour, minute);
}

/** The same local wall time `days` calendar days later (DST-safe: 03:00 stays 03:00 across a change). */
export function addLocalDays(tz: string, at: Date, days: number): Date {
  const p = localParts(tz, at);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedInstant(tz, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), p.hour, p.minute);
}

/** `instant` floored to its UTC hour, at minute DAILY_SYNC_UTC_MINUTE. */
export function snapToSyncMinute(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / HOUR_MS) * HOUR_MS + DAILY_SYNC_UTC_MINUTE * MINUTE_MS);
}

/** Deterministic 0–59 minute jitter per account (spreads one local hour). */
export function syncJitterMinutes(accountId: bigint | number | string): number {
  return Number(BigInt(accountId) % 60n);
}

/**
 * The next automatic sync of an account (phase-04 §8.10): the next 03:00 in `tz` after `now`, plus the account's
 * jitter, snapped to HH:05 UTC, and never sooner than 12 h after `lastSyncOkAt` (that floor rounded up to the next
 * HH:05 UTC, so every automatic sync keeps the one-wake-per-hour property of D4-27). An unknown `tz` falls back to UTC
 * (the column defaults to "UTC"; a bad value must not stop the sync).
 */
export function nextAutoSyncAt(tz: string, now: Date, lastSyncOkAt: Date | null, accountId: bigint | number | string): Date {
  const zone = isZone(tz) ? tz : "UTC";
  const today = localParts(zone, now);
  let local = zonedInstant(zone, today.year, today.month, today.day, DAILY_SYNC_LOCAL_HOUR, 0);
  if (local.getTime() <= now.getTime()) {
    const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    local = zonedInstant(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), DAILY_SYNC_LOCAL_HOUR, 0);
  }
  const at = snapToSyncMinute(new Date(local.getTime() + syncJitterMinutes(accountId) * MINUTE_MS));
  if (!lastSyncOkAt) return at;
  // The 12-hour floor is rounded UP to the next HH:05 UTC, so a floored sync still shares its hour's Neon wake.
  const floor = lastSyncOkAt.getTime() + AUTO_SYNC_MIN_GAP_MS;
  const snappedFloor = Math.ceil((floor - DAILY_SYNC_UTC_MINUTE * MINUTE_MS) / HOUR_MS) * HOUR_MS + DAILY_SYNC_UTC_MINUTE * MINUTE_MS;
  return new Date(Math.max(at.getTime(), snappedFloor));
}

/**
 * The backlog release's first slot when the member has no future daily-sync time on a linked account (§8.9): the same
 * rule as nextAutoSyncAt with the member's id as the jitter key and no 12-hour floor. `DB/src/import-backlog.ts`
 * computes the identical instant in SQL (`AT TIME ZONE`), and its integration test compares the two.
 */
export function backlogSlotAt(tz: string, now: Date, userId: bigint | number | string): Date {
  return nextAutoSyncAt(tz, now, null, userId);
}

function isZone(tz: string): boolean {
  if (tz === "UTC") return true;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}
