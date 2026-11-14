/**
 * The Phase 5 persona writer on a real Postgres after `prisma migrate deploy` (phase-05 plan 6.7; testing X4). Skipped
 * unless TEST_DATABASE_URL is set (a local Docker Postgres or the CI service; never Neon).
 *
 *   - every reset mode (the nine lease-pool personas and the five dev-seed states) lands in the state it names, and
 *     applying it twice in a row gives the same rows (everything but serial ids is compared);
 *   - the bank positions are the member's own key moments: each occurrence points at a written game and a moment
 *     ply, every card has its mistake, the written games are marked extracted;
 *   - a reset is exact: moving a user from bank-member to home-new leaves no P5 row; clearP05State removes them all;
 *   - shared e2e letters are refused before any write.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { EXTRACT_VERSION } from "@repo/contracts/internal/jobs";
import { createPrismaClient } from "../src/client";
import { getP05PersonaState, P05_PERSONA_STATES } from "../seed/p05-persona-states";
import { clearP05State, writeP05Persona } from "../seed/p05-personas";
import { TEST_DEPS } from "./p05-deps";
import { TEST_URL, assertLocalTestUrl, makeUser } from "./helpers";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const OPTS = { now: NOW, deps: TEST_DEPS };

/** Every P5 row of a user, without serial ids (cards, sessions and games referenced by their keys). */
async function snapshot(db: PrismaClient, userId: bigint): Promise<string> {
  const rows = await db.$queryRaw<{ s: unknown }[]>(Prisma.sql`
    SELECT json_build_object(
      'timeZone', (SELECT "timeZone" FROM users WHERE id = ${userId}),
      'mistakes', (SELECT coalesce(json_agg(x ORDER BY x."epdHash"), '[]') FROM (
         SELECT m."referenceId", m."epdHash"::text AS "epdHash", m.color, m.fen, m."setupUci", m.solution, m.accept, m."playedUci",
                m."refuteUci", m.judgement, m.source, m."isPuzzle", m.themes, m."primaryTheme", m.phase, m."winBefore", m."winAfterPlayed",
                m."cpBest", m."mateBest", m."timeClass", m."ecoCode", m."moveNumber", m.occurrences, m."lastPly", m."lastPlayedAt",
                m."lastOpponentName", m."hiddenAt", m."createdAt", m."updatedAt", g."referenceId" AS "lastGame"
           FROM mistakes m LEFT JOIN games g ON g.id = m."lastGameId" WHERE m."userId" = ${userId}) x),
      'occurrences', (SELECT coalesce(json_agg(x ORDER BY x.game, x.ply), '[]') FROM (
         SELECT g."referenceId" AS game, o.ply, m."referenceId" AS mistake
           FROM mistake_occurrences o JOIN mistakes m ON m.id = o."mistakeId" JOIN games g ON g.id = o."gameId"
          WHERE m."userId" = ${userId}) x),
      'cards', (SELECT coalesce(json_agg(x ORDER BY x."itemKey"), '[]') FROM (
         SELECT c."itemKey", c.deck, c.kind, c.theme, c.phase, c.due, c.stability, c.difficulty, c."scheduledDays", c.reps, c.lapses, c.state,
                c."lastReview", c.mastery, c."suspendedUntil", c."createdAt", c."updatedAt", m."referenceId" AS mistake
           FROM training_cards c LEFT JOIN mistakes m ON m.id = c."mistakeId" WHERE c."userId" = ${userId}) x),
      'attempts', (SELECT coalesce(json_agg(x ORDER BY x."clientAttemptId"), '[]') FROM (
         SELECT a."clientAttemptId", c."itemKey" AS card, s."referenceId" AS session, a."itemId", a.deck, a.kind, a.theme, a.solved,
                a."firstTry", a.grade, a."reviewedAt", a."createdAt"
           FROM training_attempts a LEFT JOIN training_cards c ON c.id = a."cardId" LEFT JOIN training_sessions s ON s.id = a."sessionId"
          WHERE a."userId" = ${userId}) x),
      'sessions', (SELECT coalesce(json_agg(x ORDER BY x."referenceId"), '[]') FROM (
         SELECT "referenceId", kind, status, source, "filterKey", size, items, day, total, solved, "firstTry", "withHint", "startedAt", "endedAt"
           FROM training_sessions WHERE "userId" = ${userId}) x),
      'days', (SELECT coalesce(json_agg(x ORDER BY x.day), '[]') FROM (
         SELECT day, "bankReviewed", "newIntroduced", "puzzlesDone", plan, "planDone", "updatedAt" FROM training_days WHERE "userId" = ${userId}) x),
      'themes', (SELECT coalesce(json_agg(x ORDER BY x.theme), '[]') FROM (
         SELECT theme, attempts, "firstTry", ewma, "bankCount", "milestonePct", "lastAttemptAt" FROM theme_mastery WHERE "userId" = ${userId}) x),
      'profile', (SELECT row_to_json(p) FROM (
         SELECT "puzzleRating", "puzzleRd", "puzzleAttempts", "ratingSeeded", "solveStreak", "dayStreak", "dayStreakBest", "lastActiveDay",
                "dayStartHour", "releaseHour", "bankDailyCap", "newPerDay", "updatedAt" FROM training_profiles WHERE "userId" = ${userId}) p),
      'reports', (SELECT count(*) FROM reports WHERE "reporterId" = ${userId})
    ) AS s`);
  return JSON.stringify(rows[0]!.s);
}

