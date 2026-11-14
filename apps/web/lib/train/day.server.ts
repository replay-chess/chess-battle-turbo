// The member's training clock (phase-05 plan §8.4): the local training day, its UTC bounds, the local week and the
// next release, all from the request clock `now` (never the wall clock), the member's zone (`User.timeZone`, P4) and
// the profile's `dayStartHour` / `releaseHour` (`trainClock`, pure), and the reads every Train service starts from
// (`loadTrainState`, one parallel batch).
import { dayAnchorOf, dayStart, mondayOf, trainingDayAt, type DayAnchor } from "@repo/chess-training/day";
import { nextRelease } from "@repo/chess-training/release";
import { isValidTimeZone } from "@repo/chess-training/tz";
import type { Viewer } from "@/lib/auth/viewer";
import { Prisma } from "@repo/db";
import { DEFAULT_DAY_START_HOUR, DEFAULT_RELEASE_HOUR } from "@repo/chess-training/constants";
import { dueSummarySql, dueSummaryOf, ZERO_DAY, type DayCounters, type DueSummary } from "./badges.server";
import { dayParam, num, type TrainDb } from "./db.server";
import { defaultProfile, profileOfRow, profileSql, ratingsSql, seedOf, type RatingSource, type TrainingProfile } from "./profile.server";

export type TrainClock = {
  now: Date;
  /** The member's current zone (a pinned day keeps the bounds of the zone it began in: `dayStartUtc`/`dayEndUtc`). */
  timeZone: string;
  dayStartHour: number;
  releaseHour: number;
  /** Today's training day key. */
  today: string;
  /** The UTC instant today's training day began / ends. */
  dayStartUtc: Date;
  dayEndUtc: Date;
  /** Monday of the local week (day key) and its start. */
  monday: string;
  mondayStartUtc: Date;
  /** Today's release hour if still ahead, else tomorrow's. */
  nextRelease: Date;
};

/** The member's IANA zone (P4's `users."timeZone"`, default "UTC"); an unknown zone reads as UTC. */
export function timeZoneOf(viewer: Pick<Viewer, "onboarding" | "user">): string {
  const tz = viewer.onboarding?.timeZone ?? viewer.user.timeZone ?? "UTC";
  return isValidTimeZone(tz) ? tz : "UTC";
}

/**
 * The clock at `now`. `anchor` is the member's newest day row with the zone it was opened in: after a zone (or
 * day-start) change the day in progress keeps its key and bounds until it ends (`trainingDayAt`, FIX-1 tz-pin).
 */
export function trainClock(now: Date, timeZone: string, p: { dayStartHour: number; releaseHour: number }, anchor: DayAnchor | null = null): TrainClock {
  const window = trainingDayAt(now, timeZone, p.dayStartHour, anchor);
  const today = window.key;
  const monday = mondayOf(today);
  return {
    now,
    timeZone,
    dayStartHour: p.dayStartHour,
    releaseHour: p.releaseHour,
    today,
    dayStartUtc: window.start,
    dayEndUtc: window.end,
    monday,
    mondayStartUtc: dayStart(monday, timeZone, p.dayStartHour),
    nextRelease: nextRelease(now, timeZone, p.releaseHour),
  };
}

// ── The member's training state (one parallel batch) ────────────────────────────────────────────────────────────
// R1, R2 and W2 start from the same reads: the profile (PK), today's and this week's training_days rows (PK range)
// and the due summary (statement (a)). They run in ONE parallel batch: the day range is wide enough for any
// `dayStartHour` (0–6 moves the local day by at most one), and statement (a) is computed for the default release
// hour, re-run only when the profile's release hour differs (a W8 change, rare).

export type DayRow = {
  day: string;
  bankReviewed: number;
  newIntroduced: number;
  puzzlesDone: number;
  lessonsDone: number;
  activeMs: number;
  plan: unknown;
  planDone: number;
  /** m5b: the zone the day was opened in (null on older rows). */
  timeZone?: string | null;
  dayStartHour?: number | null;
};

/** training_days rows of the last 8 local days through the day after tomorrow (≤ 11 rows, training_days_pkey range: a
 * day pinned by a zone change can be a day ahead of the new zone's, §8.10). */
export function recentDaysSql(userId: bigint, around: string): Prisma.Sql {
  return Prisma.sql`SELECT to_char(day, 'YYYY-MM-DD') AS day, "bankReviewed", "newIntroduced", "puzzlesDone", "lessonsDone",
      "activeMs", plan, "planDone", "timeZone", "dayStartHour"
    FROM training_days WHERE "userId" = ${userId} AND day >= ${dayParam(around)} - 8 AND day <= ${dayParam(around)} + 2
    ORDER BY day`;
}

export function dayCountersOf(row: DayRow | undefined): DayCounters {
  return row
    ? { bankReviewed: num(row.bankReviewed), newIntroduced: num(row.newIntroduced), puzzlesDone: num(row.puzzlesDone), planDone: num(row.planDone) }
    : ZERO_DAY;
}

/** A day row counts as trained when anything was graded that day (the streak week strip, §8.9). */
export function isTrainedDay(r: DayRow): boolean {
  return num(r.bankReviewed) + num(r.puzzlesDone) + num(r.lessonsDone) > 0 || num(r.activeMs) > 0;
}

export type TrainState = {
  profile: TrainingProfile;
  clock: TrainClock;
  due: DueSummary;
  /** Today's row, if any. */
  today: DayRow | undefined;
  counters: DayCounters;
  /** This week's rows, Monday → today. */
  week: DayRow[];
};

type ProfileDbRow = Parameters<typeof profileOfRow>[0];
type DueDbRow = Parameters<typeof dueSummaryOf>[0];

/** The profile, the clock, the due summary and the day rows in one parallel batch (+1 read for a member's first visit). */
export async function loadTrainState(db: TrainDb, viewer: Pick<Viewer, "id" | "onboarding" | "user">, now: Date): Promise<TrainState> {
  const tz = timeZoneOf(viewer);
  const guess = trainClock(now, tz, { dayStartHour: DEFAULT_DAY_START_HOUR, releaseHour: DEFAULT_RELEASE_HOUR });
  const [profileRows, dueRows, dayRows] = await Promise.all([
    db.$queryRaw<ProfileDbRow[]>(profileSql(viewer.id)),
    db.$queryRaw<DueDbRow[]>(dueSummarySql(viewer.id, now, guess.nextRelease)),
    db.$queryRaw<DayRow[]>(recentDaysSql(viewer.id, guess.today)),
  ]);
  let profile: TrainingProfile;
  if (profileRows[0]) profile = profileOfRow(profileRows[0]);
  else profile = defaultProfile(seedOf(viewer, await db.$queryRaw<RatingSource[]>(ratingsSql(viewer.id))));
  const clock = trainClock(now, tz, profile, dayAnchorOf(dayRows));
  const due =
    clock.nextRelease.getTime() === guess.nextRelease.getTime()
      ? dueSummaryOf(dueRows[0])
      : dueSummaryOf((await db.$queryRaw<DueDbRow[]>(dueSummarySql(viewer.id, now, clock.nextRelease)))[0]);
  const today = dayRows.find((r) => r.day === clock.today);
  const week = dayRows.filter((r) => r.day >= clock.monday && r.day <= clock.today);
  return { profile, clock, due, today, counters: dayCountersOf(today), week };
}
