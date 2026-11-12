/**
 * P3's finish fragment against a real Postgres (phase-03 plan §7.4, §7.6, task E1): every finished game with ≥ 6 plies
 * gets exactly one ANALYZE_GAME job in the finish statement itself (a replayed finish adds none), shorter games and
 * aborts are SKIPPED with no job, the payload carries the game ref and the reason (live_end / bot_end), gamesVersion
 * moves once per member, and the socket role (replay_realtime, when TEST_REALTIME_DATABASE_URL is set) can run it.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY, analyzeDedupeKey } from "@repo/contracts/internal/jobs";
import { createPrismaClient } from "../src/client";
import { INITIAL_FEN, createLiveGame } from "../src/games";
import { analysisEtaSec } from "@repo/contracts/internal/jobs";
import { abortGame, finishAnalysisOf, finishGame, type FinishGameInput } from "../src/live";
import { OPERA_FINAL_FEN, OPERA_UCI, REALTIME_URL, TEST_URL, assertLocalTestUrl, makeUser, stats, type TestUser } from "./helpers";

const in1h = () => new Date(Date.now() + 3600_000);

type JobRow = {
  kind: string;
  status: string;
  priority: number;
  fairSeq: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  gameId: bigint | null;
  runAtAgeMs: number;
};

describe("P3 finish fragment (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  /** The socket's client (role replay_realtime when TEST_REALTIME_DATABASE_URL is set). */
  let rt: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    assertLocalTestUrl(REALTIME_URL!);
    rt = createPrismaClient({ datasourceUrl: REALTIME_URL });
  });

  after(async () => {
    await db.$disconnect();
    await rt.$disconnect();
  });

  async function onlineGame(w: TestUser, b: TestUser) {
    return createLiveGame(db, {
      mode: "ONLINE",
      creatorId: w.id,
      white: { userId: w.id, name: w.name, rating: 1400 },
      black: { userId: b.id, name: b.name, rating: 1500 },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 180,
      incrementSeconds: 2,
      expiresAt: in1h(),
    });
  }

  async function botGame(u: TestUser) {
    return createLiveGame(db, {
      mode: "BOT",
      creatorId: u.id,
      white: { userId: u.id, name: u.name, rating: 1100 },
      black: null,
      bot: { elo: 1200 },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 600,
      incrementSeconds: 0,
      expiresAt: in1h(),
    });
  }

  const finishInput = (gameId: bigint, plies: number): FinishGameInput => {
    const moves = OPERA_UCI.split(" ").slice(0, plies).join(" ");
    return {
      gameId,
      moves,
      clocksMs: [],
      plyCount: plies,
      fen: plies === 33 ? OPERA_FINAL_FEN : INITIAL_FEN,
      whiteTimeMs: null,
      blackTimeMs: null,
      method: plies === 33 ? "checkmate" : "resignation",
      winner: "w",
      pgn: null,
      endedAt: new Date(),
    };
  };

  async function jobsOf(gameId: bigint): Promise<JobRow[]> {
    return db.$queryRaw<JobRow[]>(Prisma.sql`
      SELECT kind::text AS kind, status::text AS status, priority, "fairSeq", "maxAttempts", payload, "gameId",
             (extract(epoch FROM ((now() AT TIME ZONE 'UTC') - "runAt")) * 1000)::float8 AS "runAtAgeMs"
        FROM jobs WHERE "dedupeKey" = ${analyzeDedupeKey(gameId)}`);
  }

  async function analysisStatus(gameId: bigint): Promise<string> {
    const rows = await db.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT "analysisStatus"::text AS s FROM games WHERE id = ${gameId}`);
    return rows[0]!.s;
  }

  it("a live finish (≥ 6 plies) inserts one ANALYZE_GAME job at GAME_ENDED in the same statement; QUEUED", async () => {
    const w = await makeUser(db, "p3w");
    const b = await makeUser(db, "p3b");
    const g = await onlineGame(w, b);
    const out = await finishGame(rt, finishInput(g.id, 33));
    assert.equal(out.finished, true);
    const analysis = finishAnalysisOf(out, 33);
    assert.ok(analysis);
    assert.equal(analysis.created, true);
    assert.equal(analysis.kick, true);
    assert.deepEqual(analysis.review, { status: "queued", etaSec: analysisEtaSec({ ahead: analysis.ahead, remainingPlies: 33 }) });
    assert.equal(await analysisStatus(g.id), "QUEUED");

    const jobs = await jobsOf(g.id);
    assert.equal(jobs.length, 1);
    const job = jobs[0]!;
    assert.equal(job.kind, "ANALYZE_GAME");
    assert.equal(job.status, "QUEUED");
    assert.equal(job.priority, JOB_PRIORITY.GAME_ENDED);
    assert.equal(job.fairSeq, 0);
    assert.equal(job.maxAttempts, JOB_MAX_ATTEMPTS.ANALYZE_GAME);
    assert.equal(job.gameId, g.id);
    assert.deepEqual(job.payload, { v: 1, gameId: g.id.toString(), gameRef: g.ref, reason: "live_end" });
    assert.ok(job.runAtAgeMs >= -1_000 && job.runAtAgeMs < 60_000, "runAt is now (UTC)");
    // gamesVersion: once per member (P2's uv; no second bump from P3).
    assert.equal((await stats(db, w.id)).version, 1);
    assert.equal((await stats(db, b.id)).version, 1);
  });

  it("a replayed finish adds no job, bumps nothing, and reports the stored QUEUED state (kick again)", async () => {
    const w = await makeUser(db, "p3rw");
    const b = await makeUser(db, "p3rb");
    const g = await onlineGame(w, b);
    const input = finishInput(g.id, 33);
    await finishGame(rt, input);
    const again = await finishGame(rt, input);
    assert.equal(again.finished, false);
    assert.equal(again.conflict, false);
    const analysis = finishAnalysisOf(again, 33)!;
    assert.equal(analysis.created, false);
    assert.equal(analysis.status, "QUEUED");
    assert.equal(analysis.kick, true, "a lost first response may have lost the kick too");
    assert.equal(analysis.review.status, "queued");
    assert.equal((await jobsOf(g.id)).length, 1, "still one job");
    assert.equal((await stats(db, w.id)).version, 1);

    // Once the worker has it, a replay neither kicks nor re-queues.
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'RUNNING' WHERE id = ${g.id}`);
    const third = finishAnalysisOf(await finishGame(rt, input), 33)!;
    assert.equal(third.status, "RUNNING");
    assert.equal(third.kick, false);
    assert.equal((await jobsOf(g.id)).length, 1);
  });

  it("the jobs ahead of a new GAME_ENDED job count toward its ETA (its own job excluded)", async () => {
    const w = await makeUser(db, "p3aw");
    const b = await makeUser(db, "p3ab");
    const g1 = await onlineGame(w, b);
    const g2 = await onlineGame(w, b);
    await finishGame(rt, finishInput(g1.id, 33));
    // CI runs every package's test:int at once, and the socket, web and worker suites insert and claim jobs in the
    // shared public table. The reference count and the finish therefore run in one REPEATABLE READ transaction: both
    // read the same snapshot, so other suites' writes cannot land between them (regression: finish-p3-ahead-race,
    // FIX-2; the test was flaky under `pnpm -r test:int`).
    const { before, out } = await rt.$transaction(
      async (tx) => {
        const n = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
          SELECT count(*)::int AS n FROM jobs WHERE status = 'QUEUED' AND priority >= ${JOB_PRIORITY.GAME_ENDED}
             AND "runAt" <= (now() AT TIME ZONE 'UTC')`);
        return { before: n[0]!.n, out: await finishGame(tx, finishInput(g2.id, 33)) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const second = finishAnalysisOf(out, 33)!;
    assert.equal(second.ahead, before, "every due QUEUED job at ≥ 80 runs first");
    assert.ok(second.ahead >= 1, "g1's job is ahead of g2's");
  });

  it("a short game (< 6 plies) is SKIPPED with no job; an abort is SKIPPED with no job", async () => {
    const w = await makeUser(db, "p3sw");
    const b = await makeUser(db, "p3sb");
    const short = await onlineGame(w, b);
    const out = await finishGame(rt, finishInput(short.id, 5));
    assert.equal(out.finished, true);
    assert.deepEqual(finishAnalysisOf(out, 5)?.review, { status: "skipped", etaSec: null });
    assert.equal(finishAnalysisOf(out, 5)?.kick, false);
    assert.equal(await analysisStatus(short.id), "SKIPPED");
    assert.equal((await jobsOf(short.id)).length, 0);
    // A replay of the short finish says skipped too.
    assert.equal(finishAnalysisOf(await finishGame(rt, finishInput(short.id, 5)), 5)?.review.status, "skipped");

    const aborted = await onlineGame(w, b);
    const ab = await abortGame(rt, { gameId: aborted.id, abortedBy: "w", endedAt: new Date() });
    assert.equal(ab.aborted, true);
    assert.equal(await analysisStatus(aborted.id), "SKIPPED");
    assert.equal((await jobsOf(aborted.id)).length, 0);
  });

  it("a bot game's job says reason bot_end (the web `complete` runs the same statement)", async () => {
    const u = await makeUser(db, "p3bot");
    const g = await botGame(u);
    const out = await finishGame(db, finishInput(g.id, 12));
    assert.equal(finishAnalysisOf(out, 12)?.created, true);
    const jobs = await jobsOf(g.id);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0]!.payload, { v: 1, gameId: g.id.toString(), gameRef: g.ref, reason: "bot_end" });
    assert.equal((await stats(db, u.id)).version, 1, "the member's archive version moved once");
  });

  it("an existing job for the game is left alone (ON CONFLICT DO NOTHING): still one row, not re-queued", async () => {
    const w = await makeUser(db, "p3cw");
    const b = await makeUser(db, "p3cb");
    const g = await onlineGame(w, b);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO jobs (kind, status, priority, "dedupeKey", "gameId", payload)
      VALUES ('ANALYZE_GAME', 'DONE', ${JOB_PRIORITY.USER_OPENED}, ${analyzeDedupeKey(g.id)}, ${g.id},
              ${JSON.stringify({ v: 1, gameId: g.id.toString(), gameRef: g.ref, reason: "opened" })}::jsonb)`);
    const out = await finishGame(rt, finishInput(g.id, 33));
    assert.equal(out.finished, true);
    assert.equal(finishAnalysisOf(out, 33)?.created, false);
    const jobs = await jobsOf(g.id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.status, "DONE");
  });
});
