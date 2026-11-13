/**
 * m4a / M4 / m4v landed as written (phase-04 plan 6.1-6.5): the hand-written parts Prisma does not model behave as
 * the plan's queries need them to, on a real Postgres after `prisma migrate deploy`. Skipped unless TEST_DATABASE_URL
 * is set (a local Docker Postgres or the CI service; never Neon).
 *
 *   - one active run per account (import_runs_one_active: 23505), finished runs do not block a new one;
 *   - one verified owner per external account (linked_accounts_verified_key), unverified links coexist;
 *   - the game_players → linked_accounts FK is validated and SETs NULL on unlink; deleting a link cascades its cursor
 *     and runs; deleting a user cascades links and runs;
 *   - the user defaults (onboardingStep WELCOME, timeZone UTC, goals {}), the enum values, the audit_logs insert
 *     through @repo/db/audit, the trial ledger's array merge;
 *   - the partial indexes serve the plan's queries (EXPLAIN with seq scans off names them).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { auditSql, writeAudit } from "../src/audit";
import { releaseImportBacklog } from "../src/import-backlog";
import { createPrismaClient } from "../src/client";
import { TEST_URL, assertLocalTestUrl, makeUser, run } from "./helpers";

/** Optional role URLs (CI sets them after scripts/roles/*.sql and *.p4.sql): prove the M4 grants. */
const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
let seq = 0;

async function link(db: PrismaClient, userId: bigint, provider: "CHESSCOM" | "LICHESS", externalId: string, verified = false) {
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "verifiedAt", "updatedAt")
    VALUES (${userId}, ${provider}::"ChessProvider", ${externalId}, ${`H_${externalId}`}, ${`h_${externalId}`.toLowerCase()},
            ${verified ? Prisma.sql`now()` : Prisma.sql`NULL`}, now())
    RETURNING id`);
  const id = rows[0]!.id;
  await db.$executeRaw(Prisma.sql`INSERT INTO import_cursors ("linkedAccountId", provider, "updatedAt") VALUES (${id}, ${provider}::"ChessProvider", now())`);
  return id;
}

async function runRow(db: PrismaClient, userId: bigint, accountId: bigint, status: string) {
  seq++;
  const ref = `cr${run}${String(seq).padStart(5, "0")}`.slice(0, 25);
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "updatedAt")
    VALUES (${ref}, ${userId}, ${accountId}, 'CHESSCOM', 'INITIAL', ${status}::"ImportRunStatus", now())
    RETURNING id`);
  return rows[0]!.id;
}

async function importedGame(db: PrismaClient, userId: bigint, accountId: bigint | null) {
  seq++;
  const ref = `cg${run}${String(seq).padStart(5, "0")}`.slice(0, 25);
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                       "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", mode, source, "externalId",
                       "whitePlayerId", "plyCount", "completedAt")
    VALUES (${ref}, ${userId}, 'COMPLETED', ${INITIAL_FEN}, 600, 0, 0, 0, now(), now(), 'IMPORTED', 'CHESSCOM', ${`x${run}${seq}`},
            ${userId}, 40, now())
    RETURNING id`);
  const id = rows[0]!.id;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO game_players ("gameId", "userId", color, mode, source, "linkedAccountId", "endedAt", "updatedAt")
    VALUES (${id}, ${userId}, 'w', 'IMPORTED', 'CHESSCOM', ${accountId}, now(), now())`);
  return id;
}

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (error) {
    const e = error as { code?: string; meta?: { code?: string } };
    return e.meta?.code ?? e.code;
  }
}