async function count(db: PrismaClient, sql: Prisma.Sql): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>(sql);
  return Number(rows[0]!.n);
}

describe("P5 persona writer (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  for (const name of Object.keys(P05_PERSONA_STATES)) {
    it(`${name}: lands in its state, and a second reset gives the same rows`, async () => {
      const s = getP05PersonaState(name);
      const u = await makeUser(db, `p5${name.replace(/[^a-z]/g, "")}`.slice(0, 20));
      const email = (await db.$queryRaw<{ e: string }[]>(Prisma.sql`SELECT email AS e FROM users WHERE id = ${u.id}`))[0]!.e;
      const first = await writeP05Persona(db, email, name, OPTS);
      const snap1 = await snapshot(db, u.id);
      const second = await writeP05Persona(db, email, name, OPTS);
      const snap2 = await snapshot(db, u.id);
      assert.equal(snap2, snap1, `${name}: the second reset changed rows`);
      assert.deepEqual({ ...second, cleared: undefined }, { ...first, cleared: undefined });

      assert.equal(first.mistakes, s.mistakes);
      assert.equal(first.cards, s.cards);
      assert.equal(await count(db, Prisma.sql`SELECT count(*) AS n FROM mistakes WHERE "userId" = ${u.id}`), s.mistakes);
      assert.equal(await count(db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${u.id} AND deck = 'BANK'`), s.cards);
      const due = await count(db, Prisma.sql`
        SELECT count(*) AS n FROM training_cards WHERE "userId" = ${u.id} AND due <= ${NOW.toISOString().replace("Z", "")}::timestamp`);
      const expectedDue = s.schedule.kind === "spread" ? s.schedule.dueNow : s.schedule.kind === "all_due" ? s.cards : 0;
      assert.equal(due, expectedDue, `${name}: due now`);
      assert.equal(
        (await db.$queryRaw<{ tz: string }[]>(Prisma.sql`SELECT "timeZone" AS tz FROM users WHERE id = ${u.id}`))[0]!.tz,
        s.timeZone,
      );
      assert.equal(await count(db, Prisma.sql`SELECT count(*) AS n FROM training_profiles WHERE "userId" = ${u.id}`), s.profile ? 1 : 0);

      // Every occurrence is at a key-moment ply of a written game of this member; every card has its mistake.
      const orphans = await count(db, Prisma.sql`
        SELECT count(*) AS n FROM mistake_occurrences o JOIN mistakes m ON m.id = o."mistakeId"
          LEFT JOIN player_reviews pr ON pr."gameId" = o."gameId" AND pr.color = m.color
         WHERE m."userId" = ${u.id}
           AND (pr."gameId" IS NULL OR NOT (jsonb_path_query_array(pr.content, '$.moments[*].ply') @> to_jsonb(o.ply)))`);
      assert.equal(orphans, 0, `${name}: occurrences outside the member's moments`);
      assert.equal(await count(db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${u.id} AND "mistakeId" IS NULL`), 0);
      const games = Object.values(first.gameRefs);
      assert.equal(games.length, (s.games.game ? 1 : 0) + s.games.archives);
      if (games.length) {
        const unextracted = await count(db, Prisma.sql`
          SELECT count(*) AS n FROM game_players gp JOIN games g ON g.id = gp."gameId"
           WHERE gp."userId" = ${u.id} AND g."referenceId" = ANY(${games}::text[]) AND gp."bankVersion" <> ${EXTRACT_VERSION}`);
        assert.equal(unextracted, 0, "the written games are marked extracted");
      }
      if (s.perfectSession) {
        const sess = await db.$queryRaw<{ status: string; firstTry: number; n: bigint }[]>(Prisma.sql`
          SELECT s.status::text AS status, s."firstTry", (SELECT count(*) FROM training_attempts a WHERE a."sessionId" = s.id) AS n
            FROM training_sessions s WHERE s."userId" = ${u.id}`);
        assert.deepEqual(sess.map((r) => [r.status, r.firstTry, Number(r.n)]), [["COMPLETED", 5, 5]]);
      }
    });
  }

  it("bank-member: the hub's numbers (4 due of 41, the design's mastery bars, streak 4 ending yesterday)", async () => {
    const u = await makeUser(db, "p5bmnum");
    const email = (await db.$queryRaw<{ e: string }[]>(Prisma.sql`SELECT email AS e FROM users WHERE id = ${u.id}`))[0]!.e;
    await writeP05Persona(db, email, "bank-member", OPTS);
    const fork = await db.$queryRaw<{ ewma: number; attempts: number }[]>(Prisma.sql`
      SELECT ewma, attempts FROM theme_mastery WHERE "userId" = ${u.id} AND theme = 'fork'`);
    assert.equal(fork[0]!.attempts, 14);
    assert.ok(Math.abs(fork[0]!.ewma - 0.62) < 1e-6);
    const bankCount = await count(db, Prisma.sql`SELECT sum("bankCount") AS n FROM theme_mastery WHERE "userId" = ${u.id}`);
    assert.equal(bankCount, 41, "bankCount equals the live BANK cards");
    const p = await db.$queryRaw<{ d: number; best: number; last: Date }[]>(Prisma.sql`
      SELECT "dayStreak" AS d, "dayStreakBest" AS best, "lastActiveDay" AS last FROM training_profiles WHERE "userId" = ${u.id}`);
    assert.deepEqual([p[0]!.d, p[0]!.best, p[0]!.last.toISOString().slice(0, 10)], [4, 9, "2026-11-11"]);
    assert.equal(await count(db, Prisma.sql`SELECT count(*) AS n FROM training_days WHERE "userId" = ${u.id}`), 4);
  });

  it("a reset is exact: bank-member → home-new leaves no P5 row; clearP05State removes everything", async () => {
    const u = await makeUser(db, "p5move");
    const email = (await db.$queryRaw<{ e: string }[]>(Prisma.sql`SELECT email AS e FROM users WHERE id = ${u.id}`))[0]!.e;
    await writeP05Persona(db, email, "bank-member", OPTS);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO reports ("referenceId", "reporterId", "targetType", "targetRef", reason) VALUES (${`cp5mv${u.ref}`.slice(0, 25)}, ${u.id}, 'PUZZLE', '0009B', 'OTHER')`);
    await writeP05Persona(db, email, "home-new", OPTS);
    const left = await count(db, Prisma.sql`
      SELECT ((SELECT count(*) FROM mistakes WHERE "userId" = ${u.id}) + (SELECT count(*) FROM training_cards WHERE "userId" = ${u.id})
            + (SELECT count(*) FROM training_attempts WHERE "userId" = ${u.id}) + (SELECT count(*) FROM training_days WHERE "userId" = ${u.id})
            + (SELECT count(*) FROM theme_mastery WHERE "userId" = ${u.id}) + (SELECT count(*) FROM training_profiles WHERE "userId" = ${u.id})
            + (SELECT count(*) FROM reports WHERE "reporterId" = ${u.id})) AS n`);
    assert.equal(left, 0);
    await writeP05Persona(db, email, "train-plan", OPTS);
    const cleared = await clearP05State(db, email);
    assert.equal(cleared.cards, 3);
    assert.equal(cleared.mistakes, 3);
    assert.equal(await count(db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${u.id}`), 0);
  });

  it("refuses shared e2e letters before any write", async () => {
    await assert.rejects(writeP05Persona(db, "e2e-playera+clerk_test@chessbattle.dev", "bank-member", OPTS), /shared e2e user/);
    await assert.rejects(clearP05State(db, "e2e-playerq+clerk_test@chessbattle.dev"), /shared e2e user/);
  });
});
