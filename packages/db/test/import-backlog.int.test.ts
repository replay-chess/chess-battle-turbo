/**
 * The backlog release (phase-04 plan 8.9 / 12.1 `import-backlog.int.test.ts`) on a real Postgres with M1–M4:
 *   - 180 eligible games → 7 slices with runAt = nextAutoSyncAt + k days, sizes 26/26/26/26/26/25/25, BACKLOG
 *     priority, fairSeq = rank, reason `import`, games flipped to QUEUED, gamesVersion bumped once;
 *   - a second call inserts nothing (idempotent: the retry form after a lost response);
 *   - games beyond the cap stay NONE; already analysed imports use up the budget; REPLAY games and short games are
 *     never picked;
 *   - without a future daily-sync slot the base is the member's own slot computed in SQL, equal to the contract's
 *     backlogSlotAt() for Asia/Kolkata, Europe/London (across the October change) and America/New_York.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { backlogSlotAt } from "@repo/contracts/internal/import-schedule";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { backlogSettingsFromEnv, releaseImportBacklog, releaseImportBacklogSql } from "../src/import-backlog";
import { TEST_URL, assertLocalTestUrl, makeUser, run } from "./helpers";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const NOW = new Date("2026-11-10T12:00:00.000Z");
const DAY = 86_400_000;
let seq = 0;

async function seedGames(
  db: PrismaClient,
  userId: bigint,
  n: number,
  opts: { source?: "CHESSCOM" | "LICHESS" | "REPLAY"; analysisStatus?: string; plyCount?: number; startMinutesAgo?: number } = {},
): Promise<bigint[]> {
  const source = opts.source ?? "CHESSCOM";
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    WITH src AS (
      SELECT i, ${`cb${run}`}::text || lpad((${seq}::int + i)::text, 6, '0') AS ref,
             (${NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC') - make_interval(mins => ${opts.startMinutesAgo ?? 0}::int + i) AS ended
        FROM generate_series(1, ${n}::int) AS i
    ), g AS (
      INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                         "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", mode, source, "externalId",
                         "whitePlayerId", "plyCount", "completedAt", "analysisStatus")
      SELECT src.ref, ${userId}, 'COMPLETED', ${INITIAL_FEN}, 600, 0, 0, 0, src.ended, now(),
             ${source === "REPLAY" ? "BOT" : "IMPORTED"}::"GameMode", ${source}::"GameSource",
             CASE WHEN ${source} = 'REPLAY' THEN NULL ELSE src.ref END, ${userId}, ${opts.plyCount ?? 40}, src.ended,
             ${opts.analysisStatus ?? "NONE"}::"AnalysisStatus"
        FROM src
      RETURNING id, "completedAt"
    ), gp AS (
      INSERT INTO game_players ("gameId", "userId", color, mode, source, "endedAt", "updatedAt")
      SELECT g.id, ${userId}, 'w', ${source === "REPLAY" ? "BOT" : "IMPORTED"}::"GameMode", ${source}::"GameSource", g."completedAt", now() FROM g
      RETURNING "gameId"
    )
    SELECT "gameId" AS id FROM gp`);
  seq += n;
  return rows.map((r) => r.id);
}

async function jobsOf(db: PrismaClient, userId: bigint) {
  return db.$queryRaw<{ gameId: bigint; priority: number; fairSeq: number; runAt: Date; payload: Record<string, unknown> }[]>(Prisma.sql`
    SELECT "gameId", priority, "fairSeq", "runAt", payload FROM jobs WHERE "userId" = ${userId} AND kind = 'ANALYZE_GAME' ORDER BY "fairSeq"`);
}

async function version(db: PrismaClient, userId: bigint): Promise<number> {
  return (await db.$queryRaw<{ v: number }[]>(Prisma.sql`SELECT "gamesVersion" AS v FROM users WHERE id = ${userId}`))[0]!.v;
}

async function linkWithSlot(db: PrismaClient, userId: bigint, slot: Date | null, autoImport = true) {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "autoImport", "nextAutoSyncAt", "updatedAt")
    VALUES (${userId}, 'CHESSCOM', ${`bl${run}${userId}`}, 'Owl', 'owl', ${autoImport},
            ${slot ? Prisma.sql`(${slot.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`NULL`}, now())`);
}

describe("releaseImportBacklog (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  it("180 eligible games → 7 slices at the daily-sync slot + k days (26×5, 25×2); a second call queues nothing", async () => {
    const u = await makeUser(db, "backlog180");
    const slot = new Date("2026-11-10T21:05:00.000Z");
    await linkWithSlot(db, u.id, slot);
    // 20 eager games already queued or analysed (the trial's budget use), 180 still NONE.
    await seedGames(db, u.id, 20, { analysisStatus: "DONE", startMinutesAgo: 0 });
    const backlog = await seedGames(db, u.id, 180, { startMinutesAgo: 100 });
    const before = await version(db, u.id);

    const first = await releaseImportBacklog(db, { userId: u.id, now: NOW, cap: 200, spreadDays: 7 });
    assert.equal(first.queued, 180);
    assert.deepEqual(first.slots.map((s) => s.games), [26, 26, 26, 26, 26, 25, 25]);
    assert.deepEqual(
      first.slots.map((s) => s.runAt.toISOString()),
      [0, 1, 2, 3, 4, 5, 6].map((k) => new Date(slot.getTime() + k * DAY).toISOString()),
    );
    const jobs = await jobsOf(db, u.id);
    assert.equal(jobs.length, 180);
    assert.ok(jobs.every((j) => j.priority === JOB_PRIORITY.BACKLOG));
    assert.deepEqual(jobs.map((j) => j.fairSeq), Array.from({ length: 180 }, (_, i) => i + 1), "fairSeq = rank");
    assert.equal(jobs[0]!.gameId, backlog[0], "rank 1 is the newest NONE game");
    assert.equal(jobs[0]!.payload.reason, "import");
    assert.equal(typeof jobs[0]!.payload.gameRef, "string");
    const statuses = await db.$queryRaw<{ s: string; n: number }[]>(Prisma.sql`
      SELECT g."analysisStatus"::text AS s, count(*)::int AS n FROM games g JOIN game_players gp ON gp."gameId" = g.id
       WHERE gp."userId" = ${u.id} GROUP BY 1 ORDER BY 1`);
    assert.deepEqual(statuses.map((r) => [r.s, r.n]), [["DONE", 20], ["QUEUED", 180]]);
    assert.equal(await version(db, u.id), before + 1, "one gamesVersion bump per statement");

    const again = await releaseImportBacklog(db, { userId: u.id, now: NOW, cap: 200, spreadDays: 7 });
    assert.deepEqual(again, { queued: 0, slots: [] });
    assert.equal((await jobsOf(db, u.id)).length, 180);
    assert.equal(await version(db, u.id), before + 1);
  });

  it("the cap counts both providers; games beyond it stay NONE; REPLAY and short games are never picked", async () => {
    const u = await makeUser(db, "backlogcap");
    await linkWithSlot(db, u.id, new Date("2026-11-11T03:05:00.000Z"));
    await seedGames(db, u.id, 5, { source: "LICHESS", analysisStatus: "QUEUED" });
    await seedGames(db, u.id, 30, { startMinutesAgo: 10 });
    await seedGames(db, u.id, 4, { source: "REPLAY", startMinutesAgo: 0 });
    await seedGames(db, u.id, 3, { plyCount: 4, startMinutesAgo: 0 });
    const r = await releaseImportBacklog(db, { userId: u.id, now: NOW, cap: 25, spreadDays: 7 });
    assert.equal(r.queued, 20, "cap 25 − 5 already used");
    const left = await db.$queryRaw<{ s: string; src: string; n: number }[]>(Prisma.sql`
      SELECT g."analysisStatus"::text AS s, gp.source::text AS src, count(*)::int AS n
        FROM games g JOIN game_players gp ON gp."gameId" = g.id WHERE gp."userId" = ${u.id} GROUP BY 1, 2 ORDER BY 2, 1`);
    assert.deepEqual(left.map((x) => [x.src, x.s, x.n]), [
      ["CHESSCOM", "NONE", 13],
      ["CHESSCOM", "QUEUED", 20],
      ["LICHESS", "QUEUED", 5],
      ["REPLAY", "NONE", 4],
    ]);
    // Fewer games than slices: one game a day from the slot.
    const v = await makeUser(db, "backlogfew");
    await linkWithSlot(db, v.id, new Date("2026-11-11T03:05:00.000Z"));
    await seedGames(db, v.id, 3);
    const few = await releaseImportBacklog(db, { userId: v.id, now: NOW });
    assert.deepEqual(few.slots.map((s) => [s.runAt.toISOString(), s.games]), [
      ["2026-11-11T03:05:00.000Z", 1],
      ["2026-11-12T03:05:00.000Z", 1],
      ["2026-11-13T03:05:00.000Z", 1],
    ]);
  });

  it("without a future auto-import slot the base is backlogSlotAt(timeZone, now, userId), computed in SQL", async () => {
    const cases: [string, Date][] = [
      ["Asia/Kolkata", NOW],
      ["Europe/London", new Date("2026-10-24T12:00:00.000Z")],
      ["Europe/London", new Date("2026-10-23T12:00:00.000Z")],
      ["America/New_York", new Date("2027-03-13T12:00:00.000Z")],
      ["UTC", NOW],
      ["Mars/Olympus", NOW],
    ];
    for (const [tz, now] of cases) {
      const u = await makeUser(db, "backlogtz");
      await db.$executeRaw(Prisma.sql`UPDATE users SET "timeZone" = ${tz} WHERE id = ${u.id}`);
      // A link whose slot is already past does not count.
      await linkWithSlot(db, u.id, new Date(now.getTime() - DAY), true);
      await seedGames(db, u.id, 2);
      const r = await releaseImportBacklog(db, { userId: u.id, now, spreadDays: 1 });
      assert.equal(r.queued, 2, tz);
      assert.equal(r.slots[0]!.runAt.toISOString(), backlogSlotAt(tz, now, u.id).toISOString(), `${tz} @ ${now.toISOString()}`);
    }
  });

  it("an unknown user queues nothing; bad settings are refused before SQL", async () => {
    assert.deepEqual(await releaseImportBacklog(db, { userId: 9_000_000_000n, now: NOW }), { queued: 0, slots: [] });
    assert.throws(() => releaseImportBacklogSql({ userId: 1n, cap: 0 }), /cap/);
    assert.throws(() => releaseImportBacklogSql({ userId: 1n, spreadDays: 1.5 }), /spreadDays/);
    assert.deepEqual(backlogSettingsFromEnv({ IMPORT_ANALYSE_CAP: "150", IMPORT_BACKLOG_SPREAD_DAYS: "x" }), { cap: 150, spreadDays: 7 });
  });
});
