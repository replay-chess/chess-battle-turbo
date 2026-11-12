// The pipeline's statements against Postgres (phase-03 plan §8.12, §6.3 grants, task C5 "all rows written in ≤ 10
// statements"): a whole ANALYZE_GAME through SqlAnalysisStore as role replay_worker (TEST_WORKER_DATABASE_URL), with
// the FakeEngine. Checks every row the final batch writes, the round trips (load, 5 checkpoints, the final batch),
// the SKIPPED path, the lock guard rolling back a batch once the job is gone, a legend game's facts + READY evals,
// LEGEND_COMPARE, and the `analysis:batch` queued count. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { analysisEngine, GRADING_VERSION } from "@repo/chess-analysis/version";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { LinesV1, parseReviewContent } from "@repo/db/json";
import { EnginePool } from "../engine";
import { FakeEngine } from "../engine/fake";
import { legendCompareHandler } from "../jobs/legend-compare";
import { runJob, type HandlerMap } from "../jobs/runner";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { RecordingProductEvents } from "../obs/posthog";
import { RecordingTelemetry } from "../obs/telemetry";
import { claimJob } from "../queue/claim";
import { FakeClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { insertJob, jobRow, makeGame, makeUser, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { analyzeGameHandler } from "./analyze-game";
import { BatchAccumulator } from "./batch-events";
import { OpeningBook } from "./openings";
import { SqlAnalysisStore } from "./sql-store";

const GAME_UCI = mockGradeInput("GAME").replay.uci;
const ME = "int-pipe-00000001";

describe("ANALYZE_GAME through SqlAnalysisStore (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let white: TestUser;
  let black: TestUser;

  before(async () => {
    env = await setupInt("pipe");
    white = await makeUser(env.owner, "pw");
    black = await makeUser(env.owner, "pb");
  });
  after(async () => {
    await env?.close();
  });

  async function setGame(
    id: string,
    moves: readonly string[],
    extra: { startingFen?: string; startPly?: number; chessPositionId?: string } = {},
  ) {
    await env.owner.query(
      `UPDATE games SET moves = $2, "plyCount" = $3, "startPly" = $4, "startingFen" = COALESCE($5, "startingFen"),
                        "chessPositionId" = $6::bigint, "analysisStatus" = 'QUEUED',
                        "completedAt" = (now() AT TIME ZONE 'UTC') - interval '4 seconds'
        WHERE id = $1`,
      [
        id,
        moves.join(" "),
        moves.length,
        extra.startPly ?? 0,
        extra.startingFen ?? null,
        extra.chessPositionId ?? null,
      ],
    );
    await env.owner.query(
      `UPDATE game_players SET result = CASE color WHEN 'w' THEN 'LOSS' ELSE 'WIN' END::"PlayerResult" WHERE "gameId" = $1`,
      [id],
    );
  }

  function worker() {
    const clock = new FakeClock(Date.now());
    const metrics = new Metrics({ workerId: ME, bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now());
    const emitter = new RecordingEmitter();
    const events = new RecordingProductEvents();
    const store = new SqlAnalysisStore(env.db);
    const fakes: FakeEngine[] = [];
    const engine = new EnginePool({
      factory: () => {
        const e = new FakeEngine();
        fakes.push(e);
        return e;
      },
      log: silentLogger,
      metrics,
    });
    const batch = new BatchAccumulator({ emitter, clock, log: silentLogger, queuedFor: (r) => store.queuedFor(r) });
    const book = new OpeningBook(() => store.openings(), silentLogger);
    const handlers: HandlerMap = {
      ANALYZE_GAME: analyzeGameHandler({ store, book, batch, events }),
      LEGEND_COMPARE: legendCompareHandler({ store }),
    };
    const run = async () => {
      const job = await claimJob(env.db, ME, ["ANALYZE_GAME", "LEGEND_COMPARE"], 1);
      assert.ok(job, "a job to claim");
      return runJob(job, {
        db: env.db,
        clock,
        log: silentLogger,
        metrics,
        telemetry: new RecordingTelemetry(),
        emitter,
        me: ME,
        appEnv: "test",
        handlers,
        engine,
        evalCache: null,
        evalCacheMaxBytes: 0,
        lag: null,
        stopSignal: new AbortController().signal,
        isWatched: () => false,
        takeFault: () => null,
      });
    };
    const searches = () => fakes.reduce((n, e) => n + e.searches, 0);
    return { engine, emitter, events, store, run, searches };
  }

  it("writes every row of a 54-ply game in load + 5 checkpoints + one final batch, as replay_worker", async () => {
    const g = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    await setGame(g.id, GAME_UCI);
    const versions = async () =>
      (
        await env.owner.query(`SELECT "gamesVersion" FROM users WHERE id = ANY($1::bigint[]) ORDER BY id`, [
          [white.id, black.id],
        ])
      ).rows.map((r) => Number(r.gamesVersion));
    const before = await versions();
    const jobId = await insertJob(env, {
      gameId: g.id,
      priority: JOB_PRIORITY.GAME_ENDED,
      dedupeKey: `analyze:${g.id}`,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
    const w = worker();
    await w.engine.start();
    const trips0 = env.db.counters.roundTrips;
    assert.equal(await w.run(), "done");
    // claim + load + openings (once per process) + 5 checkpoints + the final batch
    assert.equal(env.db.counters.roundTrips - trips0, 9);

    const job = await jobRow(env, jobId);
    assert.equal(job.status, "DONE");
    assert.deepEqual(job.result, {
      plies: 54,
      resumedFrom: 0,
      pass2: (job.result as { pass2: number }).pass2,
      regrade: false,
    });
    const ga = (await env.owner.query(`SELECT * FROM ${env.schema}.game_analyses WHERE "gameId" = $1`, [g.id])).rows[0];
    assert.equal(ga.version, GRADING_VERSION);
    assert.equal(ga.engine, analysisEngine("fake"));
    assert.equal(ga.evalSource, "ENGINE");
    assert.equal(ga.totalPlies, 54);
    assert.equal(ga.gradedPlies, 54);
    assert.equal(ga.failedAtPly, null);
    assert.equal(ga.evals.length, 55);
    assert.equal(ga.second.length, 55);
    assert.equal(ga.best.length, 55);
    assert.equal(ga.judgements.length, 54);
    assert.ok(LinesV1.safeParse(ga.lines).success, "lines parse as LinesV1");
    assert.equal(ga.countsWhite.length, 13);
    assert.ok(ga.accuracyWhite > 0 && ga.accuracyWhite <= 100);
    assert.ok(ga.readyMs >= 4_000 && ga.readyMs < 60_000, `readyMs ${ga.readyMs}`);
    assert.ok(ga.completedAt instanceof Date);
    assert.ok(ga.depthP50 > 0);

    const reviews = (
      await env.owner.query(
        `SELECT color, content, "textStatus", progress FROM player_reviews WHERE "gameId" = $1 ORDER BY color DESC`,
        [g.id],
      )
    ).rows;
    assert.deepEqual(
      reviews.map((r) => [r.color, r.textStatus, r.progress]),
      [
        ["w", "TEMPLATE", null],
        ["b", "TEMPLATE", null],
      ],
    );
    for (const r of reviews) assert.ok(parseReviewContent(r.content));
    const players = (
      await env.owner.query(
        `SELECT color, accuracy, headline, "momentsCount", counts, "phaseAccuracy" FROM game_players WHERE "gameId" = $1 ORDER BY color DESC`,
        [g.id],
      )
    ).rows;
    for (const p of players) {
      assert.equal(p.counts.length, 13);
      assert.equal(p.phaseAccuracy.length, 3);
      assert.ok(p.accuracy > 0);
      assert.equal(p.momentsCount, reviews.find((r) => r.color === p.color)!.content.moments.length);
    }
    const game = (await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id])).rows[0];
    assert.equal(game.s, "DONE");
    assert.deepEqual(
      await versions(),
      before.map((v) => v + 1),
      "each member's archive version bumped once",
    );
    assert.equal(w.emitter.sent.filter((s) => s.event === "analysis:done").length, 2);
  });

  it("SKIPPED: a 4-ply game writes no analysis, marks the game, bumps the members", async () => {
    const g = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    await setGame(g.id, GAME_UCI.slice(0, 4));
    const jobId = await insertJob(env, {
      gameId: g.id,
      dedupeKey: `analyze:${g.id}`,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
    const w = worker();
    await w.engine.start();
    assert.equal(await w.run(), "done");
    assert.equal((await jobRow(env, jobId)).status, "DONE");
    const game = (await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id])).rows[0];
    assert.equal(game.s, "SKIPPED");
    const ga = await env.owner.query(`SELECT 1 FROM ${env.schema}.game_analyses WHERE "gameId" = $1`, [g.id]);
    assert.equal(ga.rowCount, 0);
  });

  it("the lock guard rolls the final batch back once the job is no longer this worker's", async () => {
    const g = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    await setGame(g.id, GAME_UCI.slice(0, 8));
    const jobId = await insertJob(env, {
      gameId: g.id,
      status: "RUNNING",
      lockedBy: "someone-else-1",
      heartbeatSec: 0,
      dedupeKey: `analyze:${g.id}`,
    });
    const store = new SqlAnalysisStore(env.db);
    await assert.rejects(
      store.skip({ jobId, me: ME, gameId: g.id, reason: "test" }),
      (e: { code?: string }) => e.code === "22012",
    );
    const game = (await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id])).rows[0];
    assert.equal(game.s, "QUEUED", "nothing committed");
  });

  it("a legend game: facts inserted with the first checkpoint, READY with the divergence evals; LEGEND_COMPARE confirms", async () => {
    const f = legendFixture("opera");
    const moves = legendFixtureMoves(f);
    const fen = f.startFen.replace(/ 0 10$/, " 1 10");
    // The position's own name for White is a placeholder: the historical name must come from the linked legends
    // record (the rule every writer shares, @repo/chess-analysis/legend/facts), read through replay_worker's grant.
    const legendRow = await env.owner.query(
      `INSERT INTO legends ("referenceId", name, era, "shortDescription", "updatedAt") VALUES ('lgwkintmorphy', 'Paul Morphy', 'Romantic Era', 'test', now())
       ON CONFLICT (name) DO UPDATE SET era = EXCLUDED.era RETURNING id::text AS id`,
    );
    const cp = await env.owner.query(
      `INSERT INTO chess_positions ("referenceId", fen, "sideToMove", pgn, "moveNumber", "whitePlayerName", "blackPlayerName",
                                    "whitePlayerId", "eventDate", "updatedAt")
       VALUES ($1, $2, 'white', $3, 10, 'Unknown', 'Duke Karl / Count Isouard', $4::bigint, '1858-11-02', now())
       ON CONFLICT (fen) DO UPDATE SET pgn = EXCLUDED.pgn, "whitePlayerName" = EXCLUDED."whitePlayerName",
                                       "whitePlayerId" = EXCLUDED."whitePlayerId",
                                       "moveNumber" = 10, "eventDate" = EXCLUDED."eventDate"
       RETURNING id::text AS id`,
      [`cpwkint${Date.now().toString(36)}`, fen, f.legendPgn, legendRow.rows[0].id],
    );
    const g = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    await setGame(g.id, moves, { startingFen: fen, startPly: 18, chessPositionId: cp.rows[0].id });
    await insertJob(env, {
      gameId: g.id,
      dedupeKey: `analyze:${g.id}`,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "bot_end" },
    });
    const w = worker();
    await w.engine.start();
    assert.equal(await w.run(), "done");
    const rows = (
      await env.owner.query(
        `SELECT "userId"::text AS "userId", status::text AS status, facts, "chessPositionId"::text AS cp FROM legend_comparisons WHERE "gameId" = $1 ORDER BY "userId"`,
        [g.id],
      )
    ).rows;
    const mine = rows.find((r) => r.userId === white.id)!;
    assert.equal(mine.status, "READY");
    assert.equal(mine.cp, cp.rows[0].id);
    assert.equal(mine.facts.historicalName, "Morphy");
    assert.equal(mine.facts.divergencePly, legendFixtureFacts(f).divergencePly);
    assert.ok(mine.facts.evalAtDivergence.userWin >= 0);
    assert.deepEqual(
      w.emitter.sent.filter((s) => s.event === "compare:ready").map((s) => s.data),
      [{ v: 1, gameRef: g.ref, status: "ready" }],
    );

    // LEGEND_COMPARE on a READY row: confirmed, no search, compare:ready again.
    const searchesBefore = w.searches();
    await insertJob(env, {
      kind: "LEGEND_COMPARE",
      priority: JOB_PRIORITY.USER_OPENED,
      dedupeKey: `legend:${g.id}:${white.id}`,
      maxAttempts: 3,
      payload: { v: 1, gameId: g.id, userId: white.id, gameRef: g.ref },
    });
    assert.equal(await w.run(), "done");
    assert.equal(w.searches(), searchesBefore);
    assert.equal(w.emitter.sent.filter((s) => s.event === "compare:ready").length, 2);
  });

  it("LEGEND_COMPARE fills the evals of a FACTS_READY row", async () => {
    const f = legendFixture("opera");
    const g = await makeGame(env.owner, white, black, { analysisStatus: "DONE" });
    await setGame(g.id, legendFixtureMoves(f), { startingFen: f.startFen, startPly: 18 });
    await env.owner.query(`UPDATE games SET "analysisStatus" = 'DONE' WHERE id = $1`, [g.id]);
    await env.owner.query(
      `INSERT INTO legend_comparisons ("gameId", "userId", status, facts, attempts, "updatedAt") VALUES ($1, $2, 'FACTS_READY', $3::jsonb, 1, now())`,
      [g.id, white.id, JSON.stringify(legendFixtureFacts(f))],
    );
    const jobId = await insertJob(env, {
      kind: "LEGEND_COMPARE",
      priority: JOB_PRIORITY.USER_OPENED,
      dedupeKey: `legend:${g.id}:${white.id}`,
      maxAttempts: 3,
      payload: { v: 1, gameId: g.id, userId: white.id, gameRef: g.ref },
    });
    const w = worker();
    await w.engine.start();
    assert.equal(await w.run(), "done");
    assert.equal((await jobRow(env, jobId)).status, "DONE");
    const row = (
      await env.owner.query(
        `SELECT status::text AS status, facts, error FROM legend_comparisons WHERE "gameId" = $1 AND "userId" = $2`,
        [g.id, white.id],
      )
    ).rows[0];
    assert.equal(row.status, "READY");
    assert.equal(row.error, null);
    assert.equal(typeof row.facts.evalAtDivergence.legendWin, "number");
  });

  it("queuedFor counts the QUEUED analyses of each member", async () => {
    const g1 = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    const g2 = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    await insertJob(env, {
      gameId: g1.id,
      priority: JOB_PRIORITY.BACKLOG,
      dedupeKey: `analyze:${g1.id}`,
      runAtSec: 3600,
    });
    await insertJob(env, {
      gameId: g2.id,
      priority: JOB_PRIORITY.BACKLOG,
      dedupeKey: `analyze:${g2.id}`,
      runAtSec: 3600,
    });
    const counts = await new SqlAnalysisStore(env.db).queuedFor([white.ref, black.ref, "cnobody0000000000000000"]);
    assert.equal(counts.get(white.ref), 2);
    assert.equal(counts.get(black.ref), 2);
    assert.equal(counts.has("cnobody0000000000000000"), false);
  });
});
