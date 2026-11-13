/**
 * The shared enqueue SQL (packages/db/src/jobs.ts) against a real Postgres after `prisma migrate deploy` (phase-03
 * plan 7.6, task B2): creation, eligibility, priority raise (also mid-run), the back-off rule, the regrade reset,
 * terminal rows untouched, the gamesVersion bump, concurrency, and the generic conflict policies. Skipped unless
 * TEST_DATABASE_URL is set.
 *
 * When TEST_APP_DATABASE_URL is set (role replay_app after scripts/db/replay-app-role.sql and
 * packages/db/scripts/roles/replay_app.p3.sql), every enqueue runs as the web's role, which proves its grants.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { JOB_PRIORITY, enqueueAnalysis, enqueueJob, enqueueJobSql } from "../src/jobs";
import { INITIAL_FEN } from "../src/games";
import { TEST_URL, assertLocalTestUrl, makeUser, run, type TestUser } from "./helpers";

const APP_URL = process.env.TEST_APP_DATABASE_URL ?? TEST_URL;

interface JobDbRow {
  id: bigint;
  kind: string;
  status: string;
  priority: number;
  fairSeq: number;
  dedupeKey: string | null;
  gameId: bigint | null;
  userId: bigint | null;
  payload: Record<string, unknown>;
  result: unknown;
  runAtMs: number;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedAt: Date | null;
  heartbeatAt: Date | null;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

describe("jobs enqueue (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  /** The web's client (role replay_app when TEST_APP_DATABASE_URL is set). */
  let app: PrismaClient;
  let a: TestUser;
  let b: TestUser;
  let seq = 0;

  before(async () => {
    assertLocalTestUrl(TEST_URL!);
    assertLocalTestUrl(APP_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    app = createPrismaClient({ datasourceUrl: APP_URL });
    a = await makeUser(db, "jobs_a");
    b = await makeUser(db, "jobs_b");
  });

  after(async () => {
    await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" LIKE ${`%${run}%`}`);
    await db.$disconnect();
    await app.$disconnect();
  });

  /** A game with both members' game_players rows. */
  async function game(
    opts: { status?: string; plyCount?: number; analysisStatus?: string; members?: TestUser[] } = {},
  ): Promise<{ id: bigint; ref: string }> {
    seq++;
    const ref = `cj${run}${String(seq).padStart(4, "0")}`;
    const status = opts.status ?? "COMPLETED";
    const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO games ("referenceId", "creatorId", "opponentId", status, "startingFen", "initialTimeSeconds",
                         "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt",
                         mode, "whitePlayerId", "blackPlayerId", "plyCount", "analysisStatus", "completedAt")
      VALUES (${ref}, ${a.id}, ${b.id}, ${status}::"GameStatus", ${INITIAL_FEN}, 300, 0, 300, 300, now() + interval '1 day', now(),
              'FRIEND', ${a.id}, ${b.id}, ${opts.plyCount ?? 40}, ${opts.analysisStatus ?? "NONE"}::"AnalysisStatus",
              CASE WHEN ${status} = 'COMPLETED' THEN now() END)
      RETURNING id`);
    const id = rows[0]!.id;
    const members = opts.members ?? [a, b];
    for (const [i, m] of members.entries()) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO game_players ("gameId", "userId", color, mode, "updatedAt")
        VALUES (${id}, ${m.id}, ${i === 0 ? "w" : "b"}, 'FRIEND', now())`);
    }
    return { id, ref };
  }

  async function job(key: string): Promise<JobDbRow | undefined> {
    const rows = await db.$queryRaw<JobDbRow[]>(Prisma.sql`
      SELECT id, kind::text AS kind, status::text AS status, priority, "fairSeq", "dedupeKey", "gameId", "userId", payload,
             result, (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs", attempts, "maxAttempts", "lockedBy",
             "lockedAt", "heartbeatAt", "lastError", "startedAt", "finishedAt"
        FROM jobs WHERE "dedupeKey" = ${key}`);
    return rows[0];
  }

  async function analysisStatus(gameId: bigint): Promise<string> {
    const rows = await db.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT "analysisStatus"::text AS s FROM games WHERE id = ${gameId}`);
    return rows[0]!.s;
  }

  async function versions(): Promise<[number, number]> {
    const rows = await db.$queryRaw<{ id: bigint; v: number }[]>(
      Prisma.sql`SELECT id, "gamesVersion" AS v FROM users WHERE id IN (${a.id}, ${b.id})`,
    );
    const v = (u: TestUser) => rows.find((r) => r.id === u.id)!.v;
    return [v(a), v(b)];
  }

  async function setJob(key: string, set: Prisma.Sql) {
    await db.$executeRaw(Prisma.sql`UPDATE jobs SET ${set} WHERE "dedupeKey" = ${key}`);
  }

  const near = (ms: number, target = Date.now(), slack = 10_000) => Math.abs(ms - target) < slack;

  it("creates the job, flips NONE → QUEUED and bumps both members' gamesVersion once", async () => {
    const g = await game();
    const [va, vb] = await versions();
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.GAME_ENDED, reason: "bot_end" });
    assert.equal(r.outcome, "created");
    assert.ok(r.outcome === "created" && r.statusChanged && r.job.status === "QUEUED" && r.job.priority === 80);
    const row = (await job(`analyze:${g.id}`))!;
    assert.equal(row.kind, "ANALYZE_GAME");
    assert.equal(row.gameId, g.id);
    assert.equal(row.priority, JOB_PRIORITY.GAME_ENDED);
    assert.equal(row.fairSeq, 0);
    assert.equal(row.maxAttempts, 4);
    assert.equal(row.attempts, 0);
    assert.deepEqual(row.payload, { v: 1, gameId: g.id.toString(), gameRef: g.ref, reason: "bot_end" });
    assert.ok(near(row.runAtMs), "runAt is now (UTC)");
    assert.equal(r.outcome === "created" && r.job.runAt.getTime(), row.runAtMs);
    assert.equal(await analysisStatus(g.id), "QUEUED");
    assert.deepEqual(await versions(), [va + 1, vb + 1]);
  });

  it("refuses games that must not be analysed (ineligible): live, under 6 plies, SKIPPED, unknown", async () => {
    const live = await game({ status: "IN_PROGRESS" });
    const short = await game({ plyCount: 5 });
    const skipped = await game({ analysisStatus: "SKIPPED" });
    const before = await versions();
    for (const g of [live, short, skipped, { id: 9_000_000_000n + BigInt(seq), ref: "cnope" }]) {
      const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.USER_OPENED, reason: "opened" });
      assert.deepEqual(r, { outcome: "ineligible" });
      assert.equal(await job(`analyze:${g.id}`), undefined);
    }
    assert.equal(await analysisStatus(skipped.id), "SKIPPED");
    assert.deepEqual(await versions(), before);
  });

  it("raises a queued job's priority (never lowers it), keeps its payload, and min()s fairSeq and runAt", async () => {
    const g = await game();
    const key = `analyze:${g.id}`;
    await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.BACKLOG, reason: "backfill", fairSeq: 3 });
    await setJob(key, Prisma.sql`"runAt" = (now() AT TIME ZONE 'UTC') + interval '1 hour'`);
    const after1 = await versions();
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.USER_OPENED, reason: "opened" });
    assert.ok(r.outcome === "updated" && !r.statusChanged && r.job.priority === 100);
    let row = (await job(key))!;
    assert.equal(row.priority, JOB_PRIORITY.USER_OPENED);
    assert.equal(row.fairSeq, 0);
    assert.ok(near(row.runAtMs), "a fresh queued job is pulled forward to now");
    assert.equal(row.payload.reason, "backfill");
    assert.deepEqual(await versions(), after1, "no second bump: the status was already QUEUED");

    const lower = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.BACKLOG, reason: "backfill", fairSeq: 9 });
    assert.equal(lower.outcome, "updated");
    row = (await job(key))!;
    assert.equal(row.priority, JOB_PRIORITY.USER_OPENED);
    assert.equal(row.fairSeq, 0);
  });

  it("raises a RUNNING job's priority mid-run (the band switch) and leaves its run state alone", async () => {
    const g = await game();
    const key = `analyze:${g.id}`;
    await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    await setJob(
      key,
      Prisma.sql`status = 'RUNNING', "lockedBy" = 'dev-worker-test', "lockedAt" = now(), "heartbeatAt" = now(), attempts = 1, "startedAt" = now()`,
    );
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'RUNNING' WHERE id = ${g.id}`);
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.USER_OPENED, reason: "opened" });
    assert.ok(r.outcome === "updated" && !r.statusChanged);
    const row = (await job(key))!;
    assert.equal(row.status, "RUNNING");
    assert.equal(row.priority, JOB_PRIORITY.USER_OPENED);
    assert.equal(row.lockedBy, "dev-worker-test");
    assert.equal(row.attempts, 1);
    assert.ok(row.startedAt && row.heartbeatAt);
    assert.equal(await analysisStatus(g.id), "RUNNING");
  });

  it("does not pull a backed-off job forward (only A4 Retry does)", async () => {
    const g = await game();
    const key = `analyze:${g.id}`;
    await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.GAME_ENDED, reason: "live_end" });
    await setJob(key, Prisma.sql`attempts = 1, "lastError" = 'engine_failed: test', "runAt" = (now() AT TIME ZONE 'UTC') + interval '10 minutes'`);
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'FAILED' WHERE id = ${g.id}`);
    const before = (await job(key))!;
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.USER_OPENED, reason: "opened" });
    assert.equal(r.outcome, "updated");
    const row = (await job(key))!;
    assert.equal(row.priority, JOB_PRIORITY.USER_OPENED);
    assert.equal(row.runAtMs, before.runAtMs);
    assert.equal(row.attempts, 1);
    assert.equal(row.lastError, "engine_failed: test");
    assert.equal(await analysisStatus(g.id), "FAILED");
  });

  it("a regrade resets a DONE job: QUEUED, attempts 0, the regrade payload and priority, old run state cleared", async () => {
    const g = await game();
    const key = `analyze:${g.id}`;
    await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.GAME_ENDED, reason: "live_end" });
    await setJob(
      key,
      Prisma.sql`status = 'DONE', attempts = 2, "lockedBy" = 'dev-worker-old', "lockedAt" = now(), "heartbeatAt" = now(),
                 "startedAt" = now() - interval '1 day', "finishedAt" = now() - interval '1 day', "lastError" = 'x: y',
                 result = '{"ok":true}'::jsonb, "runAt" = now() - interval '1 day'`,
    );
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'DONE' WHERE id = ${g.id}`);
    const [va, vb] = await versions();
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" });
    assert.ok(r.outcome === "updated" && r.statusChanged && !r.job.created);
    const row = (await job(key))!;
    assert.equal(row.status, "QUEUED");
    assert.equal(row.attempts, 0);
    assert.equal(row.priority, JOB_PRIORITY.HOUSEKEEPING, "a revived job takes the new priority, not GREATEST");
    assert.equal(row.payload.reason, "regrade");
    assert.ok(near(row.runAtMs));
    for (const k of ["lockedBy", "lockedAt", "heartbeatAt", "startedAt", "finishedAt", "lastError", "result"] as const) {
      assert.equal(row[k], null, k);
    }
    assert.equal(await analysisStatus(g.id), "QUEUED");
    assert.deepEqual(await versions(), [va + 1, vb + 1]);
  });

  it("a regrade of a game whose job was pruned creates a new job and flips DONE → QUEUED", async () => {
    const g = await game({ analysisStatus: "DONE" });
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" });
    assert.ok(r.outcome === "created" && r.statusChanged);
    assert.equal(await analysisStatus(g.id), "QUEUED");
  });

  it("leaves a DONE job alone unless it is a regrade", async () => {
    const g = await game();
    const key = `analyze:${g.id}`;
    await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.GAME_ENDED, reason: "live_end" });
    await setJob(key, Prisma.sql`status = 'DONE', "finishedAt" = now()`);
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'DONE' WHERE id = ${g.id}`);
    const before = await job(key);
    const v = await versions();
    const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.USER_OPENED, reason: "opened" });
    assert.equal(r.outcome, "unchanged");
    assert.equal(r.outcome === "unchanged" && r.job.status, "DONE");
    assert.deepEqual(await job(key), before);
    assert.equal(await analysisStatus(g.id), "DONE");
    assert.deepEqual(await versions(), v);
  });

  it("never touches a terminal FAILED or CANCELLED job (A3 answers 410 from the returned row)", async () => {
    for (const terminal of ["FAILED", "CANCELLED"] as const) {
      const g = await game();
      const key = `analyze:${g.id}`;
      await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.GAME_ENDED, reason: "live_end" });
      await setJob(key, Prisma.sql`status = ${terminal}::"JobStatus", attempts = 4, "lastError" = 'engine_failed: x', "finishedAt" = now()`);
      await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'FAILED' WHERE id = ${g.id}`);
      const before = await job(key);
      const v = await versions();
      for (const reason of ["opened", "regrade", "retry"] as const) {
        const r = await enqueueAnalysis(app, { gameId: g.id, gameRef: g.ref, priority: JOB_PRIORITY.USER_OPENED, reason });
        assert.equal(r.outcome, "unchanged", `${terminal}/${reason}`);
        assert.equal(r.outcome === "unchanged" && r.job.status, terminal);
      }
      assert.deepEqual(await job(key), before);
      assert.equal(await analysisStatus(g.id), "FAILED");
      assert.deepEqual(await versions(), v);
    }
  });

  it("is safe under concurrent enqueues: one row, one creation, one gamesVersion bump", async () => {
    const g = await game();
    const [va, vb] = await versions();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        enqueueAnalysis(app, {
          gameId: g.id,
          gameRef: g.ref,
          priority: i % 2 ? JOB_PRIORITY.USER_OPENED : JOB_PRIORITY.GAME_ENDED,
          reason: i % 2 ? "opened" : "bot_end",
        }),
      ),
    );
    assert.equal(results.filter((r) => r.outcome === "created").length, 1);
    assert.equal(results.filter((r) => r.outcome === "updated").length, 7);
    const count = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM jobs WHERE "gameId" = ${g.id}`);
    assert.equal(count[0]!.n, 1);
    assert.equal((await job(`analyze:${g.id}`))!.priority, JOB_PRIORITY.USER_OPENED);
    assert.deepEqual(await versions(), [va + 1, vb + 1]);
  });

  it("does not depend on the session TimeZone", async () => {
    const one = createPrismaClient({ datasourceUrl: `${APP_URL}${APP_URL!.includes("?") ? "&" : "?"}connection_limit=1` });
    try {
      await one.$executeRaw(Prisma.sql`SET TIME ZONE 'Asia/Kolkata'`);
      const tz = await one.$queryRaw<{ tz: string }[]>(Prisma.sql`SELECT current_setting('TimeZone') AS tz`);
      assert.equal(tz[0]!.tz, "Asia/Kolkata");
      const key = `test:${run}:tz`;
      const j = (await enqueueJob(one, {
        kind: "EXPORT_BUILD",
        priority: JOB_PRIORITY.BACKLOG,
        payload: { v: 1 },
        dedupeKey: key,
      }))!;
      assert.ok(near(j.runAt.getTime()), `runAt ${j.runAt.toISOString()} is now in UTC`);
      const at = new Date("2026-11-12T21:00:00.000Z");
      const k2 = `test:${run}:tz2`;
      const j2 = (await enqueueJob(one, { kind: "EXPORT_BUILD", priority: JOB_PRIORITY.BACKLOG, payload: { v: 1 }, dedupeKey: k2, runAt: at }))!;
      assert.equal(j2.runAt.toISOString(), at.toISOString());
      assert.equal((await job(k2))!.runAtMs, at.getTime());
    } finally {
      await one.$disconnect();
    }
  });
});

describe("enqueueJob conflict policies (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  let app: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    app = createPrismaClient({ datasourceUrl: APP_URL });
  });
  after(async () => {
    await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" LIKE ${`%${run}%`} OR payload->>'run' = ${run}`);
    await db.$disconnect();
    await app.$disconnect();
  });

  const at = new Date("2026-11-12T21:00:00.000Z");
  const hk = (key: string) => ({
    kind: "HOUSEKEEPING" as const,
    priority: JOB_PRIORITY.HOUSEKEEPING,
    payload: { v: 1, day: "2026-11-12" },
    dedupeKey: key,
    runAt: at,
  });

  it("keep: DAILY_PLAN's second insert is a no-op", async () => {
    const key = `housekeeping:${run}`;
    const first = await enqueueJob(app, hk(key));
    assert.ok(first?.created);
    assert.equal(first.runAt.toISOString(), at.toISOString());
    assert.equal(await enqueueJob(app, hk(key)), null);
    const n = await db.$queryRaw<{ n: number; max: number }[]>(
      Prisma.sql`SELECT count(*)::int AS n, max("maxAttempts")::int AS max FROM jobs WHERE "dedupeKey" = ${key}`,
    );
    assert.deepEqual(n[0], { n: 1, max: 2 });
  });

  it("requeue: resets a terminal row with the new payload; a RUNNING row is left alone", async () => {
    const key = `import:${run}`;
    // P4's IMPORT_SYNC payload (CT/internal/jobs.ts ImportSyncPayloadV1); run ids are decimal bigint strings.
    const sync = (runId: string): Parameters<typeof enqueueJob>[1] => ({
      kind: "IMPORT_SYNC",
      priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL,
      payload: { v: 1, linkedAccountId: "7", runId: runId.replace("r", ""), trigger: "MANUAL" },
      dedupeKey: key,
      onConflict: "requeue",
    });
    const first = (await enqueueJob(app, sync("r1")))!;
    await db.$executeRaw(Prisma.sql`UPDATE jobs SET status = 'FAILED', attempts = 4, "lastError" = 'x: y' WHERE id = ${first.id}`);
    const again = (await enqueueJob(app, sync("r2")))!;
    assert.equal(again.id, first.id);
    assert.equal(again.status, "QUEUED");
    assert.equal(again.attempts, 0);
    assert.equal(again.created, false);
    const row = await db.$queryRaw<{ payload: { runId: string }; lastError: string | null }[]>(
      Prisma.sql`SELECT payload, "lastError" FROM jobs WHERE id = ${first.id}`,
    );
    assert.equal(row[0]!.payload.runId, "2");
    assert.equal(row[0]!.lastError, null);
    await db.$executeRaw(Prisma.sql`UPDATE jobs SET status = 'RUNNING', "lockedBy" = 'dev-worker-t' WHERE id = ${first.id}`);
    assert.equal(await enqueueJob(app, sync("r3")), null);
    const still = await db.$queryRaw<{ status: string; runId: string }[]>(
      Prisma.sql`SELECT status::text AS status, payload->>'runId' AS "runId" FROM jobs WHERE id = ${first.id}`,
    );
    assert.deepEqual(still[0], { status: "RUNNING", runId: "2" });
  });

  it("a job without a dedupeKey is always a new row", async () => {
    const one = (await enqueueJob(app, { kind: "EXPORT_BUILD", priority: JOB_PRIORITY.BACKLOG, payload: { v: 1, run } }))!;
    const two = (await enqueueJob(app, { kind: "EXPORT_BUILD", priority: JOB_PRIORITY.BACKLOG, payload: { v: 1, run } }))!;
    assert.notEqual(one.id, two.id);
    assert.ok(one.created && two.created);
  });

  it("embeds as a CTE body behind a `when` guard (A9b's attempts CTE)", async () => {
    for (const allowed of [false, true]) {
      const key = `legend:${run}:${String(allowed)}`;
      const insert = enqueueJobSql({
        kind: "LEGEND_COMPARE",
        priority: JOB_PRIORITY.USER_OPENED,
        payload: { v: 1, gameId: "1", userId: "2", gameRef: "cref" },
        dedupeKey: key,
        onConflict: "requeue",
        when: Prisma.sql`EXISTS (SELECT 1 FROM lc)`,
      });
      const rows = await app.$queryRaw<{ n: number }[]>(Prisma.sql`
        WITH lc AS (SELECT 1 AS x WHERE ${allowed}::boolean), j AS (${insert})
        SELECT count(*)::int AS n FROM j`);
      assert.equal(rows[0]!.n, allowed ? 1 : 0);
      const n = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM jobs WHERE "dedupeKey" = ${key}`);
      assert.equal(n[0]!.n, allowed ? 1 : 0);
    }
  });
});