describe("M4 schema (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  it("new users default to WELCOME, UTC, no goals; the M4 enums exist with the plan's values", async () => {
    const u = await makeUser(db, "m4defaults");
    const row = (await db.$queryRaw<{ step: string; tz: string; goals: string[]; onboarded: boolean }[]>(Prisma.sql`
      SELECT "onboardingStep"::text AS step, "timeZone" AS tz, goals::text[] AS goals, onboarded FROM users WHERE id = ${u.id}`))[0]!;
    assert.deepEqual(row, { step: "WELCOME", tz: "UTC", goals: [], onboarded: false });
    const enums = await db.$queryRaw<{ t: string; v: string[] }[]>(Prisma.sql`
      SELECT t.typname AS t, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS v FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname IN ('OnboardingStep','ImportRunStatus','ImportState','LinkStatus','AuditCategory') GROUP BY t.typname`);
    const by = Object.fromEntries(enums.map((r) => [r.t, r.v]));
    assert.deepEqual(by.OnboardingStep, ["WELCOME", "LINK", "CONFIRM", "LEVEL", "GOALS", "PLAN", "ACTIVATING", "DONE"]);
    assert.deepEqual(by.ImportRunStatus, ["WAITING_FOR_MEMBERSHIP", "QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"]);
    assert.deepEqual(by.LinkStatus, ["ACTIVE", "ERROR", "RELINK_REQUIRED"]);
    assert.equal(by.ImportState?.length, 6);
    assert.equal(by.AuditCategory?.length, 7);
  });

  it("the monotonic onboarding step SQL of §7.2 never moves backwards", async () => {
    const u = await makeUser(db, "m4step");
    const order = "{WELCOME,LINK,CONFIRM,LEVEL,GOALS,PLAN,ACTIVATING,DONE}";
    const step = async (to: string) =>
      (await db.$queryRaw<{ s: string }[]>(Prisma.sql`
        UPDATE users SET "onboardingStep" = CASE WHEN array_position(${order}::text[], ${to}::text)
                                                    > array_position(${order}::text[], "onboardingStep"::text)
                                                 THEN ${to}::"OnboardingStep" ELSE "onboardingStep" END
         WHERE id = ${u.id} RETURNING "onboardingStep"::text AS s`))[0]!.s;
    assert.equal(await step("GOALS"), "GOALS");
    assert.equal(await step("LINK"), "GOALS", "a late PATCH from an earlier step is ignored");
    assert.equal(await step("PLAN"), "PLAN");
  });

  it("import_runs_one_active: a second active run is 23505; a finished run does not block a new one", async () => {
    const u = await makeUser(db, "m4active");
    const acct = await link(db, u.id, "CHESSCOM", `p${run}a`);
    await runRow(db, u.id, acct, "WAITING_FOR_MEMBERSHIP");
    assert.equal(await errorCode(runRow(db, u.id, acct, "QUEUED")), "23505");
    await db.$executeRaw(Prisma.sql`UPDATE import_runs SET status = 'DONE' WHERE "linkedAccountId" = ${acct}`);
    await runRow(db, u.id, acct, "QUEUED");
    assert.equal(await errorCode(runRow(db, u.id, acct, "RUNNING")), "23505");
    await db.$executeRaw(Prisma.sql`UPDATE import_runs SET status = 'FAILED' WHERE "linkedAccountId" = ${acct} AND status = 'QUEUED'`);
    await runRow(db, u.id, acct, "QUEUED");
  });

  it("the entitlement release statement uses import_runs_waiting_idx and releases only that user's waiting runs", async () => {
    const u = await makeUser(db, "m4release");
    const other = await makeUser(db, "m4release_other");
    const a1 = await link(db, u.id, "CHESSCOM", `p${run}r1`);
    const a2 = await link(db, u.id, "LICHESS", `p${run}r2`, true);
    const a3 = await link(db, other.id, "CHESSCOM", `p${run}r3`);
    await runRow(db, u.id, a1, "WAITING_FOR_MEMBERSHIP");
    await runRow(db, u.id, a2, "WAITING_FOR_MEMBERSHIP");
    await runRow(db, other.id, a3, "WAITING_FOR_MEMBERSHIP");
    const released = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      UPDATE import_runs SET status = 'QUEUED', "updatedAt" = now()
       WHERE "userId" = ${u.id} AND status = 'WAITING_FOR_MEMBERSHIP' RETURNING id`);
    assert.equal(released.length, 2);
    const left = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM import_runs WHERE "userId" = ${other.id} AND status = 'WAITING_FOR_MEMBERSHIP'`);
    assert.equal(left[0]!.n, 1);
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
        EXPLAIN SELECT id FROM import_runs WHERE "userId" = ${other.id} AND status = 'WAITING_FOR_MEMBERSHIP'`);
    });
    assert.match(plan.map((r) => r["QUERY PLAN"]).join("\n"), /import_runs_waiting_idx/);
  });

  it("linked_accounts_verified_key: one verified owner per external id; unverified links may coexist", async () => {
    const a = await makeUser(db, "m4verA");
    const b = await makeUser(db, "m4verB");
    const c = await makeUser(db, "m4verC");
    const ext = `ext${run}`;
    await link(db, a.id, "CHESSCOM", ext);
    await link(db, b.id, "CHESSCOM", ext);
    await link(db, c.id, "LICHESS", ext, true);
    assert.equal(await errorCode(link(db, a.id, "LICHESS", ext, true)), "23505");
    assert.equal(await errorCode(link(db, a.id, "CHESSCOM", `other${run}`)), "23505", "one link per user and provider");
    const owner = await db.$queryRaw<{ userId: bigint }[]>(Prisma.sql`
      SELECT "userId" FROM linked_accounts WHERE provider = 'LICHESS' AND "externalId" = ${ext} AND "verifiedAt" IS NOT NULL AND "userId" <> ${a.id}`);
    assert.deepEqual(owner.map((r) => r.userId), [c.id]);
  });

  it("unlink: the FK is validated, SETs game_players.linkedAccountId NULL, and cascades the cursor and the runs", async () => {
    const fk = await db.$queryRaw<{ v: boolean; d: string }[]>(Prisma.sql`
      SELECT convalidated AS v, confdeltype::text AS d FROM pg_constraint WHERE conname = 'game_players_linkedAccountId_fkey'`);
    assert.deepEqual(fk[0], { v: true, d: "n" });
    const u = await makeUser(db, "m4unlink");
    const acct = await link(db, u.id, "CHESSCOM", `p${run}u`);
    await runRow(db, u.id, acct, "RUNNING");
    const g = await importedGame(db, u.id, acct);
    assert.equal(await errorCode(importedGame(db, u.id, 999_999_999n)), "23503", "the FK refuses a missing account (mid-run unlink)");
    await db.$executeRaw(Prisma.sql`DELETE FROM linked_accounts WHERE id = ${acct}`);
    const rows = await db.$queryRaw<{ la: bigint | null; cursors: number; runs: number }[]>(Prisma.sql`
      SELECT (SELECT "linkedAccountId" FROM game_players WHERE "gameId" = ${g} AND "userId" = ${u.id}) AS la,
             (SELECT count(*)::int FROM import_cursors WHERE "linkedAccountId" = ${acct}) AS cursors,
             (SELECT count(*)::int FROM import_runs WHERE "linkedAccountId" = ${acct}) AS runs`);
    assert.deepEqual(rows[0], { la: null, cursors: 0, runs: 0 });
  });

  it("deleting a user cascades links, cursors and runs", async () => {
    const u = await makeUser(db, "m4userdel", { stats: false });
    const acct = await link(db, u.id, "LICHESS", `p${run}d`, true);
    await runRow(db, u.id, acct, "QUEUED");
    await db.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ${u.id}`);
    const n = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT (SELECT count(*) FROM linked_accounts WHERE "userId" = ${u.id}) + (SELECT count(*) FROM import_runs WHERE "userId" = ${u.id})
             + (SELECT count(*) FROM import_cursors WHERE "linkedAccountId" = ${acct}) AS n`);
    assert.equal(Number(n[0]!.n), 0);
  });

  it("audit_logs: @repo/db/audit inserts one row with UTC time and PII-free meta; strict mode refuses an email key", async () => {
    const action = `account.linked_${run}`.replace(/[^a-z0-9_.]/g, "_");
    await writeAudit(db, {
      category: "ACCOUNT",
      action,
      actorKind: "USER",
      actorUserId: 42n,
      targetType: "linked_account",
      targetId: "chesscom",
      requestId: "req_123",
      meta: { verified: false, games: 12n },
      at: new Date("2026-11-10T09:30:00.000Z"),
    });
    const rows = await db.$queryRaw<{ at: Date; category: string; meta: unknown; actor: bigint }[]>(Prisma.sql`
      SELECT at, category::text AS category, meta, "actorUserId" AS actor FROM audit_logs WHERE action = ${action}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.at.toISOString(), "2026-11-10T09:30:00.000Z");
    assert.deepEqual(rows[0]!.meta, { verified: false, games: "12" });
    assert.equal(rows[0]!.actor, 42n);
    assert.throws(() => auditSql({ category: "ACCOUNT", action: "account.linked", actorKind: "USER", meta: { userEmail: "x" } }), /forbidden key/);
  });

  it("trial_ledger: the §8.4 merge keeps one row per email hash and the union of handle hashes", async () => {
    const hash = (run + "0".repeat(64)).slice(0, 64);
    const write = (handles: string[]) =>
      db.$executeRaw(Prisma.sql`
        INSERT INTO trial_ledger ("emailHash", "handleHashes") VALUES (${hash}, ${handles}::text[])
        ON CONFLICT ("emailHash") DO UPDATE SET "handleHashes" =
          ARRAY(SELECT DISTINCT unnest(trial_ledger."handleHashes" || EXCLUDED."handleHashes") ORDER BY 1)`);
    const [a, b, c] = [`u:a${run}`, `v:b${run}`, `u:c${run}`];
    await write([a, b]);
    await write([b, c]);
    const row = await db.$queryRaw<{ h: string[] }[]>(Prisma.sql`SELECT "handleHashes" AS h FROM trial_ledger WHERE "emailHash" = ${hash}`);
    assert.deepEqual(row[0]!.h, [a, c, b].sort());
    const hit = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM trial_ledger WHERE "emailHash" = ${"f".repeat(64)} OR "handleHashes" && ${[b]}::text[]`);
    assert.equal(hit[0]!.n, 1);
  });

  it("the daily-sync backstop query of §6.3 uses linked_accounts_autosync_idx", async () => {
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
        EXPLAIN SELECT id, "userId" FROM linked_accounts la
         WHERE "autoImport" AND status = 'ACTIVE' AND "nextAutoSyncAt" < (now() AT TIME ZONE 'UTC') - interval '1 hour'
           AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = 'import:' || la.id AND j.status IN ('QUEUED','RUNNING'))
         LIMIT 200`);
    });
    assert.match(plan.map((r) => r["QUERY PLAN"]).join("\n"), /linked_accounts_autosync_idx/);
  });
});

