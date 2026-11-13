// IMPORT_SYNC against a real Postgres (phase-04 plan §12.2 tests 1–10, 12, 13; §8.6–8.11; §9.4): the worker's real
// provider clients and gates over the in-process upstream (upstream.ts), a FakeClock for provider timing, the batch
// writer and run statements as role replay_worker (TEST_WORKER_DATABASE_URL). Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { releaseImportBacklogSql } from "@repo/db/import-backlog";
import { EnginePool } from "../../engine";
import { FakeEngine } from "../../engine/fake";
import { analyzeGameHandler } from "../../pipeline/analyze-game";
import { BatchAccumulator } from "../../pipeline/batch-events";
import { OpeningBook } from "../../pipeline/openings";
import { SqlAnalysisStore } from "../../pipeline/sql-store";
import { fromPrisma } from "../../db/client";
import { runJob } from "../../jobs/runner";
import { silentLogger } from "../../obs/log";
import { RecordingProductEvents } from "../../obs/posthog";
import { claimJob } from "../../queue/claim";
import { insertJob, jobRow, run as RUN_ID, setupInt, skipInt, type IntEnv } from "../../testing/pg";
import { knownExternalIds } from "../known";
import { resetGamesChangedThrottle } from "../progress";
import { ImportWorld, parkImportJobs, IMPORT_T0 } from "./harness";

const ME = "imp-worker-0000aai1";
const OTHER = "imp-worker-0000aai2";
let tagSeq = 0;
const tag = () => `${RUN_ID.replace(/[^0-9]/g, "").slice(-6)}${String(++tagSeq).padStart(2, "0")}`;

