/**
 * Phase 3 seeds and backfills against a real Postgres (phase-03 plan §6.8, §6.9, task B3 acceptance: "the seeds
 * load; the backfills are idempotent (run twice = no change)"), plus the hot-query plans over the perf seed (§12.7).
 * Skipped unless TEST_DATABASE_URL is set. Every row is written for users this file creates (plus the shared
 * synthetic opponents), so it runs next to the other integration suites.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { FIXTURE_POSITIONS, OPERA_GAME_PGN } from "../prisma/fixtures/design-legend-positions";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { createPrismaClient } from "../src/client";
import { startPlyOf } from "../src/games/derive";
import { parseComparisonFacts } from "../src/json/legend";
import { parseLines, parseReviewContent } from "../src/json/review";
import { parseShareSnapshot } from "../src/json/share";
import { runEnqueueAnalysis } from "../scripts/backfill/enqueue-analysis";
import { runLegendFacts } from "../scripts/backfill/legend-facts";
import { runOpeningEpd } from "../scripts/backfill/opening-epd";
import { p3Queries, perfParams, runExplain } from "../scripts/explain-hot";
import { seededRef } from "../seed/builders";
import { runPerfSeed } from "../seed/perf-archive";
import { runReviewSeed, writePersonaFixtures } from "../seed/review";
import { runSmokeSeed, SMOKE_GAME_REF } from "../seed/smoke";
import { checkTripwire } from "../seed/target";
import { clearMemberGames } from "../seed/writer";
import { TEST_URL, assertLocalTestUrl, run } from "./helpers";

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("Phase 3 seeds and backfills (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  const email = (label: string) => `p3seed-${label}-${run}@test.invalid`;

  async function insertUser(label: string): Promise<bigint> {
    const e = email(label);
    const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO users ("referenceId", code, "googleId", email, name, "updatedAt")
      VALUES (${seededRef(`int-user-${label}`, run)}, ${`p3seed-${label}-${run}`}, ${`g-p3seed-${label}-${run}`}, ${e}, ${`p3 ${label}`.slice(0, 40)}, now())
      RETURNING id`);
    return rows[0]!.id;
  }

  async function insertGame(
    userId: bigint,
    key: string,
    o: { status?: string; plies?: number; completedAt?: string; analysisStatus?: string; seeded?: boolean; positionId?: bigint | null; fen?: string; moves?: string },
  ): Promise<bigint> {
    const ref = seededRef(`int-game-${key}`, run);
    const moves = o.moves ?? "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5".split(" ").slice(0, o.plies ?? 8).join(" ");
    const plies = moves === "" ? 0 : moves.split(" ").length;
    const completedAt = o.completedAt ?? "2099-01-01T00:00:00Z";
    const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      WITH g AS (
        INSERT INTO games ("referenceId", "creatorId", status, mode, "startingFen", "startPly", fen, moves, "plyCount", "initialTimeSeconds",
          "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "completedAt", "analysisStatus", "gameData",
          "chessPositionId", "whitePlayerId", "updatedAt")
        VALUES (${ref}, ${userId}, ${o.status ?? "COMPLETED"}::"GameStatus", 'BOT', ${o.fen ?? INITIAL},
          ${startPlyOf(o.fen ?? INITIAL)}, ${o.fen ?? INITIAL}, ${moves}, ${plies}, 600, 0, 600, 600, now(),
          (${completedAt}::timestamptz AT TIME ZONE 'UTC'), ${o.analysisStatus ?? "NONE"}::"AnalysisStatus",
          ${JSON.stringify(o.seeded ? { p3Seed: "int" } : { gameMode: "AI" })}::jsonb, ${o.positionId ?? null}::bigint, ${userId}, now())
        RETURNING id
      ), gp AS (
        INSERT INTO game_players ("gameId", "userId", color, mode, result, "endedAt", "opponentName", "updatedAt")
        SELECT g.id, ${userId}, 'w', 'BOT', 'WIN', (${completedAt}::timestamptz AT TIME ZONE 'UTC'), 'Engine 1200', now() FROM g
        RETURNING 1
      )
      SELECT g.id FROM g, (SELECT count(*) FROM gp) c`);
    return rows[0]!.id;
  }

  before(async () => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    // The content seed's legend positions (prisma/fixtures/design-legend-positions.ts), as on the dev branch.
    for (const p of FIXTURE_POSITIONS.filter((x) => x.key === "mo" || x.key === "kt")) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO chess_positions ("referenceId", fen, "sideToMove", pgn, "whitePlayerName", "blackPlayerName", "sourceType", "updatedAt")
        VALUES (${seededRef(`int-pos-${p.key}`, "shared")}, ${p.fen}, ${p.sideToMove}, ${p.pgn}, ${p.white}, ${p.black}, 'design-fixture', now())
        ON CONFLICT (fen) DO NOTHING`);
    }
  });
  after(async () => db.$disconnect());

  it("regression: tripwire-test-users: synthetic @test.invalid users never trip the seed guard; real-looking ones do", async () => {
    const ROLLBACK = new Error("rollback");
    const insertMany = (tx: Prisma.TransactionClient, n: number, domain: string) => {
      const tag = `${domain.slice(0, 2)}${run}`;
      return tx.$executeRaw(Prisma.sql`
        INSERT INTO users ("referenceId", code, "googleId", email, name, "updatedAt")
        SELECT 'tw' || ${tag} || i, 'tw-' || ${tag} || '-' || i, 'g-tw-' || ${tag} || '-' || i,
               'tw-' || ${tag} || '-' || i || ${`@${domain}`}, 'tripwire ' || i, now()
          FROM generate_series(1, ${n}::int) i`);
    };
    await assert.rejects(
      db.$transaction(async (tx) => {
        const before = await checkTripwire(tx);
        await insertMany(tx, 70, "test.invalid");
        assert.equal(await checkTripwire(tx), before, "70 synthetic users are not counted");
        await insertMany(tx, 61 - before, "example.com");
        await assert.rejects(checkTripwire(tx), /looks like production/);
        throw ROLLBACK;
      }),
      (e: unknown) => e === ROLLBACK,
    );
  });

  it("the review seed loads, reads back as the app reads it, and a second run changes nothing", async () => {
    const memberId = await insertUser("a");
    const now = new Date();
    const first = await runReviewSeed(db, { apply: true, memberEmail: email("a"), resetProgress: false, now });
    assert.equal(first.plan.length, 40);
    assert.ok(first.plan.every((p) => p.action === "insert"));
    assert.equal(first.written, 40);
    assert.ok(first.shares.every((s) => s.action === "write"));

    const again = await runReviewSeed(db, { apply: true, memberEmail: email("a"), resetProgress: false, now: new Date() });
    assert.ok(again.plan.every((p) => p.action === "unchanged"), JSON.stringify(again.plan.filter((p) => p.action !== "unchanged")));
    assert.ok(again.shares.every((s) => s.action === "unchanged"));
    assert.equal(again.written, 0);

    const counts = await db.$queryRaw<{ games: number; done: number; reviews: number; jobs: number; version: number }[]>(Prisma.sql`
      SELECT count(*)::int AS games, count(*) FILTER (WHERE g."analysisStatus" = 'DONE')::int AS done,
             (SELECT count(*)::int FROM player_reviews pr JOIN game_players p ON p."gameId" = pr."gameId" AND p.color = pr.color WHERE p."userId" = ${memberId}) AS reviews,
             (SELECT count(*)::int FROM jobs j JOIN game_players p ON j."dedupeKey" = 'analyze:' || p."gameId" WHERE p."userId" = ${memberId}) AS jobs,
             (SELECT "gamesVersion" FROM users WHERE id = ${memberId}) AS version
        FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."userId" = ${memberId}`);
    assert.deepEqual(counts[0], { games: 40, done: 25, reviews: 25, jobs: 25, version: 1 });

    const game = await db.$queryRaw<
      { completed: Date; content: unknown; lines: unknown; evals: number[]; judgements: number[]; accuracy: number; headline: string }[]
    >(Prisma.sql`
      SELECT (g."completedAt" AT TIME ZONE 'UTC') AS completed, pr.content, a.lines, a.evals, a.judgements, gp.accuracy, gp.headline
        FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${memberId}
        JOIN game_analyses a ON a."gameId" = g.id JOIN player_reviews pr ON pr."gameId" = g.id AND pr.color = gp.color
       WHERE g."referenceId" = ${first.refs.GAME!}`);
    const g = game[0]!;
    assert.equal(g.completed.toISOString(), "2026-11-09T18:42:10.000Z");
    assert.deepEqual(parseReviewContent(g.content)?.moments.map((m) => m.ply), [32, 36, 40]);
    assert.ok(parseLines(g.lines));
    assert.equal(g.evals.length, 55);
    assert.equal(g.judgements.length, 54);
    assert.equal(g.headline, "Missed Rxf5 · move 19");
    assert.ok(Math.abs(g.accuracy - 78.16) < 0.01);

    const legend = await db.$queryRaw<{ status: string; facts: unknown }[]>(Prisma.sql`
      SELECT lc.status::text AS status, lc.facts FROM legend_comparisons lc JOIN games g ON g.id = lc."gameId"
       WHERE g."referenceId" IN (${first.refs.LEGEND!}, ${first.refs.LEGEND_KT!}) ORDER BY g."startPly"`);
    assert.deepEqual(legend.map((l) => l.status), ["READY", "FACTS_READY"]);
    assert.ok(legend.every((l) => parseComparisonFacts(l.facts)));

    assert.deepEqual(first.shares.map((s) => s.kind), ["expired", "revoked", "live"]);
    const shares = await db.$queryRaw<{ snapshot: unknown; expired: boolean; revoked: boolean }[]>(Prisma.sql`
      SELECT snapshot, "expiresAt" < (now() AT TIME ZONE 'UTC') AS expired, "revokedAt" IS NOT NULL AS revoked
        FROM shares WHERE code IN (${first.shares[0]!.code}, ${first.shares[1]!.code}, ${first.shares[2]!.code}) ORDER BY "createdAt"`);
    // expired (created 31 days ago), revoked (2 days ago), live (an hour ago): /r/<live code> opens the review.
    assert.deepEqual(shares.map((s) => [s.expired, s.revoked]), [[true, false], [false, true], [false, false]]);
    assert.ok(shares.every((s) => parseShareSnapshot(s.snapshot)));
  });

  it("a drifted fixture is restored, a pruned DONE job is not a change, and --reset-progress clears walkthroughs", async () => {
    await insertUser("b");
    const r = await runReviewSeed(db, { apply: true, memberEmail: email("b"), resetProgress: false });
    const unanalysed = r.refs.UNANALYSED!;
    // A3 on the unanalysed game (opening it enqueues), and HOUSEKEEPING pruning CLEAN's DONE job.
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'QUEUED' WHERE "referenceId" = ${unanalysed}`);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO jobs (kind, priority, "dedupeKey", "gameId", payload)
      SELECT 'ANALYZE_GAME', ${JOB_PRIORITY.USER_OPENED}, 'analyze:' || id, id, '{"v":1}'::jsonb FROM games WHERE "referenceId" = ${unanalysed}`);
    await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = (SELECT 'analyze:' || id FROM games WHERE "referenceId" = ${r.refs.CLEAN!})`);
    await db.$executeRaw(Prisma.sql`
      UPDATE player_reviews SET progress = '{"v":1,"momentIndex":2,"results":{},"attempts":{},"planChips":{},"bankOptOut":[]}'::jsonb
       WHERE "gameId" = (SELECT id FROM games WHERE "referenceId" = ${r.refs.GAME!})`);

    const plan = await runReviewSeed(db, { apply: false, memberEmail: email("b"), resetProgress: false });
    const changed = plan.plan.filter((p) => p.action !== "unchanged");
    assert.deepEqual(changed.map((p) => [p.key, p.action]), [["UNANALYSED", "update"]]);
    assert.match(changed[0]!.reason!, /analysisStatus QUEUED/);

    const fixed = await runReviewSeed(db, { apply: true, memberEmail: email("b"), resetProgress: true });
    assert.equal(fixed.written, 1);
    assert.ok(fixed.progressReset >= 1);
    const state = await db.$queryRaw<{ status: string; jobs: number }[]>(Prisma.sql`
      SELECT g."analysisStatus"::text AS status, (SELECT count(*)::int FROM jobs WHERE "dedupeKey" = 'analyze:' || g.id) AS jobs
        FROM games g WHERE g."referenceId" = ${unanalysed}`);
    assert.deepEqual(state[0], { status: "NONE", jobs: 0 });
    const progress = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM player_reviews WHERE progress IS NOT NULL AND "gameId" = (SELECT id FROM games WHERE "referenceId" = ${r.refs.GAME!})`);
    assert.equal(progress[0]!.n, 0);
    const last = await runReviewSeed(db, { apply: false, memberEmail: email("b"), resetProgress: false });
    assert.ok(last.plan.every((p) => p.action === "unchanged"));
  });

  it("persona writers: exact fixtures on a pool-like user, clearMemberGames empties it, shared letters refused", async () => {
    await insertUser("pool");
    const refs = await writePersonaFixtures(db, email("pool"), ["TERMINAL", "CLEAN"]);
    const t = await db.$queryRaw<{ status: string; job: string; attempts: number; graded: number; failedAt: number }[]>(Prisma.sql`
      SELECT g."analysisStatus"::text AS status, j.status::text AS job, j.attempts::int AS attempts, a."gradedPlies"::int AS graded,
             a."failedAtPly"::int AS "failedAt"
        FROM games g JOIN jobs j ON j."dedupeKey" = 'analyze:' || g.id JOIN game_analyses a ON a."gameId" = g.id
       WHERE g."referenceId" = ${refs.TERMINAL!}`);
    assert.deepEqual(t[0], { status: "FAILED", job: "FAILED", attempts: 4, graded: 30, failedAt: 30 });
    // a second lease of the same persona is a no-op write
    const lines: string[] = [];
    await writePersonaFixtures(db, email("pool"), ["TERMINAL"], { log: (l) => lines.push(l) });
    assert.ok(lines.some((l) => /TERMINAL unchanged/.test(l)));
    assert.equal(await clearMemberGames(db, email("pool")), 2);
    const left = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM game_players gp JOIN users u ON u.id = gp."userId" WHERE u.email = ${email("pool")}`);
    assert.equal(left[0]!.n, 0);
    await assert.rejects(clearMemberGames(db, "e2e-playerb+clerk_test@chessbattle.dev"), /only gains data/);
  });

  it("the smoke seed: a fixed ref, and a smoke run's result is not undone", async () => {
    const first = await runSmokeSeed(db, { apply: true });
    assert.equal(first.ref, SMOKE_GAME_REF);
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'DONE' WHERE "referenceId" = ${SMOKE_GAME_REF}`);
    const again = await runSmokeSeed(db, { apply: true });
    assert.equal(again.action, "unchanged");
    await db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'NONE' WHERE "referenceId" = ${SMOKE_GAME_REF}`);
  });

  it("the perf seed is idempotent, and every P3 hot query has an index path and meets its buffer target", async () => {
    await insertUser("perf");
    const first = await runPerfSeed(db, { apply: true, rows: 150, email: email("perf") });
    assert.deepEqual([first.insert, first.written], [150, 150]);
    const again = await runPerfSeed(db, { apply: true, rows: 150, email: email("perf") });
    assert.deepEqual([again.unchanged, again.written], [150, 0]);
    const reports = await runExplain(db, p3Queries(await perfParams(db, email("perf"))), { measure: true });
    assert.ok(reports.length >= 13);
    for (const r of reports) {
      assert.ok(r.shape.ok, `${r.name}: ${r.shape.problems.join("; ")}`);
      assert.ok(r.measured?.ok, `${r.name}: ${r.measured?.problems.join("; ")}`);
    }
  });

  it("enqueue-analysis: the newest eligible games only, fairSeq per member, one statement per batch, idempotent", async () => {
    const u = await insertUser("bf");
    const ids = [
      await insertGame(u, "bf-1", { completedAt: "2099-01-03T00:00:00Z" }),
      await insertGame(u, "bf-2", { completedAt: "2099-01-02T00:00:00Z" }),
      await insertGame(u, "bf-3", { completedAt: "2099-01-01T00:00:00Z" }),
    ];
    const excluded = [
      await insertGame(u, "bf-short", { plies: 4 }),
      await insertGame(u, "bf-aborted", { status: "ABORTED" }),
      await insertGame(u, "bf-seeded", { seeded: true }),
      await insertGame(u, "bf-queued", { analysisStatus: "QUEUED" }),
      await insertGame(u, "bf-old", { completedAt: "2098-01-01T00:00:00Z" }),
    ];
    const opts = { limit: 200, since: new Date("2099-01-01T00:00:00Z"), memberId: u };
    const dry = await runEnqueueAnalysis(db, { ...opts, apply: false });
    assert.deepEqual(dry.candidates.map((c) => c.id), ids);
    assert.equal(dry.jobs, 0);

    const applied = await runEnqueueAnalysis(db, { ...opts, apply: true, batch: 2 });
    // two batches of 2 and 1: the member's gamesVersion is bumped once per batch that queued one of their games
    assert.deepEqual([applied.jobs, applied.games, applied.members], [3, 3, 2]);
    const jobs = await db.$queryRaw<{ gameId: bigint; fairSeq: number; priority: number; status: string; reason: string }[]>(Prisma.sql`
      SELECT "gameId", "fairSeq", priority::int AS priority, status::text AS status, payload->>'reason' AS reason
        FROM jobs WHERE "gameId" = ANY(${[...ids, ...excluded].map(String)}::bigint[]) ORDER BY "gameId"`);
    assert.deepEqual(jobs.map((j) => [j.gameId, j.fairSeq, j.priority, j.status, j.reason]), [
      [ids[0], 1, JOB_PRIORITY.BACKLOG, "QUEUED", "backfill"],
      [ids[1], 2, JOB_PRIORITY.BACKLOG, "QUEUED", "backfill"],
      [ids[2], 3, JOB_PRIORITY.BACKLOG, "QUEUED", "backfill"],
    ]);
    const status = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM games WHERE id = ANY(${ids.map(String)}::bigint[]) AND "analysisStatus" = 'QUEUED'`);
    assert.equal(status[0]!.n, 3);

    const twice = await runEnqueueAnalysis(db, { ...opts, apply: true });
    assert.deepEqual([twice.candidates.length, twice.jobs, twice.games], [0, 0, 0]);
    // --limit takes the newest first
    const v = await insertUser("bf2");
    const newest = await insertGame(v, "bf2-new", { completedAt: "2099-02-02T00:00:00Z" });
    await insertGame(v, "bf2-old", { completedAt: "2099-02-01T00:00:00Z" });
    const one = await runEnqueueAnalysis(db, { limit: 1, since: null, memberId: v, apply: false });
    assert.deepEqual(one.candidates.map((c) => c.id), [newest]);
  });

  it("opening-epd: writes replayable lines, leaves mismatches, and a second run writes nothing", async () => {
    const ins = (name: string, pgn: string, fen: string) =>
      db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        INSERT INTO openings ("referenceId", eco, name, pgn, fen, "sideToMove", "moveCount", "updatedAt")
        VALUES (${seededRef(`int-opening-${name}`, run)}, 'Z99', ${`${name} ${run}`}, ${pgn}, ${fen}, 'black', 1, now()) RETURNING id`);
    const good = (await ins("good", "1. e4", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"))[0]!.id;
    const bad = (await ins("bad", "1. d4", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"))[0]!.id;
    const first = await runOpeningEpd(db, { apply: true });
    assert.ok(first.mismatches.some((m) => m.id === bad));
    const rows = await db.$queryRaw<{ id: bigint; epd: string | null }[]>(Prisma.sql`
      SELECT id, epd FROM openings WHERE id IN (${good}, ${bad}) ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.epd), ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -", null]);
    const second = await runOpeningEpd(db, { apply: true });
    assert.equal(second.written, 0);
  });

  it("legend-facts: the writers' facts for legend games, a reasoned skip for a score that stops at the position, idempotent", async () => {
    const u = await insertUser("lf");
    const kt = legendFixture("kt");
    // A position with the full Kasparov–Topalov score (the content seed's KT row has none); shared across runs.
    const ktFen = kt.startFen.replace(" 1 24", " 0 24");
    const pos = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO chess_positions ("referenceId", fen, "sideToMove", pgn, "gameMetadata", "whitePlayerName", "blackPlayerName", "updatedAt")
      VALUES (${seededRef("int-pos-kt-full", run)}, ${ktFen}, 'white', ${kt.legendPgn}, ${JSON.stringify(kt.metadata)}::jsonb,
              'Garry Kasparov', 'Veselin Topalov', now())
      ON CONFLICT (fen) DO UPDATE SET pgn = EXCLUDED.pgn, "gameMetadata" = EXCLUDED."gameMetadata"
      RETURNING id`);
    const ktGame = await insertGame(u, "lf-kt", { positionId: pos[0]!.id, fen: ktFen, moves: legendFixtureMoves(kt).join(" ") });
    const opera = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM chess_positions WHERE pgn = ${OPERA_GAME_PGN} LIMIT 1`);
    const operaFen = FIXTURE_POSITIONS.find((p) => p.key === "mo")!.fen;
    // The content seed's Opera score runs to 17.Rd8#, so a game from move 10 is comparable (12.Ba4 for 12.O-O-O).
    const operaGame = await insertGame(u, "lf-opera", { positionId: opera[0]!.id, fen: operaFen, moves: "c3b5 c6b5 c4b5 b8d7 b5a4" });
    // A score that stops exactly at its position has nothing to compare.
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const stub = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO chess_positions ("referenceId", fen, "sideToMove", pgn, "whitePlayerName", "blackPlayerName", "updatedAt")
      VALUES (${seededRef("int-pos-stub", run)}, ${afterE4}, 'black', ${'[Result "1-0"]\n\n1.e4 1-0'}, 'Test Legend', 'Test Opponent', now())
      ON CONFLICT (fen) DO UPDATE SET pgn = EXCLUDED.pgn, "whitePlayerName" = EXCLUDED."whitePlayerName"
      RETURNING id`);
    await insertGame(u, "lf-stub", { positionId: stub[0]!.id, fen: afterE4, moves: "e7e5 g1f3" });

    const first = await runLegendFacts(db, { apply: true, memberId: u });
    assert.deepEqual([first.scanned, first.written, first.skipped], [3, 2, { line_ends_at_start: 1 }]);
    const operaFacts = await db.$queryRaw<{ facts: unknown }[]>(Prisma.sql`
      SELECT facts FROM legend_comparisons WHERE "gameId" = ${operaGame}`);
    const opf = parseComparisonFacts(operaFacts[0]!.facts)!;
    assert.equal(opf.historicalName, "Morphy");
    assert.equal(opf.divergenceBy, "user");
    const facts = await db.$queryRaw<{ status: string; facts: unknown; positionId: bigint }[]>(Prisma.sql`
      SELECT status::text AS status, facts, "chessPositionId" AS "positionId" FROM legend_comparisons WHERE "gameId" = ${ktGame}`);
    assert.equal(facts[0]!.status, "FACTS_READY");
    assert.equal(facts[0]!.positionId, pos[0]!.id);
    assert.deepEqual(parseComparisonFacts(facts[0]!.facts), legendFixtureFacts(kt));

    const second = await runLegendFacts(db, { apply: true, memberId: u });
    assert.deepEqual([second.scanned, second.written], [1, 0], "only the uncomparable game is scanned again; nothing is written");
  });
});
