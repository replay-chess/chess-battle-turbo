// The member's training profile (phase-05 plan §6.2 TrainingProfile, §8.7 seed, §8.9 streaks): one PK read in R1, W1
// and W2. The row is created lazily (R1's registered `daily_plan` write, W1, W2, W8); until then every reader gets the
// defaults plus the puzzle-rating seed computed in memory, so a GET never writes outside R1.
//
// The seed (§8.7, D-3) is applied once (`ratingSeeded`): blitz (Chess.com, else Lichess, from P4's linked-account
// ratings), else rapid, else the onboarding rating or the band midpoint, + 300, clamped to 800–2200.
import { Prisma } from "@repo/db";
import { parseRatings } from "@repo/db/json";
import {
  DEFAULT_BANK_DAILY_CAP,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_RELEASE_HOUR,
} from "@repo/chess-training/constants";
import { isProvisional, seedPuzzleRating, type RatingBandKey } from "@repo/chess-training/rating";
import type { Viewer } from "@/lib/auth/viewer";
import type { TrainDb } from "./db.server";
import { NOW_UTC, num } from "./db.server";

export type TrainingProfile = {
  /** False until the row exists (defaults below, rating from the seed). */
  exists: boolean;
  puzzleRating: number;
  puzzleRd: number;
  puzzleVol: number;
  puzzleAttempts: number;
  ratingSeeded: boolean;
  solveStreak: number;
  solveStreakBest: number;
  dayStreak: number;
  dayStreakBest: number;
  /** Day key of the last trained local day. */
  lastActiveDay: string | null;
  dayStartHour: number;
  releaseHour: number;
  bankDailyCap: number;
  newPerDay: number;
  autoGrade: boolean;
};

type ProfileDbRow = Omit<TrainingProfile, "exists">;

/** The PK read (training_profiles_pkey). */
export function profileSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT "puzzleRating", "puzzleRd", "puzzleVol", "puzzleAttempts", "ratingSeeded", "solveStreak",
      "solveStreakBest", "dayStreak", "dayStreakBest", to_char("lastActiveDay", 'YYYY-MM-DD') AS "lastActiveDay",
      "dayStartHour", "releaseHour", "bankDailyCap", "newPerDay", "autoGrade"
    FROM training_profiles WHERE "userId" = ${userId}`;
}

/** The member's linked-account ratings (≤ 2 rows; read only while the profile row does not exist yet). */
export function ratingsSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT provider::text AS provider, ratings FROM linked_accounts WHERE "userId" = ${userId}
    ORDER BY (provider = 'CHESSCOM') DESC, id`;
}

export type RatingSource = { provider: string; ratings: unknown };

const RATING_BANDS: readonly RatingBandKey[] = ["NEW_TO_CHESS", "UNDER_800", "R800_1200", "R1200_1600", "R1600_2000", "R2000_PLUS"];

/** The seed state from the linked accounts (Chess.com first) and the onboarding answers. */
export function seedOf(viewer: Pick<Viewer, "onboarding">, accounts: readonly RatingSource[]): { r: number; rd: number; vol: number } {
  let blitz: number | null = null;
  let rapid: number | null = null;
  for (const a of accounts) {
    const r = parseRatings(a.ratings);
    blitz ??= r.blitz?.rating ?? null;
    rapid ??= r.rapid?.rating ?? null;
  }
  const band = viewer.onboarding?.ratingBand ?? null;
  return seedPuzzleRating({
    blitz,
    rapid,
    initialRating: viewer.onboarding?.initialRating ?? null,
    ratingBand: band && (RATING_BANDS as readonly string[]).includes(band) ? (band as RatingBandKey) : null,
  });
}

export function defaultProfile(seed: { r: number; rd: number; vol: number }): TrainingProfile {
  return {
    exists: false,
    puzzleRating: seed.r,
    puzzleRd: seed.rd,
    puzzleVol: seed.vol,
    puzzleAttempts: 0,
    ratingSeeded: false,
    solveStreak: 0,
    solveStreakBest: 0,
    dayStreak: 0,
    dayStreakBest: 0,
    lastActiveDay: null,
    dayStartHour: DEFAULT_DAY_START_HOUR,
    releaseHour: DEFAULT_RELEASE_HOUR,
    bankDailyCap: DEFAULT_BANK_DAILY_CAP,
    newPerDay: DEFAULT_NEW_PER_DAY,
    autoGrade: false,
  };
}

export function profileOfRow(row: ProfileDbRow): TrainingProfile {
  return {
    exists: true,
    puzzleRating: num(row.puzzleRating),
    puzzleRd: num(row.puzzleRd),
    puzzleVol: num(row.puzzleVol),
    puzzleAttempts: num(row.puzzleAttempts),
    ratingSeeded: Boolean(row.ratingSeeded),
    solveStreak: num(row.solveStreak),
    solveStreakBest: num(row.solveStreakBest),
    dayStreak: num(row.dayStreak),
    dayStreakBest: num(row.dayStreakBest),
    lastActiveDay: row.lastActiveDay ?? null,
    dayStartHour: num(row.dayStartHour),
    releaseHour: num(row.releaseHour),
    bankDailyCap: num(row.bankDailyCap),
    newPerDay: num(row.newPerDay),
    autoGrade: Boolean(row.autoGrade),
  };
}

/**
 * The profile row, or the defaults with the seed (one more read, the ≤ 2 linked accounts, only while the row does not
 * exist). Never writes.
 */
export async function readProfile(db: TrainDb, viewer: Pick<Viewer, "id" | "onboarding">): Promise<TrainingProfile> {
  const rows = await db.$queryRaw<ProfileDbRow[]>(profileSql(viewer.id));
  if (rows[0]) return profileOfRow(rows[0]);
  const accounts = await db.$queryRaw<RatingSource[]>(ratingsSql(viewer.id));
  return defaultProfile(seedOf(viewer, accounts));
}

/** Creates the row with the seed applied (`ON CONFLICT DO NOTHING`: a concurrent first write keeps its row). */
export function insertProfileSql(userId: bigint, p: TrainingProfile): Prisma.Sql {
  return Prisma.sql`INSERT INTO training_profiles ("userId", "puzzleRating", "puzzleRd", "puzzleVol", "ratingSeeded", "updatedAt")
    VALUES (${userId}, ${p.puzzleRating}::real, ${p.puzzleRd}::real, ${p.puzzleVol}::real, true, ${NOW_UTC})
    ON CONFLICT ("userId") DO NOTHING`;
}

/** The rating chip ("1512", provisional below 20 rated puzzles). */
export function ratingView(p: TrainingProfile): { value: number; provisional: boolean } {
  return { value: Math.round(p.puzzleRating), provisional: isProvisional(p.puzzleAttempts) };
}