describe("IMPORT_SYNC (Postgres, mock upstream)", { skip: skipInt }, () => {
  let env: IntEnv;
  const worlds: ImportWorld[] = [];
  const world = (settings = {}) => {
    const w = new ImportWorld(env, tag(), settings);
    worlds.push(w);
    return w;
  };

  before(async () => {
    env = await setupInt("imports");
  });
  afterEach(async () => {
    resetGamesChangedThrottle();
    await parkImportJobs(env);
  });
  after(async () => {
    for (const w of worlds) await w.close();
    await env?.close();
  });

  // ── 1. Chess.com initial import for a trialist ────────────────────────────────────────────────────────────────
  it("1: imports the fixture account for a trialist: rows, priorities, chunks, cursor, events, reschedule", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    // Each month request moves the clock on, so the reading frame, the saving frame and the finish are > 1 s apart.
    w.upstream.before.push({ match: /\/games\/\d{4}\/\d{2}$/, once: false, run: () => w.clock.advance(700) });
    const u = await w.member("trial", "t1");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    const version = async () => Number((await w.q(`SELECT "gamesVersion" FROM users WHERE id = $1`, [u.id]))[0]!.gamesVersion);
    const v0 = await version();

    assert.equal(await w.runNext(ME), "done");
    // PostHog (plan 10.1): import_started then import_finished, registry-valid, keyed by the member's ref.
    assert.deepEqual(w.product.refused, []);
    const names = w.product.events.map((e) => e.event);
    assert.deepEqual(names, ["import_started", "import_finished"]);
    const finishedEvent = w.product.events[1]!;
    assert.equal(finishedEvent.distinctId, u.ref);
    assert.equal(finishedEvent.props.provider, "chesscom");
    assert.equal(finishedEvent.props.trigger, "initial");
    assert.ok(Number(finishedEvent.props.imported) > 0);
    assert.ok(Number(finishedEvent.props.upstream_requests) >= 3, "profile + archives + at least one month");
    assert.equal(finishedEvent.props.upstream_304_count, 0);
    assert.ok(Number(finishedEvent.props.reading_ms) > 0 && Number(finishedEvent.props.duration_ms) >= Number(finishedEvent.props.reading_ms));

    const [r] = await w.q(`SELECT * FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.status, "DONE");
    assert.equal(r!.imported, 45);
    assert.equal(r!.total, 45);
    assert.equal(r!.skipped, 3, "chess960, unrated, the FEN that disagrees with its PGN");
    assert.equal(r!.phase, null);
    // Plan §12.7: an imported game never reaches a tournament's game list or standings (both key on tournamentId).
    const [t] = await w.q(
      `SELECT count(*)::int AS n, count(g."tournamentId")::int AS "inTournament" FROM games g
         JOIN game_players p ON p."gameId" = g.id WHERE p."userId" = $1 AND p.mode = 'IMPORTED'`,
      [u.id],
    );
    assert.deepEqual(t, { n: 45, inTournament: 0 }, "imported games carry no tournament");
    assert.ok(r!.finishedAt);

    const players = await w.q(
      `SELECT gp.*, g."completedAt", g."expiresAt", g.pgn, g.fen, g."endMethod"::text AS "endMethod", g.outcome::text AS outcome,
              g.mode::text AS "gameMode", g.source::text AS "gameSource", g."analysisStatus"::text AS "analysisStatus",
              g."referenceId", g."whitePlayerId"::text AS wp, g."blackPlayerId"::text AS bp
         FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."userId" = $1 ORDER BY gp."endedAt" DESC`,
      [u.id],
    );
    assert.equal(players.length, 45);
    for (const p of players) {
      assert.equal(String(p.linkedAccountId), la);
      assert.equal(p.source, "CHESSCOM");
      assert.equal(p.mode, "IMPORTED");
      assert.ok(p.endedAt && p.ratingBefore !== null && typeof p.opponentName === "string" && p.opponentName.length > 0);
      assert.equal((p.completedAt as Date).getTime(), (p.expiresAt as Date).getTime(), "completedAt = expiresAt");
      assert.equal(p.pgn, null, "pgn stays NULL (D4-30)");
      assert.ok(typeof p.fen === "string" && p.endMethod && p.outcome);
      assert.equal(p.gameMode, "IMPORTED");
      assert.equal(p.color === "w" ? p.wp : p.bp, u.id);
    }

    const jobs = await w.q(
      `SELECT priority, "fairSeq", payload, "gameId"::text AS "gameId" FROM ${env.schema}.jobs
        WHERE kind = 'ANALYZE_GAME' AND "userId" = $1 ORDER BY "fairSeq"`,
      [u.id],
    );
    assert.equal(jobs.length, 20, "the trialist budget: 20 eager analyses");
    assert.equal(jobs.filter((j) => j.priority === JOB_PRIORITY.USER_OPENED).length, 1);
    assert.equal(jobs.filter((j) => j.priority === JOB_PRIORITY.IMPORT_NEWEST).length, 19);
    assert.deepEqual(jobs.map((j) => j.fairSeq), Array.from({ length: 20 }, (_, i) => i + 1), "fairSeq = rank");
    const byGame = new Map(players.map((p) => [String(p.gameId), p]));
    jobs.forEach((j, i) => {
      const p = byGame.get(j.gameId as string)!;
      assert.equal(p, players[i], "ranks follow the newest-first order");
      assert.deepEqual(j.payload, { v: 1, gameId: j.gameId, gameRef: p.referenceId, reason: "import", importRunId: run.id });
      assert.equal(p.analysisStatus, "QUEUED");
    });
    assert.equal(players.slice(20).every((p) => p.analysisStatus === "NONE"), true, "the rest is analysed when opened");
    assert.equal(String(r!.firstGameId), String(players[0]!.gameId), "firstGameId = the newest game");
    assert.equal(r!.analysisQueued, 20);

    const v1 = await version();
    const chunks = w.driver.sent.filter((t) => t.includes("jsonb_to_recordset")).length;
    assert.equal(chunks, 2, "the early chunk (newest month) and one saving chunk");
    assert.equal(v1 - v0, chunks, "gamesVersion bumped once per chunk");

    const [cur] = await w.q(`SELECT * FROM import_cursors WHERE "linkedAccountId" = $1`, [la]);
    const months = (cur!.archives as { months: Record<string, { done: boolean; games: number; skipped: number }> }).months;
    assert.deepEqual(Object.keys(months).sort(), ["2026/08", "2026/09", "2026/10"]);
    assert.ok(Object.values(months).every((m) => m.done), "past months are done (the current month 2026/11 has no games)");
    assert.equal(Object.values(months).reduce((n, m) => n + m.games, 0), 45);
    assert.ok(cur!.archivesEtag);

    const events = w.importEvents();
    const progress = events.filter((e) => e.event === "import:progress").map((e) => e.data as { phase: string; imported: number });
    assert.ok(progress.length >= 2);
    assert.equal(progress[0]!.phase, "reading", "the early chunk was written while reading");
    assert.ok(progress[0]!.imported > 0 && progress[0]!.imported < 45);
    assert.equal(progress.at(-1)!.phase, "saving");
    const last = events.at(-1)!;
    assert.equal(last.event, "import:finished");
    assert.deepEqual(last.userRefs, [u.ref]);
    const fin = last.data as { imported: number; total: number; analysisQueued: number; analysed: number; firstReviewGameRef: string };
    assert.equal(fin.imported, 45);
    assert.equal(fin.analysisQueued, 20);
    assert.equal(fin.analysed, 0);
    assert.equal(fin.firstReviewGameRef, players[0]!.referenceId);
    assert.ok(w.emitter.sent.some((e) => e.event === "games:changed"));

    const [acct] = await w.q(
      `SELECT *, (extract(epoch FROM "nextAutoSyncAt") * 1000)::float8 AS "nextAutoSyncAtMs" FROM linked_accounts WHERE id = $1`,
      [la],
    );
    assert.equal(acct!.importState, "IDLE");
    assert.equal(acct!.importedCount, 45);
    assert.equal(acct!.skippedCount, 3);
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "QUEUED", "the import:<id> row is reused: rescheduled, not DONE");
    assert.equal(job.lockedBy, null);
    assert.equal(job.attempts, 0);
    assert.equal(job.priority, JOB_PRIORITY.IMPORT_SYNC_DAILY);
    assert.deepEqual(job.payload, { v: 1, linkedAccountId: la, runId: null, trigger: "DAILY" });
    assert.equal(job.runAtMs, acct!.nextAutoSyncAtMs, "the next wake is the account's next sync");
    assert.ok(job.runAtMs >= IMPORT_T0 + 12 * 3_600_000, "never sooner than 12 h after the sync");
    assert.ok(w.upstream.maxActive.chesscom <= 1);
  });

  // ── 1b. paying member: eager + backlog slices; a trialist's backlog released once ─────────────────────────────
  it("1b: a paying member gets the eager newest games and the rest as backlog slices; a release runs once", async () => {
    const w = world({ eager: 10 });
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "p1");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    await w.job(la, run.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const jobs = await w.q(
      `SELECT priority, "fairSeq", (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs" FROM ${env.schema}.jobs
        WHERE kind = 'ANALYZE_GAME' AND "userId" = $1`,
      [u.id],
    );
    assert.equal(jobs.filter((j) => j.priority === JOB_PRIORITY.USER_OPENED).length, 1);
    assert.equal(jobs.filter((j) => j.priority === JOB_PRIORITY.IMPORT_NEWEST).length, 9);
    const backlog = jobs.filter((j) => j.priority === JOB_PRIORITY.BACKLOG);
    assert.equal(backlog.length, 35, "the rest of the 200 budget, as backlog");
    const slots = [...new Set(backlog.map((j) => Number(j.runAtMs)))].sort((x, y) => x - y);
    assert.equal(slots.length, 7, "seven daily slices");
    const [acct] = await w.q(
      `SELECT (extract(epoch FROM "nextAutoSyncAt") * 1000)::float8 AS ms FROM linked_accounts WHERE id = $1`,
      [la],
    );
    slots.forEach((at, k) => assert.equal(at, Number(acct!.ms) + k * 86_400_000, "slice k at the daily-sync slot + k days"));

    // A trialist's backlog is released by the web's fan-out at the first paid charge: the shared statement queues
    // the rest once, and a second delivery changes nothing.
    const w2 = world();
    w2.upstream.addChessComFixture();
    const t = await w2.member("trial", "p1t");
    const la2 = await w2.link(t, "CHESSCOM", "KnightOwl_88");
    const run2 = await w2.run(t, la2, "CHESSCOM", "INITIAL");
    await w2.job(la2, run2.id, "INITIAL");
    assert.equal(await w2.runNext(ME), "done");
    const release = () =>
      w2.db.query(fromPrisma(releaseImportBacklogSql({ userId: BigInt(t.id), now: new Date(IMPORT_T0) })));
    const first = await release();
    assert.equal(first.reduce((n, r) => n + Number(r.games), 0), 25);
    assert.deepEqual(await release(), [], "a second release queues nothing");
  });

  // ── §9.4 / §9.7: the write-path budget ──────────────────────────────────────────────────────────────────────────
  it("§9.4: 2,000 Chess.com games of a paying member in ≤ 41 statements (one per 100 games), never two requests at once", async () => {
    const w = world();
    w.upstream.addChessComMany("KnightOwl_88", IMPORT_T0, 12, 180);
    const u = await w.member("paying", "b94");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    await w.job(la, run.id, "INITIAL");
    const s0 = w.db.counters.statements;
    const t0 = w.db.counters.roundTrips;
    assert.equal(await w.runNext(ME), "done");
    const statements = w.db.counters.statements - s0;
    const chunks = w.driver.sent.filter((t) => t.includes("jsonb_to_recordset")).length;
    const [r] = await w.q(`SELECT imported, total, status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
    assert.deepEqual({ ...r }, { imported: 2000, total: 2000, status: "DONE" }, "the newest 2,000 (IMPORT_MAX_GAMES)");
    assert.equal(chunks, 20, "one statement per 100 games");
    assert.ok(statements <= 41, `${statements} statements (claim included) for 2,000 games`);
    assert.ok(w.db.counters.roundTrips - t0 <= 36, "the finish rides in one batch");
    assert.equal(w.upstream.maxActive.chesscom, 1);
  });

  // ── 2. re-run: nothing new ─────────────────────────────────────────────────────────────────────────────────────
  it("2: a daily re-run with nothing new: archives 304, no month request, no chunk, no run row, lastSyncOkAt moves", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "d2");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const syncedAt = async () =>
      Number((await w.q(`SELECT (extract(epoch FROM "lastSyncOkAt") * 1000)::float8 AS ms FROM linked_accounts WHERE id = $1`, [la]))[0]!.ms);
    const ok0 = await syncedAt();
    await w.clock.advance(86_400_000);
    await w.due(jobId);
    const sent0 = w.driver.sent.length;
    const req0 = w.upstream.requests.length;

    assert.equal(await w.runNext(ME), "done");

    const sent = w.driver.sent.slice(sent0);
    assert.equal(sent.filter((t) => t.includes("jsonb_to_recordset")).length, 0, "no batch statement");
    assert.ok(sent.length <= 5, `claim + context + known? + finish batch (${sent.length} statements)`);
    const reqs = w.upstream.requests.slice(req0);
    assert.deepEqual(reqs.map((r) => r.path), ["/pub/player/knightowl_88", "/pub/player/knightowl_88/games/archives"]);
    assert.ok(reqs[1]!.headers["if-none-match"], "the archives request is conditional");
    assert.equal((await w.q(`SELECT 1 FROM import_runs WHERE "linkedAccountId" = $1`, [la])).length, 1, "no DAILY run row");
    const [a1] = await w.q(`SELECT "importState"::text AS s FROM linked_accounts WHERE id = $1`, [la]);
    assert.equal(await syncedAt(), ok0 + 86_400_000, "lastSyncOkAt advanced to this sync");
    assert.equal(a1!.s, "IDLE");
    assert.equal((await jobRow(env, jobId)).status, "QUEUED", "rescheduled again");
    assert.equal(w.importEvents().filter((e) => e.event === "import:finished").length, 1, "no finished event for a 0-game DAILY");
  });

  // ── 3. one new game ────────────────────────────────────────────────────────────────────────────────────────────
  it("3: a new game in the current month imports exactly one game in a DAILY run", async () => {
    const w = world();
    const acc = w.upstream.addChessComFixture();
    const u = await w.member("paying", "d3");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const src = acc.months.get("2026/10")![0]!;
    const endTime = Math.floor((IMPORT_T0 - 3_600_000) / 1000);
    acc.months.set("2026/11", [{ ...src, url: `${String(src.url)}9`, uuid: `${String(src.uuid)}-new`, end_time: endTime }]);
    acc.version++;
    await w.due(jobId);
    assert.equal(await w.runNext(ME), "done");
    const runs = await w.q(`SELECT trigger::text AS trigger, status::text AS status, imported FROM import_runs WHERE "linkedAccountId" = $1 ORDER BY id`, [la]);
    assert.deepEqual(runs.map((r) => [r.trigger, r.status, r.imported]), [["INITIAL", "DONE", 45], ["DAILY", "DONE", 1]]);
    assert.equal(Number((await w.q(`SELECT count(*) FROM game_players WHERE "userId" = $1`, [u.id]))[0]!.count), 46);
    const fetched = w.upstream.to("chesscom", /\/games\/\d{4}\/\d{2}$/).map((r) => r.path.slice(-7));
    assert.deepEqual(fetched.slice(3), ["2026/11"], "only the current month is read again");
    const [cur] = await w.q(`SELECT archives FROM import_cursors WHERE "linkedAccountId" = $1`, [la]);
    assert.equal((cur!.archives as { months: Record<string, { done: boolean }> }).months["2026/11"]!.done, false, "the current month is never done");
  });

  // ── 4. a failure mid-run, then the retry ───────────────────────────────────────────────────────────────────────
  it("4: a 503 after the first month fails attempt 1 (saved games kept); attempt 2 resumes without duplicates", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    w.upstream.faults.push({ provider: "chesscom", match: /\/games\/2026\/09$/, status: 503 });
    const u = await w.member("paying", "f4");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");

    assert.equal(await w.runNext(ME), "failed");
    const j1 = await jobRow(env, jobId);
    assert.equal(j1.status, "QUEUED");
    assert.equal(j1.attempts, 1);
    assert.ok(j1.runAtMs - j1.nowMs > 55_000 && j1.runAtMs - j1.nowMs <= 61_000, "IMPORT_SYNC back-off: 60 s");
    assert.match(j1.lastError ?? "", /^upstream: /);
    const [r1] = await w.q(`SELECT status::text AS status, imported, error FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r1!.status, "RUNNING", "RUNNING until the last attempt");
    assert.ok(Number(r1!.imported) > 0 && Number(r1!.imported) < 45, "the newest month was saved before the failure");
    assert.equal((r1!.error as { code: string }).code, "upstream");
    assert.equal(w.importEvents().filter((e) => e.event === "import:failed").length, 0, "not terminal: no import:failed");

    await w.due(jobId);
    assert.equal(await w.runNext(ME), "done");
    const [r2] = await w.q(`SELECT status::text AS status, imported, total, "analysisQueued" FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r2!.status, "DONE");
    assert.equal(r2!.imported, 45, "the final counts equal a clean run");
    assert.equal(r2!.total, 45);
    assert.equal(Number((await w.q(`SELECT count(*) FROM game_players WHERE "userId" = $1`, [u.id]))[0]!.count), 45, "no duplicates");
    const queued = await w.q(`SELECT priority FROM ${env.schema}.jobs WHERE kind = 'ANALYZE_GAME' AND "userId" = $1 AND priority = $2`, [u.id, JOB_PRIORITY.USER_OPENED]);
    assert.equal(queued.length, 1, "the newest game is queued at USER_OPENED once across both attempts");
  });

  // ── 5. two members who played each other; two members linking the same account ─────────────────────────────────
  it("5: two members who played each other share one games row; a member co-claiming the same account gets claim copies", async () => {
    const w = world();
    const acc = w.upstream.addChessComFixture();
    w.upstream.addChessComOpponent(acc, "opponent_31");
    const a = await w.member("paying", "m5a");
    const b = await w.member("paying", "m5b");
    const laA = await w.link(a, "CHESSCOM", "KnightOwl_88");
    const laB = await w.link(b, "CHESSCOM", "opponent_31");
    await w.job(laA, (await w.run(a, laA, "CHESSCOM", "INITIAL")).id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const before = Number((await w.q(`SELECT count(*) FROM games WHERE source = 'CHESSCOM' AND "externalId" LIKE $1`, [`%${w.upstream.tag}`]))[0]!.count);
    const runB = await w.run(b, laB, "CHESSCOM", "INITIAL");
    await w.job(laB, runB.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const after = Number((await w.q(`SELECT count(*) FROM games WHERE source = 'CHESSCOM' AND "externalId" LIKE $1`, [`%${w.upstream.tag}`]))[0]!.count);
    assert.equal(after, before, "B's game is A's games row (the conflict arbiter, AP-26)");
    const shared = await w.q(
      `SELECT g."whitePlayerId"::text AS wp, g."blackPlayerId"::text AS bp, array_agg(gp."userId"::text ORDER BY gp.color) AS users
         FROM games g JOIN game_players gp ON gp."gameId" = g.id
        WHERE g.id IN (SELECT "gameId" FROM game_players WHERE "userId" = $1) GROUP BY g.id`,
      [b.id],
    );
    assert.equal(shared.length, 1);
    assert.deepEqual([...(shared[0]!.users as string[])].sort(), [a.id, b.id].sort(), "two game_players rows");
    assert.deepEqual([shared[0]!.wp, shared[0]!.bp].sort(), [a.id, b.id].sort(), "both sides set");
    const [rb] = await w.q(`SELECT imported, skipped FROM import_runs WHERE id = $1`, [runB.id]);
    assert.equal(rb!.imported, 1);

    // A third member links the same Chess.com account (unverified links may coexist, D4-10, plan §8.15 "link anyway").
    // regression: chesscom-coclaim-squat (FIX-2, import review round 2): every side was "taken", so the second
    // claimant got 0 games for good, and whoever typed a handle first blocked its owner. Now every claimant gets the
    // games through their own claim copies (co-claim.ts), and nobody loses a side (docs/decisions.md FX-10).
    const aSides = async () =>
      (await w.q(`SELECT count(*)::int AS n FROM game_players WHERE "userId" = $1 AND "linkedAccountId" = $2`, [a.id, laA]))[0]!.n;
    const aBefore = await aSides();
    const c = await w.member("paying", "m5c");
    const laC = await w.link(c, "CHESSCOM", "KnightOwl_88");
    const runC = await w.run(c, laC, "CHESSCOM", "INITIAL");
    const jobC = await w.job(laC, runC.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done", "game_players_gameId_color_key never fails the chunk");
    const [rc] = await w.q(`SELECT imported, skipped, status::text AS status, "firstGameId"::text AS first FROM import_runs WHERE id = $1`, [runC.id]);
    assert.equal(rc!.status, "DONE");
    assert.equal(rc!.imported, 45, "the co-claimant gets every game");
    assert.equal(rc!.skipped, 3, "only the genuine skips (chess960, unrated, the bad FEN)");
    assert.ok(rc!.first, "the run has a first game for the Done screen");
    const copies = await w.q<{ ext: string; wp: string | null; bp: string | null; creator: string; status: string }>(
      `SELECT g."externalId" AS ext, g."whitePlayerId"::text AS wp, g."blackPlayerId"::text AS bp, g."creatorId"::text AS creator,
              g."analysisStatus"::text AS status
         FROM games g JOIN game_players gp ON gp."gameId" = g.id WHERE gp."userId" = $1`,
      [c.id],
    );
    assert.equal(copies.length, 45);
    assert.ok(copies.every((g) => g.ext.endsWith(`~${laC}`)), "claim copies, keyed by C's link");
    assert.ok(copies.every((g) => g.creator === c.id && [g.wp, g.bp].includes(c.id) && ![g.wp, g.bp].includes(a.id)));
    assert.ok(copies.some((g) => g.status === "QUEUED"), "C's games are analysed for C");
    assert.equal(await aSides(), aBefore, "A keeps every side");
    assert.equal(Number((await w.q(`SELECT count(*) FROM games WHERE source = 'CHESSCOM' AND "externalId" LIKE $1`, [`%${w.upstream.tag}`]))[0]!.count), before);
    const [la] = await w.q(`SELECT "importedCount" AS n FROM linked_accounts WHERE id = $1`, [laC]);
    assert.equal(la!.n, 45);

    // The known filter maps C's copies back to the provider ids (so a re-read of a month writes nothing for C).
    const baseIds = (await w.q<{ ext: string }>(
      `SELECT g."externalId" AS ext FROM games g JOIN game_players gp ON gp."gameId" = g.id WHERE gp."userId" = $1`,
      [a.id],
    )).map((r) => r.ext);
    const knownForC = await knownExternalIds(w.db, c.id, "CHESSCOM", baseIds, laC);
    assert.deepEqual([...knownForC].sort(), [...baseIds].sort());
    assert.equal((await knownExternalIds(w.db, b.id, "CHESSCOM", baseIds, laB)).size, 1, "B holds only the game it played");

    // The next (daily) sync of C: nothing new, nothing doubled.
    await w.due(jobC);
    assert.equal(await w.runNext(ME), "done");
    // A daily sync with nothing new writes no run (test 2); C keeps exactly its 45 copies and the job is rescheduled.
    const runsC = await w.q(`SELECT trigger::text AS trigger, imported FROM import_runs WHERE "linkedAccountId" = $1 ORDER BY id`, [laC]);
    assert.deepEqual(runsC.map((r) => [r.trigger, r.imported]), [["INITIAL", 45]]);
    assert.equal((await jobRow(env, jobC)).status, "QUEUED", "rescheduled");
    assert.equal(Number((await w.q(`SELECT count(*) FROM game_players WHERE "userId" = $1`, [c.id]))[0]!.count), 45);
  });

  // ── 6. Lichess 429 ─────────────────────────────────────────────────────────────────────────────────────────────
  it("6: a Lichess 429 pauses the gate 60 s, the run waits RATE_LIMITED; nobody overlaps a request", async () => {
    const w = world();
    w.upstream.addLichessFixture();
    w.upstream.faults.push({ provider: "lichess", status: 429, retryAfterSec: 30 });
    const u = await w.member("paying", "l6");
    const la = await w.link(u, "LICHESS", "KnightOwl88");
    const run = await w.run(u, la, "LICHESS", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");

    assert.equal(await w.runNext(ME), "failed");
    assert.equal(w.providers.gates.lichess.pauseUntil, w.clock.now() + 60_000, "the ladder's 60 s beats Retry-After 30");
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "QUEUED");
    assert.ok(Math.abs(job.runAtMs - job.nowMs - 60_000) < 2_000, "the job waits for the pause");
    const [r] = await w.q(`SELECT status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.status, "QUEUED");
    const [a] = await w.q(`SELECT "importState"::text AS s, "nextAllowedSyncAt" FROM linked_accounts WHERE id = $1`, [la]);
    assert.equal(a!.s, "RATE_LIMITED");
    assert.ok(a!.nextAllowedSyncAt);
    const failed = w.importEvents().filter((e) => e.event === "import:failed");
    assert.equal(failed.length, 1);
    assert.equal((failed[0]!.data as { code: string; retryAt: string }).code, "rate_limited");
    assert.ok((failed[0]!.data as { retryAt: string | null }).retryAt);
    assert.deepEqual(w.product.refused, []);
    assert.deepEqual(
      w.product.events.map((e) => [e.event, e.props.pause_sec ?? null]),
      [["import_started", null], ["import_rate_limited", 60]],
      "a 429 is not a terminal failure: no import_failed",
    );

    // After the pause: the retry imports everything.
    await w.clock.advance(60_000);
    await w.due(jobId);
    assert.equal(await w.runNext(ME), "done");
    const [r2] = await w.q(`SELECT status::text AS status, imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r2!.status, "DONE");
    assert.equal(r2!.imported, 29);
    assert.equal(w.upstream.maxActive.lichess, 1, "never two concurrent requests");
    const later = w.product.events.slice(2).map((e) => e.event);
    assert.ok(later.includes("import_finished") && !later.includes("import_started"), "one start per run");
  });

  // regression: rate-limit-uses-attempts (FIX-2, import review round 2): a 429 used up an IMPORT_SYNC attempt, so five
  // Lichess 429s in a row ended the run FAILED before the ladder's 900 s step. Plan §8.11: a 429 only pauses and
  // requeues; it has no terminal case.
  it("6b: sustained Lichess 429s pause along the whole ladder and never use up the job's attempts", async () => {
    const w = world();
    w.upstream.addLichessFixture();
    w.upstream.faults.push({ provider: "lichess", status: 429, times: 7 });
    const u = await w.member("paying", "l6b");
    const la = await w.link(u, "LICHESS", "KnightOwl88");
    const run = await w.run(u, la, "LICHESS", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    const maxAttempts = (await jobRow(env, jobId)).maxAttempts;
    assert.ok(maxAttempts < 7, "more 429s than the job has attempts");

    const pauses: number[] = [];
    for (let i = 0; i < 7; i++) {
      assert.equal(await w.runNext(ME), "failed", `429 #${i + 1}`);
      const pause = w.providers.gates.lichess.pauseUntil - w.clock.now();
      pauses.push(Math.round(pause / 1000));
      const job = await jobRow(env, jobId);
      assert.equal(job.status, "QUEUED", `429 #${i + 1}: the job waits, it is not FAILED`);
      assert.equal(job.attempts, 0, `429 #${i + 1}: the claim's attempt is given back`);
      const [r] = await w.q(`SELECT status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
      assert.equal(r!.status, "QUEUED");
      const [a] = await w.q(`SELECT "importState"::text AS s FROM linked_accounts WHERE id = $1`, [la]);
      assert.equal(a!.s, "RATE_LIMITED");
      await w.clock.advance(pause);
      await w.due(jobId);
    }
    assert.deepEqual(pauses, [60, 120, 240, 480, 900, 900, 900], "the ladder reaches its 900 s step and stays there");
    const failedEvents = w.importEvents().filter((e) => e.event === "import:failed");
    assert.equal(failedEvents.length, 7);
    assert.ok(failedEvents.every((e) => (e.data as { code: string; retryAt: string | null }).code === "rate_limited" && (e.data as { retryAt: string | null }).retryAt));
    assert.equal(w.product.events.some((e) => e.event === "import_failed"), false, "never a terminal failure");
    assert.equal(w.product.events.filter((e) => e.event === "import_started").length, 1, "one start per run, pauses included");

    // The provider answers again: the same run imports everything.
    assert.equal(await w.runNext(ME), "done");
    const [done] = await w.q(`SELECT status::text AS status, imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(done!.status, "DONE");
    assert.equal(done!.imported, 29);
  });

  // ── 7. Lichess interrupted mid-stream, then resumed ────────────────────────────────────────────────────────────
  it("7: a stream cut at game 140 of 240 saves what it read; the resume reads only the older rest", async () => {
    const w = world();
    const newest = IMPORT_T0 - 3_600_000;
    w.upstream.addLichessMany("knightowl88", 240, newest, 3_600_000);
    w.upstream.breakLichessAfter = 140;
    const u = await w.member("paying", "l7");
    const la = await w.link(u, "LICHESS", "KnightOwl88");
    const run = await w.run(u, la, "LICHESS", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");

    assert.equal(await w.runNext(ME), "failed");
    const [c1] = await w.q(`SELECT "lichessResumeUntilMs"::text AS ru, "lichessSinceMs" FROM import_cursors WHERE "linkedAccountId" = $1`, [la]);
    assert.equal(Number(c1!.ru), newest - 139 * 3_600_000, "the resume point = the oldest saved game");
    assert.equal(c1!.lichessSinceMs, null);
    const [r1] = await w.q(`SELECT imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r1!.imported, 140);

    await w.due(jobId);
    assert.equal(await w.runNext(ME), "done");
    const stream2 = w.upstream.to("lichess").at(-1)!;
    assert.equal(stream2.query.get("until"), String(newest - 139 * 3_600_000 - 1), "until = resume − 1");
    assert.equal(stream2.query.get("since"), w.upstream.to("lichess")[0]!.query.get("since"), "the original since");
    const [r2] = await w.q(`SELECT imported, status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r2!.status, "DONE");
    assert.equal(r2!.imported, 240);
    assert.equal(Number((await w.q(`SELECT count(*) FROM game_players WHERE "userId" = $1`, [u.id]))[0]!.count), 240);
    const [c2] = await w.q(`SELECT "lichessResumeUntilMs", "lichessSinceMs"::text AS since FROM import_cursors WHERE "linkedAccountId" = $1`, [la]);
    assert.equal(c2!.lichessResumeUntilMs, null);
    assert.equal(Number(c2!.since), newest, "since = the newest game of the run");
  });

  // ── 8. anonymous, paced stream; the early chunk lands quickly ───────────────────────────────────────────────────
  it("8: the Lichess export is anonymous; at 20 games/s the early chunk lands within 6 s", async () => {
    const w = world();
    w.upstream.addLichessMany("knightowl88", 120, IMPORT_T0 - 3_600_000);
    w.upstream.lichessPace = { advance: (ms) => w.clock.advance(ms), msPerLine: 50 };
    const u = await w.member("trial", "l8");
    const la = await w.link(u, "LICHESS", "KnightOwl88");
    const run = await w.run(u, la, "LICHESS", "INITIAL");
    await w.job(la, run.id, "INITIAL");
    const t0 = w.clock.now();
    let earlyAt: number | null = null;
    const emit = w.emitter.emit.bind(w.emitter);
    w.emitter.emit = (async (event: string, data: unknown, refs: readonly string[], o?: { dedupeKey?: string }) => {
      if (event === "import:progress" && earlyAt === null && (data as { imported: number }).imported > 0) earlyAt = w.clock.now();
      return emit(event as never, data as never, refs, o);
    }) as typeof w.emitter.emit;
    assert.equal(await w.runNext(ME), "done");
    assert.ok(earlyAt !== null && earlyAt - t0 <= 6_000, `early chunk at ${String(earlyAt && earlyAt - t0)} ms`);
    for (const r of w.upstream.to("lichess")) {
      assert.equal(r.headers.authorization, undefined, "no Authorization header, ever (D4-21)");
      assert.match(r.headers["user-agent"] ?? "", /^ReplayChess\/1\.0 \(\+https:\/\/playchess\.tech; /);
    }
    const [r] = await w.q(`SELECT imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.imported, 120);
  });

  // ── 9. account deleted mid-run ─────────────────────────────────────────────────────────────────────────────────
  it("9: an account deleted mid-run stops the import; saved rows keep their game but lose the link", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "x9");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    w.upstream.before.push({
      match: /\/games\/2026\/09$/,
      once: true,
      run: async () => {
        await env.owner.query(`DELETE FROM linked_accounts WHERE id = $1`, [la]);
      },
    });
    assert.equal(await w.runNext(ME), "done");
    assert.equal((await jobRow(env, jobId)).status, "DONE", "no reschedule for a gone account");
    assert.equal((await w.q(`SELECT 1 FROM import_runs WHERE id = $1`, [run.id])).length, 0, "the run went with the account");
    const rows = await w.q(`SELECT "linkedAccountId" FROM game_players WHERE "userId" = $1`, [u.id]);
    assert.ok(rows.length > 0 && rows.length < 45, "the early chunk's rows exist");
    assert.ok(rows.every((r) => r.linkedAccountId === null), "the FK set them NULL");
    const orphanJobs = await w.q(
      `SELECT 1 FROM ${env.schema}.jobs j WHERE j.kind = 'ANALYZE_GAME' AND j."userId" = $1
          AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp."gameId" = j."gameId" AND gp."userId" = $1)`,
      [u.id],
    );
    assert.equal(orphanJobs.length, 0, "no orphan rows");
  });

  // ── 10. not entitled at start ──────────────────────────────────────────────────────────────────────────────────
  it("10: a member without an active membership parks the run; no provider call, no reschedule", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("none", "n10");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.upstream.requests.length, 0);
    const [r] = await w.q(`SELECT status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.status, "WAITING_FOR_MEMBERSHIP");
    const [a] = await w.q(`SELECT "importState"::text AS s FROM linked_accounts WHERE id = $1`, [la]);
    assert.equal(a!.s, "WAITING_FOR_MEMBERSHIP");
    const job = await jobRow(env, jobId);
    assert.equal(job.status, "DONE", "parked: no reschedule (the entitlement fan-out restarts it)");
    assert.equal(job.lockedBy, ME);
  });

  // ── INTEGRATE-2 regression: unlink with "delete games", re-link, the purge has not run yet ──────────────────────────
  it("an import waits while a purge of the same member and provider is pending, then imports after it", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("trial", "pg1");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    const purgeId = await insertJob(env, {
      kind: "IMPORT_PURGE",
      priority: JOB_PRIORITY.IMPORT_PURGE,
      runAtSec: 600,
      payload: { v: 1, userId: String(u.id), provider: "CHESSCOM", requestedAt: new Date(IMPORT_T0).toISOString() },
      dedupeKey: `importpurge:${String(u.id)}:chesscom`,
    });
    const before = await jobRow(env, jobId);
    assert.equal(await w.runNext(ME), "done");
    assert.equal(w.upstream.requests.length, 0, "no provider call while the purge is pending");
    const [games] = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM game_players WHERE "userId" = $1`, [u.id]);
    assert.equal(games!.n, 0);
    const waiting = await jobRow(env, jobId);
    assert.equal(waiting.status, "QUEUED", "the same job again later");
    assert.deepEqual(waiting.payload, before.payload, "payload kept (INITIAL, the same run)");
    assert.equal(waiting.priority, JOB_PRIORITY.IMPORT_SYNC_INITIAL, "priority kept");
    const [r] = await w.q(`SELECT status::text AS status FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.status, "QUEUED", "the run waits untouched");

    await env.owner.query(`UPDATE ${env.schema}.jobs SET status = 'DONE' WHERE id = $1`, [purgeId]);
    await w.due(jobId);
    assert.equal(await w.runNext(ME), "done");
    assert.ok(w.upstream.requests.length > 0);
    const [after] = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM game_players WHERE "userId" = $1`, [u.id]);
    assert.ok(after!.n > 0, "imported once the purge is over");
  });

  // ── 12. the connection dies between two chunks ──────────────────────────────────────────────────────────────────
  it("12: a Postgres connection killed between two chunks is retried once on a fresh connection", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "k12");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    await w.job(la, run.id, "INITIAL");
    let killed = 0;
    w.driver.beforeRun = async (ss) => {
      // After the early chunk, before the saving chunk: terminate every backend of the worker's connection pool.
      if (killed === 0 && ss.some((s) => s.text.includes("jsonb_to_recordset")) && w.driver.sent.some((t) => t.includes("jsonb_to_recordset"))) {
        const res = await env.owner.query(
          `SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND usename = $1`,
          [new URL(env.workerUrl).username],
        );
        killed = Number(res.rows[0].n);
      }
    };
    assert.equal(await w.runNext(ME), "done");
    w.driver.beforeRun = null;
    assert.ok(killed >= 1, "a connection was killed");
    const [r] = await w.q(`SELECT status::text AS status, imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.status, "DONE");
    assert.equal(r!.imported, 45);
  });

  // ── 13. analysis completion with importRunId ────────────────────────────────────────────────────────────────────
  it("regression: review-ready-after-import (FIX-1): the first review of an INITIAL run records import.review_ready_ms and review_ready_after_import once", async () => {
    const w = world();
    w.upstream.addLichessFixture();
    const u = await w.member("trial", "a13r");
    const la = await w.link(u, "LICHESS", "KnightOwl88");
    const run = await w.run(u, la, "LICHESS", "INITIAL");
    await w.job(la, run.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const [r0] = await w.q(`SELECT "firstGameId"::text AS g FROM import_runs WHERE id = $1`, [run.id]);
    const firstJob = await w.q(`SELECT id::text AS id FROM ${env.schema}.jobs WHERE kind = 'ANALYZE_GAME' AND "gameId" = $1`, [r0!.g]);
    assert.equal(firstJob.length, 1, "the newest imported game has its analysis queued");
    const second = await w.q(
      `SELECT id::text AS id FROM ${env.schema}.jobs WHERE kind = 'ANALYZE_GAME' AND "userId" = $1 AND "gameId" <> $2 ORDER BY priority DESC LIMIT 1`,
      [u.id, r0!.g],
    );
    const store = new SqlAnalysisStore(w.db);
    const engine = new EnginePool({ factory: () => new FakeEngine(), log: silentLogger, metrics: w.metrics });
    await engine.start();
    const batch = new BatchAccumulator({ emitter: w.emitter, clock: w.clock, log: silentLogger, queuedFor: (x) => store.queuedFor(x) });
    const book = new OpeningBook(() => store.openings(), silentLogger);
    const events = new RecordingProductEvents();
    const analyse = async (jobId: string) => {
      await env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = "runAt" + interval '1 day' WHERE kind = 'ANALYZE_GAME' AND id <> $1 AND status = 'QUEUED'`, [jobId]);
      await env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = $1`, [jobId]);
      const job = await claimJob(w.db, ME, ["ANALYZE_GAME"], 1);
      assert.equal(job?.id, jobId);
      return runJob(job!, {
        db: w.db,
        clock: w.clock,
        log: silentLogger,
        metrics: w.metrics,
        telemetry: w.telemetry,
        emitter: w.emitter,
        me: ME,
        appEnv: "test",
        handlers: { ANALYZE_GAME: analyzeGameHandler({ store, book, batch, events }) },
        engine,
        evalCache: null,
        evalCacheMaxBytes: 0,
        lag: null,
        stopSignal: new AbortController().signal,
        isWatched: () => false,
        takeFault: () => null,
      });
    };
    try {
      // Another of the run's games first: not the first review, nothing recorded.
      if (second[0]) {
        assert.equal(await analyse(String(second[0].id)), "done");
        assert.equal(w.metrics.imports.count("import.review_ready_ms"), 0);
      }
      assert.equal(await analyse(String(firstJob[0]!.id)), "done");
    } finally {
      await engine.stop();
    }
    assert.equal(w.metrics.imports.count("import.review_ready_ms"), 1);
    assert.ok(w.metrics.imports.total("import.review_ready_ms", { provider: "lichess" }) >= 0);
    const ready = events.events.filter((e) => e.event === "review_ready_after_import");
    assert.deepEqual(events.refused, []);
    assert.equal(ready.length, 1);
    assert.equal(ready[0]!.distinctId, u.ref, "the member's ref");
    assert.equal(ready[0]!.props.provider, "lichess");
    assert.ok(typeof ready[0]!.props.ms_since_entitled === "number" && (ready[0]!.props.ms_since_entitled as number) >= 0);
  });

  it("13: an imported Lichess game is analysed from its evalHint; the run's analysed count moves and shows up", async () => {
    const w = world();
    w.upstream.addLichessFixture();
    const u = await w.member("trial", "a13");
    const la = await w.link(u, "LICHESS", "KnightOwl88");
    const run = await w.run(u, la, "LICHESS", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    assert.equal(await w.runNext(ME), "done");
    const hinted = await w.q(
      `SELECT j.id::text AS id, j."gameId"::text AS "gameId", j.payload FROM ${env.schema}.jobs j
        WHERE j.kind = 'ANALYZE_GAME' AND j."userId" = $1 AND j.payload ? 'evalHint' ORDER BY j.priority DESC, j."fairSeq" LIMIT 1`,
      [u.id],
    );
    assert.equal(hinted.length, 1, "a Lichess game with a full analysis carries its evalHint");
    const payload = hinted[0]!.payload as { importRunId: string; evalHint: { cp: number[] } };
    assert.equal(payload.importRunId, run.id);
    // Only that analysis is claimable now.
    await env.owner.query(`UPDATE ${env.schema}.jobs SET "runAt" = "runAt" + interval '1 day' WHERE kind = 'ANALYZE_GAME' AND id <> $1`, [hinted[0]!.id]);

    const store = new SqlAnalysisStore(w.db);
    const fakes: FakeEngine[] = [];
    const engine = new EnginePool({
      factory: () => {
        const e = new FakeEngine();
        fakes.push(e);
        return e;
      },
      log: silentLogger,
      metrics: w.metrics,
    });
    await engine.start();
    const batch = new BatchAccumulator({ emitter: w.emitter, clock: w.clock, log: silentLogger, queuedFor: (r) => store.queuedFor(r) });
    const book = new OpeningBook(() => store.openings(), silentLogger);
    const job = await claimJob(w.db, ME, ["ANALYZE_GAME"], 1);
    assert.equal(job?.id, hinted[0]!.id);
    const out = await runJob(job!, {
      db: w.db,
      clock: w.clock,
      log: silentLogger,
      metrics: w.metrics,
      telemetry: w.telemetry,
      emitter: w.emitter,
      me: ME,
      appEnv: "test",
      handlers: { ANALYZE_GAME: analyzeGameHandler({ store, book, batch, events: new RecordingProductEvents() }) },
      engine,
      evalCache: null,
      evalCacheMaxBytes: 0,
      lag: null,
      stopSignal: new AbortController().signal,
      isWatched: () => false,
      takeFault: () => null,
    });
    await engine.stop();
    assert.equal(out, "done");
    const searches = fakes.reduce((n, e) => n + e.searches, 0);
    assert.ok(searches <= 1 + 6, `pass 1 came from the hint: ${searches} engine searches for ${payload.evalHint.cp.length} plies`);
    const [ga] = await w.q(`SELECT "evalSource"::text AS s FROM ${env.schema}.game_analyses WHERE "gameId" = $1`, [hinted[0]!.gameId]);
    assert.ok(ga!.s === "LICHESS" || ga!.s === "MIXED");
    const [r] = await w.q(`SELECT analysed FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(r!.analysed, 1, "import_runs.analysed + 1");

    // The next sync's progress carries it: a new game arrives, its chunk returns the run's analysed.
    const acc = w.upstream.lichess.get("knightowl88")!;
    const first = acc.lines.find((l) => typeof l !== "string")! as Record<string, unknown>;
    acc.lines.unshift({ ...first, id: w.upstream.lichessId(1200), createdAt: IMPORT_T0 - 1_000, lastMoveAt: IMPORT_T0 - 500 });
    await env.owner.query(`UPDATE import_runs SET status = 'RUNNING' WHERE id = $1`, [run.id]);
    await env.owner.query(
      `UPDATE ${env.schema}.jobs SET payload = $2::jsonb, "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = $1`,
      [jobId, JSON.stringify({ v: 1, linkedAccountId: la, runId: run.id, trigger: "RETRY" })],
    );
    await w.clock.advance(5_000);
    assert.equal(await w.runNext(ME), "done");
    const progress = w.importEvents().filter((e) => e.event === "import:progress").at(-1)!;
    assert.equal((progress.data as { analysed: number }).analysed, 1);
  });

  // ── two workers never import the same account twice ────────────────────────────────────────────────────────────
  it("two workers never import one account at the same time; a worker that lost the job writes no chunk", async () => {
    const w = world();
    w.upstream.addChessComFixture();
    const u = await w.member("paying", "tw");
    const la = await w.link(u, "CHESSCOM", "KnightOwl_88");
    const run = await w.run(u, la, "CHESSCOM", "INITIAL");
    const jobId = await w.job(la, run.id, "INITIAL");
    const [a, b] = await Promise.all([w.claim(ME), w.claim(OTHER)]);
    assert.equal([a, b].filter(Boolean).length, 1, "one import:<id> row, one claimer");
    const holder = a ? ME : OTHER;
    const job = (a ?? b)!;
    // The reaper hands the job to another worker while the holder reads the second month.
    w.upstream.before.push({
      match: /\/games\/2026\/09$/,
      once: true,
      run: async () => {
        await env.owner.query(`UPDATE ${env.schema}.jobs SET "lockedBy" = 'someone-else-00000000' WHERE id = $1`, [jobId]);
      },
    });
    const chunks0 = w.driver.sent.filter((t) => t.includes("jsonb_to_recordset")).length;
    assert.equal(await w.runClaimed(job, holder), "lost");
    const chunks = w.driver.sent.filter((t) => t.includes("jsonb_to_recordset")).length - chunks0;
    const [r] = await w.q(`SELECT imported FROM import_runs WHERE id = $1`, [run.id]);
    assert.equal(chunks, 2, "the early chunk committed; the next chunk was refused by its lock check");
    assert.ok(Number(r!.imported) > 0 && Number(r!.imported) < 45, "nothing after the lock was lost");
    assert.equal((await jobRow(env, jobId)).lockedBy, "someone-else-00000000", "the new holder's state is untouched");
  });
});
