// Shared setup for the @repo/db integration tests: a real Postgres after `prisma migrate deploy` (CI service or a
// local Docker container). Skipped unless TEST_DATABASE_URL is set. Never point it at Neon: the tests write rows.
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "#generated";

export const TEST_URL = process.env.TEST_DATABASE_URL;
/**
 * Optional: a URL for the socket role `replay_realtime` (sql/roles.sql applied to the test database). When set, the
 * socket-side functions (load, checkpoint, finish, abort, rematch, restore, sweep) run as that role, which proves
 * the grants. Defaults to TEST_DATABASE_URL.
 */
export const REALTIME_URL = process.env.TEST_REALTIME_DATABASE_URL ?? TEST_URL;

export function assertLocalTestUrl(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`refusing to run the @repo/db integration tests against ${host}: use a local Postgres`);
  }
}

export const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
let n = 0;

export interface TestUser {
  id: bigint;
  ref: string;
  name: string;
}

/** Inserts a user (and its legacy user_stats row) with unique ids. */
export async function makeUser(db: PrismaClient, label: string, opts: { stats?: boolean } = {}): Promise<TestUser> {
  n++;
  const ref = `c${run}${String(n).padStart(4, "0")}`.slice(0, 26).padEnd(21, "0");
  const name = `${label}_${n}`.slice(0, 40);
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO users ("referenceId", code, "googleId", email, name, "updatedAt")
    VALUES (${ref}, ${`code-${run}-${n}`}, ${`google-${run}-${n}`}, ${`${label}-${run}-${n}@test.invalid`}, ${name}, now())
    RETURNING id`);
  const id = rows[0]!.id;
  if (opts.stats !== false) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO user_stats ("referenceId", "userId", "updatedAt") VALUES (${`s${ref}`}, ${id}, now())`);
  }
  return { id, ref, name };
}

export async function stats(db: PrismaClient, userId: bigint) {
  const rows = await db.$queryRaw<
    { total: number; won: number; lost: number; drawn: number; streak: number; version: number }[]
  >(Prisma.sql`
    SELECT s."totalGamesPlayed" AS total, s."gamesWon" AS won, s."gamesLost" AS lost, s."gamesDrawn" AS drawn,
           s."currentWinStreak" AS streak, u."gamesVersion" AS version
      FROM users u LEFT JOIN user_stats s ON s."userId" = u.id WHERE u.id = ${userId}`);
  return rows[0]!;
}

export async function gameRow(db: PrismaClient, id: bigint) {
  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT status::text AS status, phase::text AS phase, "endMethod"::text AS "endMethod", outcome::text AS outcome,
           result::text AS result, "winnerId", moves, "moveClocksMs", "plyCount", fen, pgn, meta, "whitePlayerId",
           "blackPlayerId", "whiteName", "blackName", "whiteRating", "blackRating", "creatorTimeRemaining",
           "opponentTimeRemaining", "completedAt", "lastMoveAt", "rematchOfId", "studySeconds", "startPly",
           "timeClass"::text AS "timeClass", mode::text AS mode, "whiteTimeMs", "blackTimeMs", "clockRunning",
           "phaseEndsAt", "opponentId", "startedAt"
      FROM games WHERE id = ${id}`);
  return rows[0]!;
}

export async function playerRows(db: PrismaClient, gameId: bigint) {
  return db.$queryRaw<
    {
      userId: bigint;
      color: string;
      mode: string;
      result: string | null;
      endedAt: Date | null;
      opponentUserId: bigint | null;
      opponentName: string;
      opponentRating: number | null;
      ratingBefore: number | null;
      timeClass: string | null;
    }[]
  >(Prisma.sql`
    SELECT "userId", color, mode::text AS mode, result::text AS result, "endedAt", "opponentUserId", "opponentName",
           "opponentRating", "ratingBefore", "timeClass"::text AS "timeClass"
      FROM game_players WHERE "gameId" = ${gameId} ORDER BY color DESC`);
}

export const OPERA_UCI =
  "e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3 d6e5 f1c4 g8f6 f3b3 d8e7 b1c3 c7c6 c1g5 b7b5 c3b5 c6b5 c4b5 b8d7 e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 b5d7 f6d7 b3b8 d7b8 d1d8";
export const OPERA_FINAL_FEN = "1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17";
