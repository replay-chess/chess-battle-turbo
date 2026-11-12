/**
 * M3 landed as written (phase-03 plan 6.1-6.4, task B1): the enums, the new tables and columns, every protected M3
 * partial index with its predicate, lz4 on the JSON documents, and review_progress_merge() (parity with its
 * TypeScript twin, monotonic merges). Skipped unless TEST_DATABASE_URL is set.
 *
 * Optional role URLs prove packages/db/scripts/roles/*.sql:
 *   TEST_WORKER_DATABASE_URL   replay_worker (replay_worker.sql): its writes work, everything else is denied;
 *   TEST_REALTIME_DATABASE_URL replay_realtime (sql/roles.sql + socket.p3.sql): the finish-fragment insert works,
 *                              UPDATE/DELETE on jobs is denied;
 *   TEST_APP_DATABASE_URL      replay_app: A5's progress UPDATE through review_progress_merge.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { INITIAL_FEN } from "../src/games";
import {
  ReviewProgressV1,
  mergeReviewProgress,
  type ReviewProgressPatch,
  type ReviewProgressV1 as Progress,
} from "../src/json/review";
import { TEST_URL, assertLocalTestUrl, makeUser, run, type TestUser } from "./helpers";

const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL;
const REALTIME_URL = process.env.TEST_REALTIME_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL ?? TEST_URL;

describe("M3 schema (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  it("creates the M3 enums with every value (the enum rollback rule)", async () => {
    const rows = await db.$queryRaw<{ t: string; v: string }[]>(Prisma.sql`
      SELECT t.typname AS t, e.enumlabel AS v FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname IN ('JobKind','JobStatus','AnalysisStatus','EvalSource','Judgement','ComparisonStatus','ShareKind')
       ORDER BY t.typname, e.enumsortorder`);
    const by = (t: string) => rows.filter((r) => r.t === t).map((r) => r.v);
    assert.equal(by("JobKind").length, 10);
    assert.ok(!by("JobKind").includes("HOURLY_TICK"));
    assert.deepEqual(by("JobStatus"), ["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"]);
    assert.deepEqual(by("AnalysisStatus"), ["NONE", "QUEUED", "RUNNING", "DONE", "FAILED", "SKIPPED"]);
    assert.deepEqual(by("EvalSource"), ["ENGINE", "LICHESS", "MIXED"]);
    assert.equal(by("Judgement").length, 12);
    assert.deepEqual(by("ComparisonStatus"), ["FACTS_READY", "NARRATING", "READY", "FAILED"]);
    assert.deepEqual(by("ShareKind"), ["POSITION", "REVIEW"]);
  });

  it("adds the new columns with their defaults, and not the ones M1/M2 already shipped", async () => {
    const cols = await db.$queryRaw<{ t: string; c: string; d: string | null; n: string }[]>(Prisma.sql`
      SELECT table_name AS t, column_name AS c, column_default AS d, is_nullable AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('games', 'game_players', 'openings', 'users')`);
    const col = (t: string, c: string) => cols.find((r) => r.t === t && r.c === c);
    assert.match(col("games", "analysisStatus")!.d!, /'NONE'/);
    assert.equal(col("games", "analysisStatus")!.n, "NO");
    for (const c of ["ecoCode", "openingName"]) assert.equal(col("games", c)?.n, "YES", c);
    for (const c of ["accuracy", "headline", "counts", "phaseAccuracy", "ecoCode"]) assert.ok(col("game_players", c), c);
    assert.match(col("game_players", "momentsCount")!.d!, /^0/);
    assert.ok(col("openings", "epd"));
    assert.equal(cols.filter((r) => r.t === "users" && r.c === "gamesVersion").length, 1);
  });

  it("every M3 index exists, the partial ones with their predicates", async () => {
    const rows = await db.$queryRaw<{ n: string; d: string }[]>(
      Prisma.sql`SELECT indexname AS n, indexdef AS d FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const def = (n: string) => rows.find((r) => r.n === n)?.d ?? "";
    assert.match(def("jobs_ready_idx"), /\(priority DESC, "fairSeq", "runAt"\) WHERE \(status = 'QUEUED'/);
    assert.match(def("jobs_running_idx"), /\("heartbeatAt"\) WHERE \(status = 'RUNNING'/);
    assert.match(def("jobs_finished_idx"), /\("finishedAt"\) WHERE \(status = ANY/);
    assert.match(def("openings_epd_idx"), /\(epd\) WHERE \(epd IS NOT NULL\)/);
    assert.match(def("shares_owner_idx"), /\("ownerId", "createdAt" DESC\) WHERE \(kind = 'REVIEW'/);
    assert.match(def("shares_expires_idx"), /WHERE \("expiresAt" IS NOT NULL\)/);
    assert.match(def("shares_game_idx"), /WHERE \("gameId" IS NOT NULL\)/);
    for (const n of [
      "jobs_dedupeKey_key",
      "shares_code_key",
      "legend_comparisons_userId_idx",
      "game_analyses_pkey",
      "player_reviews_pkey",
      "legend_comparisons_pkey",
      "game_players_userId_endedAt_gameId_idx",
    ]) {
      assert.ok(def(n), n);
    }
  });

  it("lz4 compresses the read-whole JSON documents", async () => {
    const rows = await db.$queryRaw<{ t: string; c: string }[]>(Prisma.sql`
      SELECT c.relname || '.' || a.attname AS t, a.attcompression::text AS c FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
       WHERE (c.relname, a.attname) IN (('game_analyses','lines'), ('player_reviews','content'), ('shares','snapshot'))
         -- The migrated tables only: the worker's integration suites run alongside (pnpm -r) with private copies of
         -- game_analyses in wk_* schemas (regression: lz4-schema-scope).
         AND c.relnamespace = 'public'::regnamespace
       ORDER BY 1`);
    assert.deepEqual(
      rows.map((r) => [r.t, r.c]),
      [
        ["game_analyses.lines", "l"],
        ["player_reviews.content", "l"],
        ["shares.snapshot", "l"],
      ],
    );
  });

  it("the jobs columns default as the plan says (QUEUED, priority 10, payload {v:1}, 4 attempts)", async () => {
    const rows = await db.$queryRaw<{ status: string; priority: number; payload: unknown; max: number; fair: number }[]>(Prisma.sql`
      WITH j AS (INSERT INTO jobs (kind, "dedupeKey") VALUES ('EXPORT_BUILD', ${`m3:${run}:defaults`}) RETURNING *)
      SELECT status::text AS status, priority, payload, "maxAttempts" AS max, "fairSeq" AS fair FROM j`);
    assert.deepEqual(rows[0], { status: "QUEUED", priority: 10, payload: { v: 1 }, max: 4, fair: 0 });
    await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${`m3:${run}:defaults`}`);
  });

  it("player_reviews cascades from game_players' (gameId, color); shares cascade from games and null their owner", async () => {
    const u = await makeUser(db, "m3_cascade");
    const g = await insertGame(db, u, "cascade");
    await db.$executeRaw(Prisma.sql`INSERT INTO player_reviews ("gameId", color, "updatedAt") VALUES (${g}, 'w', now())`);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO shares (code, kind, "ownerId", "gameId") VALUES (${`c${run}`.slice(0, 10)}, 'REVIEW', ${u.id}, ${g})`);
    await db.$executeRaw(Prisma.sql`DELETE FROM game_players WHERE "gameId" = ${g}`);
    const left = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM player_reviews WHERE "gameId" = ${g}`);
    assert.equal(left[0]!.n, 0);
    await db.$executeRaw(Prisma.sql`DELETE FROM games WHERE id = ${g}`);
    const shares = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM shares WHERE "gameId" = ${g}`);
    assert.equal(shares[0]!.n, 0);
  });
});

async function insertGame(db: PrismaClient, u: TestUser, tag: string): Promise<bigint> {
  const ref = `cm3${run}${tag}`.slice(0, 30);
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                       "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", mode, "whitePlayerId",
                       "plyCount", "completedAt")
    VALUES (${ref}, ${u.id}, 'COMPLETED', ${INITIAL_FEN}, 300, 0, 300, 300, now(), now(), 'BOT', ${u.id}, 40, now())
    RETURNING id`);
  const id = rows[0]!.id;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO game_players ("gameId", "userId", color, mode, "updatedAt") VALUES (${id}, ${u.id}, 'w', 'BOT', now())`);
  return id;
}

describe("review_progress_merge (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  let app: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    assertLocalTestUrl(APP_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    app = createPrismaClient({ datasourceUrl: APP_URL });
  });
  after(async () => {
    await db.$disconnect();
    await app.$disconnect();
  });

  async function sqlMerge(p: Progress | null, patch: ReviewProgressPatch, idx: number | null): Promise<unknown> {
    const rows = await db.$queryRaw<{ m: unknown }[]>(Prisma.sql`
      SELECT review_progress_merge(${p === null ? null : JSON.stringify(p)}::jsonb, ${JSON.stringify(patch)}::jsonb, ${idx}::int) AS m`);
    return rows[0]!.m;
  }

  const stored: Progress = {
    v: 1,
    momentIndex: 2,
    results: { "32": "FOUND_RETRY" },
    attempts: { "32": 3, "36": 50 },
    planChips: { "32": "attack" },
    bankOptOut: [40],
  };
  const cases: [string, Progress | null, ReviewProgressPatch, number | null][] = [
    ["first write on a NULL column", null, { results: { "32": "FOUND" }, attempts: { "32": 1 }, planChips: { "32": "trade" } }, 1],
    ["empty patch", stored, {}, null],
    ["a result is never overwritten; new plies are added", stored, { results: { "32": "REVEALED", "36": "FOUND" } }, 2],
    ["momentIndex never goes back", stored, {}, 0],
    ["momentIndex is clamped to 3", stored, {}, 7],
    ["attempts keep the per-ply max and cap at 50", stored, { attempts: { "32": 2, "36": 51, "40": 60 } }, 3],
    ["the latest chip wins", stored, { planChips: { "32": "defend", "36": "unsure" } }, 2],
    ["a negative index reads as 0", null, {}, -4],
  ];

  for (const [name, p, patch, idx] of cases) {
    it(`matches mergeReviewProgress: ${name}`, async () => {
      const fromSql = await sqlMerge(p, patch, idx);
      assert.deepEqual(fromSql, mergeReviewProgress(p, patch, idx));
      assert.equal(ReviewProgressV1.safeParse(fromSql).success, true, "the result is a valid ReviewProgressV1");
    });
  }

  it("A5's UPDATE (as the web's role) is monotonic across replayed and reordered batches", async () => {
    const u = await makeUser(db, "m3_progress");
    const g = await insertGame(db, u, "progress");
    await db.$executeRaw(Prisma.sql`INSERT INTO player_reviews ("gameId", color, "updatedAt") VALUES (${g}, 'w', now())`);
    const a5 = (patch: ReviewProgressPatch, idx: number) =>
      app.$executeRaw(Prisma.sql`
        UPDATE player_reviews SET progress = review_progress_merge(progress, ${JSON.stringify(patch)}::jsonb, ${idx}::int),
               "startedAt" = COALESCE("startedAt", (now() AT TIME ZONE 'UTC')), "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE "gameId" = ${g} AND color = 'w'`);
    await a5({ results: { "32": "FOUND_RETRY" }, attempts: { "32": 2 } }, 1);
    await a5({ results: { "36": "REVEALED" }, attempts: { "36": 3 }, planChips: { "36": "defend" } }, 2);
    await a5({ results: { "32": "FOUND" }, attempts: { "32": 1 } }, 1); // a late beacon of the first batch
    await a5({ results: { "36": "REVEALED" }, attempts: { "36": 3 }, planChips: { "36": "defend" } }, 2); // a replay
    const rows = await db.$queryRaw<{ p: unknown; started: Date | null }[]>(
      Prisma.sql`SELECT progress AS p, "startedAt" AS started FROM player_reviews WHERE "gameId" = ${g} AND color = 'w'`,
    );
    assert.deepEqual(rows[0]!.p, {
      v: 1,
      momentIndex: 2,
      results: { "32": "FOUND_RETRY", "36": "REVEALED" },
      attempts: { "32": 2, "36": 3 },
      planChips: { "36": "defend" },
      bankOptOut: [],
    });
    assert.ok(rows[0]!.started);
  });
});

describe("M3 role grants (Postgres)", { skip: TEST_URL && (WORKER_URL || REALTIME_URL) ? false : "no role URLs set" }, () => {
  let db: PrismaClient;
  let u: TestUser;
  let gameId: bigint;

  before(async () => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    u = await makeUser(db, "m3_roles");
    gameId = await insertGame(db, u, "roles");
  });
  after(async () => {
    await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" LIKE ${`%${run}%`}`);
    await db.$disconnect();
  });

  const denied = async (p: Promise<unknown>) => {
    await assert.rejects(p, (e: Error) => /permission denied/.test(e.message));
  };

  it("replay_worker: runs its pipeline writes, and nothing else", { skip: WORKER_URL ? false : "TEST_WORKER_DATABASE_URL not set" }, async () => {
    assertLocalTestUrl(WORKER_URL!);
    const wk = createPrismaClient({ datasourceUrl: WORKER_URL });
    try {
      const key = `wk:${run}`;
      await wk.$executeRaw(Prisma.sql`INSERT INTO jobs (kind, "dedupeKey", "gameId") VALUES ('ANALYZE_GAME', ${key}, ${gameId})`);
      await wk.$executeRaw(Prisma.sql`
        UPDATE jobs SET status = 'RUNNING', "lockedBy" = 'test-worker-1', "heartbeatAt" = now() WHERE "dedupeKey" = ${key}`);
      await wk.$executeRaw(Prisma.sql`
        INSERT INTO game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "totalPlies", "gradedPlies",
                                   evals, second, best, judgements, "countsWhite", "countsBlack", "updatedAt")
        VALUES (${gameId}, 1, 'sf18-test/sf18-v1', 120000, 1000000, 40, 10, '{20,25}', '{0,0}', '{0}', '{0}', '{}', '{}', now())`);
      await wk.$executeRaw(Prisma.sql`INSERT INTO player_reviews ("gameId", color, "textStatus", "updatedAt") VALUES (${gameId}, 'w', 'TEMPLATE', now())`);
      await wk.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'DONE', "ecoCode" = 'C59', "openingName" = 'Two Knights' WHERE id = ${gameId}`);
      await wk.$executeRaw(Prisma.sql`
        UPDATE game_players SET accuracy = 81.5, headline = 'Clean game', "momentsCount" = 0, counts = '{0,1}', "phaseAccuracy" = '{90,80,-1}', "ecoCode" = 'C59'
         WHERE "gameId" = ${gameId}`);
      await wk.$executeRaw(Prisma.sql`UPDATE users SET "gamesVersion" = "gamesVersion" + 1 WHERE id = ${u.id}`);
      const read = await wk.$queryRaw<{ ref: string }[]>(Prisma.sql`SELECT "referenceId" AS ref FROM users WHERE id = ${u.id}`);
      assert.equal(read[0]!.ref, u.ref);
      await wk.$executeRaw(Prisma.sql`DELETE FROM rate_limit_buckets WHERE "resetAt" < now() - interval '1 hour'`);
      await wk.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${key}`);

      await denied(wk.$queryRaw(Prisma.sql`SELECT email FROM users WHERE id = ${u.id}`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id = ${u.id}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE games SET moves = '' WHERE id = ${gameId}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE games SET "openingId" = NULL WHERE id = ${gameId}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE game_players SET result = 'WIN' WHERE "gameId" = ${gameId}`));
      await denied(wk.$executeRaw(Prisma.sql`DELETE FROM game_players WHERE "gameId" = ${gameId}`));
      await denied(wk.$executeRaw(Prisma.sql`DELETE FROM games WHERE id = ${gameId}`));
      await denied(wk.$executeRaw(Prisma.sql`UPDATE users SET name = 'x' WHERE id = ${u.id}`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT count(*) FROM webhook_events`));
      // legends: the historical name only (the legend facts rule), never the rest of the record.
      await wk.$queryRaw(Prisma.sql`SELECT id, name FROM legends LIMIT 1`);
      await denied(wk.$queryRaw(Prisma.sql`SELECT * FROM legends LIMIT 1`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT achievements FROM legends LIMIT 1`));
      // shares: the prune's columns only (regression: worker-reads-share-snapshots, FIX-2), never the snapshot JSON with
      // the sharer's name or the owner.
      await wk.$queryRaw(Prisma.sql`SELECT id, code, kind, "expiresAt", "revokedAt" FROM shares LIMIT 1`);
      await wk.$executeRaw(
        Prisma.sql`DELETE FROM shares WHERE kind = 'REVIEW' AND "expiresAt" IS NOT NULL AND "expiresAt" < now() - interval '3650 days'`,
      );
      await denied(wk.$queryRaw(Prisma.sql`SELECT snapshot FROM shares LIMIT 1`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT "ownerId" FROM shares LIMIT 1`));
      await denied(wk.$queryRaw(Prisma.sql`SELECT * FROM shares LIMIT 1`));
    } finally {
      await wk.$disconnect();
    }
  });

  it("replay_realtime: the finish fragment's job insert works; UPDATE/DELETE on jobs is denied", { skip: REALTIME_URL ? false : "TEST_REALTIME_DATABASE_URL not set" }, async () => {
    assertLocalTestUrl(REALTIME_URL!);
    const rt = createPrismaClient({ datasourceUrl: REALTIME_URL });
    try {
      const key = `rt:${run}`;
      const insert = Prisma.sql`
        INSERT INTO jobs (kind, priority, "dedupeKey", "gameId", payload)
        VALUES ('ANALYZE_GAME', 80, ${key}, ${gameId}, '{"v":1}'::jsonb) ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id`;
      const first = await rt.$queryRaw<{ id: bigint }[]>(insert);
      assert.equal(first.length, 1);
      const again = await rt.$queryRaw<{ id: bigint }[]>(insert);
      assert.equal(again.length, 0);
      await rt.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'QUEUED' WHERE id = ${gameId}`);
      const s = await rt.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT "analysisStatus"::text AS s FROM games WHERE id = ${gameId}`);
      assert.equal(s[0]!.s, "QUEUED");
      await denied(rt.$executeRaw(Prisma.sql`UPDATE jobs SET priority = 100 WHERE "dedupeKey" = ${key}`));
      await denied(rt.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${key}`));
      await denied(rt.$queryRaw(Prisma.sql`SELECT count(*) FROM game_analyses`));
    } finally {
      await rt.$disconnect();
    }
  });
});