describe("import_purge_batch() (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  it("purges one source in batches; a game the opponent also imported survives with only this side cleared", async () => {
    const me = await makeUser(db, "purge_me");
    const opp = await makeUser(db, "purge_opp");
    const acct = await link(db, me.id, "CHESSCOM", `pp${run}`);
    const mine = [await importedGame(db, me.id, acct), await importedGame(db, me.id, acct), await importedGame(db, me.id, acct)];
    // The opponent imported the same game (the batch writer's DO UPDATE path): black is the opponent.
    await db.$executeRaw(Prisma.sql`UPDATE games SET "blackPlayerId" = ${opp.id} WHERE id = ${mine[0]!}`);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO game_players ("gameId", "userId", color, mode, source, "endedAt", "updatedAt")
      VALUES (${mine[0]!}, ${opp.id}, 'b', 'IMPORTED', 'CHESSCOM', now(), now())`);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO jobs (kind, "dedupeKey", "gameId", payload) VALUES ('ANALYZE_GAME', ${`analyze:${mine[1]!}`}, ${mine[1]!}, '{"v":1}')`);
    const keepLichess = await importedGame(db, me.id, null);
    await db.$executeRaw(Prisma.sql`UPDATE games SET source = 'LICHESS' WHERE id = ${keepLichess}`);
    await db.$executeRaw(Prisma.sql`UPDATE game_players SET source = 'LICHESS' WHERE "gameId" = ${keepLichess}`);
    const v0 = (await db.$queryRaw<{ v: number }[]>(Prisma.sql`SELECT "gamesVersion" AS v FROM users WHERE id = ${me.id}`))[0]!.v;

    type Batch = { deleted_players: number; deleted_games: number; cleared_games: number; game_ids: bigint[] };
    const batch = (limit: number) =>
      db.$queryRaw<Batch[]>(Prisma.sql`SELECT * FROM import_purge_batch(${me.id}::bigint, 'CHESSCOM'::"GameSource", ${limit}::int)`);
    const first = (await batch(2))[0]!;
    assert.equal(first.deleted_players, 2);
    const second = (await batch(2))[0]!;
    assert.equal(second.deleted_players, 1);
    const done = (await batch(2))[0]!;
    assert.deepEqual([done.deleted_players, done.deleted_games, done.cleared_games, done.game_ids], [0, 0, 0, []]);
    assert.equal(first.deleted_games + second.deleted_games, 2, "the shared game survives");
    assert.equal(first.cleared_games + second.cleared_games, 1);

    const shared = (await db.$queryRaw<{ w: bigint | null; b: bigint | null }[]>(Prisma.sql`
      SELECT "whitePlayerId" AS w, "blackPlayerId" AS b FROM games WHERE id = ${mine[0]!}`))[0]!;
    assert.deepEqual(shared, { w: null, b: opp.id });
    const left = await db.$queryRaw<{ n: number; jobs: number; lichess: number }[]>(Prisma.sql`
      SELECT (SELECT count(*)::int FROM game_players WHERE "userId" = ${me.id} AND source = 'CHESSCOM') AS n,
             (SELECT count(*)::int FROM jobs WHERE "dedupeKey" = ${`analyze:${mine[1]!}`}) AS jobs,
             (SELECT count(*)::int FROM game_players WHERE "userId" = ${me.id} AND source = 'LICHESS') AS lichess`);
    assert.deepEqual(left[0], { n: 0, jobs: 0, lichess: 1 });
    const v1 = (await db.$queryRaw<{ v: number }[]>(Prisma.sql`SELECT "gamesVersion" AS v FROM users WHERE id = ${me.id}`))[0]!.v;
    assert.equal(v1, v0 + 2, "one bump per non-empty batch");
  });

  it("refuses REPLAY and a bad limit", async () => {
    assert.match(String(await errorMessage(db.$queryRaw(Prisma.sql`SELECT * FROM import_purge_batch(1::bigint, 'REPLAY'::"GameSource", 10)`))), /never purged/);
    assert.match(String(await errorMessage(db.$queryRaw(Prisma.sql`SELECT * FROM import_purge_batch(1::bigint, 'LICHESS'::"GameSource", 0)`))), /p_limit/);
  });
});

async function errorMessage(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("M4 role grants (Postgres)", { skip: TEST_URL && (WORKER_URL || APP_URL) ? false : "no role URLs set" }, () => {
  let db: PrismaClient;
  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  async function denied(p: Promise<unknown>) {
    assert.match(String(await errorMessage(p)), /permission denied/);
  }

  it("replay_worker: imports through the batch writer's columns, purges only through the function", { skip: WORKER_URL ? false : "TEST_WORKER_DATABASE_URL not set" }, async () => {
    assertLocalTestUrl(WORKER_URL!);
    const wk = createPrismaClient({ datasourceUrl: WORKER_URL });
    try {
      const u = await makeUser(db, "wk_import");
      const acct = await link(db, u.id, "CHESSCOM", `wk${run}`);
      const ctx = await wk.$queryRaw<{ status: string | null; tz: string }[]>(Prisma.sql`
        SELECT "subscriptionStatus" AS status, "timeZone" AS tz FROM users WHERE id = ${u.id}`);
      assert.equal(ctx[0]!.tz, "UTC");
      const ref = `cw${run}`.slice(0, 25);
      const ins = await wk.$queryRaw<{ id: bigint; created: boolean }[]>(Prisma.sql`
        INSERT INTO games ("referenceId", source, "externalId", mode, status, "completedAt", "expiresAt", moves, "plyCount",
                           "startingFen", "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
                           "creatorId", "whitePlayerId", "updatedAt")
        VALUES (${ref}, 'CHESSCOM', ${`wk${run}`}, 'IMPORTED', 'COMPLETED', now(), now(), 'e2e4 e7e5', 2, ${INITIAL_FEN}, 600, 0, 0, 0,
                ${u.id}, ${u.id}, now())
        ON CONFLICT (source, "externalId") DO UPDATE SET "whitePlayerId" = COALESCE(games."whitePlayerId", EXCLUDED."whitePlayerId")
        RETURNING id, (xmax = 0) AS created`);
      assert.equal(ins[0]!.created, true);
      await wk.$executeRaw(Prisma.sql`
        INSERT INTO game_players ("gameId", "userId", color, source, mode, "linkedAccountId", "endedAt", "updatedAt")
        VALUES (${ins[0]!.id}, ${u.id}, 'w', 'CHESSCOM', 'IMPORTED', ${acct}, now(), now())`);
      await wk.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "importedCount" = "importedCount" + 1, "importState" = 'RUNNING' WHERE id = ${acct}`);
      await wk.$executeRaw(Prisma.sql`UPDATE import_cursors SET archives = '{"v":1,"months":{}}'::jsonb, "updatedAt" = now() WHERE "linkedAccountId" = ${acct}`);
      await wk.$executeRaw(Prisma.sql`
        INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "updatedAt")
        VALUES (${`cx${run}`.slice(0, 25)}, ${u.id}, ${acct}, 'CHESSCOM', 'DAILY', 'RUNNING', now())`);
      await wk.$executeRaw(Prisma.sql`
        INSERT INTO audit_logs (category, action, "actorKind", "targetType", "targetId", meta)
        VALUES ('ACCOUNT', 'account.purged', 'WORKER', 'user', ${u.ref}, '{"games":1}'::jsonb)`);
      // The backlog release runs as the worker too (right after a paying member's INITIAL run, §8.9).
      await db.$executeRaw(Prisma.sql`UPDATE games SET "plyCount" = 40 WHERE id = ${ins[0]!.id}`);
      const released = await releaseImportBacklog(wk, { userId: u.id, now: new Date(), spreadDays: 1 });
      assert.equal(released.queued, 1);
      const purged = await wk.$queryRaw<{ deleted_players: number }[]>(Prisma.sql`
        SELECT * FROM import_purge_batch(${u.id}::bigint, 'CHESSCOM'::"GameSource", 500)`);
      assert.equal(purged[0]!.deleted_players, 1);

      await denied(wk.$queryRaw(Prisma.sql`SELECT email FROM users WHERE id = ${u.id}`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT "dodoCustomerId" FROM users WHERE id = ${u.id}`));
      await denied(wk.$executeRaw(Prisma.sql`DELETE FROM games WHERE id = ${ins[0]!.id}`));
      await denied(wk.$executeRaw(Prisma.sql`DELETE FROM game_players WHERE "userId" = ${u.id}`));
      await denied(wk.$executeRaw(Prisma.sql`DELETE FROM linked_accounts WHERE id = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE games SET pgn = '' WHERE id = ${ins[0]!.id}`));
      await denied(wk.$executeRaw(Prisma.sql`
        INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                           "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", pgn)
        VALUES (${`cy${run}`.slice(0, 25)}, ${u.id}, 'COMPLETED', ${INITIAL_FEN}, 1, 0, 0, 0, now(), now(), 'x')`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT * FROM trial_ledger LIMIT 1`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT * FROM audit_logs LIMIT 1`));

      // regression: worker-table-wide-import-update (FIX-2, review round 2): UPDATE on the import tables is per column;
      // a compromised worker cannot move a link or a run to another user, re-point it, or mark a link verified.
      const other = await makeUser(db, "wk_other");
      await denied(wk.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "userId" = ${other.id} WHERE id = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "verifiedAt" = now() WHERE id = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "usernameLower" = 'victim' WHERE id = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE linked_accounts SET provider = 'LICHESS' WHERE id = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE import_runs SET "userId" = ${other.id} WHERE "linkedAccountId" = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE import_runs SET "linkedAccountId" = NULL WHERE "linkedAccountId" = ${acct}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE import_cursors SET "linkedAccountId" = ${acct} WHERE "linkedAccountId" = ${acct}`));
      // …while every column the run statements write is still writable.
      await wk.$executeRaw(Prisma.sql`
        UPDATE linked_accounts SET status = 'ACTIVE', "importState" = 'IDLE', "lastSyncAt" = now(), "lastSyncOkAt" = now(),
               "nextAutoSyncAt" = NULL, "nextAllowedSyncAt" = NULL, "lastError" = NULL, "skippedCount" = 0,
               "importedCount" = 0, title = NULL, "avatarUrl" = NULL, "externalId" = "externalId", "updatedAt" = now()
         WHERE id = ${acct}`);
      await wk.$executeRaw(Prisma.sql`
        UPDATE import_runs SET status = 'DONE', phase = NULL, "startedAt" = now(), "finishedAt" = now(), error = NULL,
               total = 0, seen = 0, skipped = 0, imported = 0, "analysisQueued" = 0, "firstGameId" = NULL, analysed = 0,
               "updatedAt" = now()
         WHERE "linkedAccountId" = ${acct}`);
      await wk.$executeRaw(Prisma.sql`
        UPDATE import_cursors SET "archivesEtag" = NULL, "archivesLastModified" = NULL, "lichessSinceMs" = NULL,
               "lichessResumeUntilMs" = NULL, "oldestImportedAt" = NULL, seen = 0, "skippedVariants" = 0, "updatedAt" = now()
         WHERE "linkedAccountId" = ${acct}`);
    } finally {
      await wk.$disconnect();
    }
  });

  it("replay_app: links, releases runs, writes the ledger and audit; cannot run the purge function", { skip: APP_URL ? false : "TEST_APP_DATABASE_URL not set" }, async () => {
    assertLocalTestUrl(APP_URL!);
    const app = createPrismaClient({ datasourceUrl: APP_URL });
    try {
      const u = await makeUser(db, "app_link");
      const rows = await app.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "updatedAt")
        VALUES (${u.id}, 'CHESSCOM', ${`ap${run}`}, 'Owl', 'owl', now()) RETURNING id`);
      await app.$executeRaw(Prisma.sql`INSERT INTO import_cursors ("linkedAccountId", provider, "updatedAt") VALUES (${rows[0]!.id}, 'CHESSCOM', now())`);
      await app.$executeRaw(Prisma.sql`
        INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "updatedAt")
        VALUES (${`ca${run}`.slice(0, 25)}, ${u.id}, ${rows[0]!.id}, 'CHESSCOM', 'INITIAL', 'WAITING_FOR_MEMBERSHIP', now())`);
      await app.$executeRaw(Prisma.sql`UPDATE import_runs SET status = 'QUEUED' WHERE "userId" = ${u.id} AND status = 'WAITING_FOR_MEMBERSHIP'`);
      await app.$executeRaw(Prisma.sql`
        UPDATE users SET "onboardingStep" = 'LEVEL', "timeZone" = 'Asia/Kolkata', "pendingCheckoutAt" = now() WHERE id = ${u.id}`);
      await app.$executeRaw(Prisma.sql`
        INSERT INTO trial_ledger ("emailHash", "handleHashes") VALUES (${(`a${run}` + "0".repeat(64)).slice(0, 64)}, '{}')
        ON CONFLICT ("emailHash") DO NOTHING`);
      await app.$executeRaw(Prisma.sql`INSERT INTO audit_logs (category, action, "actorKind") VALUES ('ACCOUNT', 'account.linked', 'USER')`);
      await app.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${`import:${rows[0]!.id}`} AND status = 'QUEUED'`);
      await app.$executeRaw(Prisma.sql`DELETE FROM linked_accounts WHERE id = ${rows[0]!.id}`);
      await denied(app.$queryRaw(Prisma.sql`SELECT * FROM import_purge_batch(${u.id}::bigint, 'CHESSCOM'::"GameSource", 1)`));
    } finally {
      await app.$disconnect();
    }
  });
});
