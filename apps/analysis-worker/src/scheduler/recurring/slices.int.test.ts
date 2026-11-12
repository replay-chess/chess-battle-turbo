// HOUSEKEEPING's slices against Postgres (phase-03 plan §7.7, task C6 "housekeeping prunes, verified with seeded old
// rows; the next HOUSEKEEPING row is planned"), as role replay_worker. Each test file has private copies of jobs,
// shares, the two limiter tables and game_analyses (testing/pg.ts), so these prunes touch nothing of other suites.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GRADING_VERSION } from "@repo/chess-analysis/version";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { housekeepingHandler } from "../../jobs/housekeeping";
import { runJob } from "../../jobs/runner";
import { silentLogger } from "../../obs/log";
import { Metrics } from "../../obs/metrics";
import { RecordingTelemetry } from "../../obs/telemetry";
import { claimJob } from "../../queue/claim";
import { CountingDb, pgDriver, type Row, type Statement } from "../../db/client";
import { RecordingEmitter } from "../../socket/emit";
import { realClock } from "../clock";
import { insertJob, jobRow, makeGame, makeUser, run, setupInt, skipInt, type IntEnv } from "../../testing/pg";
import { RECURRING_SLICES } from ".";
import { HOUSEKEEPING_HOUR_UTC } from "./housekeeping-plan";

const ME = "int-hk-00000001";
const DAY = 86_400;

describe("HOUSEKEEPING slices (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;

  before(async () => {
    env = await setupInt("hk");
  });
  after(async () => {
    await env?.close();
  });

  async function finished(status: "DONE" | "FAILED" | "CANCELLED", agoDays: number) {
    const id = await insertJob(env, { status, dedupeKey: `t:${status}:${agoDays}:${run}` });
    await env.owner.query(
      `UPDATE ${env.schema}.jobs SET "finishedAt" = (now() AT TIME ZONE 'UTC') - ($2::int * interval '1 day') WHERE id = $1`,
      [id, agoDays],
    );
    return id;
  }

  it("prunes old jobs, expired shares and limiter rows, enqueues outdated analyses, plans tomorrow, and finishes DONE", async () => {
    const w = await makeUser(env.owner, "hk");
    const b = await makeUser(env.owner, "hb");
    // jobs
    const doneOld = await finished("DONE", 15);
    const doneNew = await finished("DONE", 13);
    const failedOld = await finished("FAILED", 31);
    const failedNew = await finished("FAILED", 29);
    const cancelledOld = await finished("CANCELLED", 31);
    // shares (owner writes; REVIEW expired 8 days ago goes, 6 days ago stays; POSITION is not P3's)
    const share = (code: string, kind: string, expiredDaysAgo: number) =>
      env.owner.query(
        `INSERT INTO ${env.schema}.shares (code, kind, "showUsername", "imageVersion", "expiresAt", "createdAt")
         VALUES ($1, $2::"ShareKind", true, 1, (now() AT TIME ZONE 'UTC') - ($3::int * interval '1 day'), now())`,
        [code, kind, expiredDaysAgo],
      );
    await share("hkold001", "REVIEW", 8);
    await share("hknew001", "REVIEW", 6);
    await share("hkpos001", "POSITION", 30);
    // limiter rows (the window ended 2 h ago goes, 10 min ago stays)
    for (const table of ["rate_limit_buckets", "rate_limit_windows"]) {
      await env.owner.query(
        `INSERT INTO ${env.schema}.${table} (key, count, "resetAt") VALUES ('old', 1, (now() AT TIME ZONE 'UTC') - interval '2 hours'),
                                                                       ('new', 1, (now() AT TIME ZONE 'UTC') - interval '10 minutes')`,
      );
    }
    // an outdated analysis (version 0) of a DONE game, with its DONE job (reason regrade revives it)
    const g = await makeGame(env.owner, w, b, { analysisStatus: "DONE" });
    await env.owner.query(
      `INSERT INTO ${env.schema}.game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "totalPlies", "gradedPlies",
                                                 evals, second, best, judgements, "updatedAt", "completedAt")
       VALUES ($1, $2, 'fake/sf18-v1', 120000, 1000000, 40, 40, '{}', '{}', '{}', '{}', now(), now())`,
      [g.id, GRADING_VERSION - 1],
    );
    const analyzeJob = await insertJob(env, {
      status: "DONE",
      gameId: g.id,
      dedupeKey: `analyze:${g.id}`,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
    const versionBefore = Number(
      (await env.owner.query(`SELECT "gamesVersion" FROM users WHERE id = $1`, [w.id])).rows[0].gamesVersion,
    );

    // Yesterday's run, a little late (its own day key, so the plan's next 21:00 is a new row).
    const day = new Date(Date.now() - DAY * 1000).toISOString().slice(0, 10);
    const hk = await insertJob(env, {
      kind: "HOUSEKEEPING",
      priority: JOB_PRIORITY.HOUSEKEEPING,
      maxAttempts: 2,
      dedupeKey: `housekeeping:${day}`,
      payload: { v: 1, day },
    });
    const clock = realClock();
    const metrics = new Metrics({ workerId: ME, bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now());
    const telemetry = new RecordingTelemetry();
    const job = await claimJob(env.db, ME, ["HOUSEKEEPING"], 1);
    assert.equal(job?.id, hk);
    const trips0 = env.db.counters.roundTrips;
    const result = await runJob(job!, {
      db: env.db,
      clock,
      log: silentLogger,
      metrics,
      telemetry,
      emitter: new RecordingEmitter(),
      me: ME,
      appEnv: "test",
      handlers: { HOUSEKEEPING: housekeepingHandler(RECURRING_SLICES) },
      engine: null,
      evalCache: null,
      evalCacheMaxBytes: 0,
      lag: null,
      stopSignal: new AbortController().signal,
      isWatched: () => false,
      takeFault: () => null,
    });
    assert.equal(result, "done");
    assert.equal(env.db.counters.roundTrips - trips0, 2, "the day's batch + one regrade enqueue batch");

    const ids = (await env.owner.query(`SELECT id::text AS id FROM ${env.schema}.jobs`)).rows.map((r) => r.id);
    for (const gone of [doneOld, failedOld, cancelledOld]) assert.ok(!ids.includes(gone), `job ${gone} pruned`);
    for (const kept of [doneNew, failedNew]) assert.ok(ids.includes(kept), `job ${kept} kept`);
    const codes = (await env.owner.query(`SELECT code FROM ${env.schema}.shares ORDER BY code`)).rows.map(
      (r) => r.code,
    );
    assert.deepEqual(codes, ["hknew001", "hkpos001"]);
    for (const table of ["rate_limit_buckets", "rate_limit_windows"]) {
      const keys = (await env.owner.query(`SELECT key FROM ${env.schema}.${table}`)).rows.map((r) => r.key);
      assert.deepEqual(keys, ["new"], table);
    }
    // regrade: the DONE job revived at HOUSEKEEPING priority, the game QUEUED, the members bumped
    const revived = await jobRow(env, analyzeJob);
    assert.equal(revived.status, "QUEUED");
    assert.equal(revived.priority, JOB_PRIORITY.HOUSEKEEPING);
    assert.equal((revived.payload as { reason: string }).reason, "regrade");
    const game = (await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id])).rows[0];
    assert.equal(game.s, "QUEUED");
    const versionAfter = Number(
      (await env.owner.query(`SELECT "gamesVersion" FROM users WHERE id = $1`, [w.id])).rows[0].gamesVersion,
    );
    assert.equal(versionAfter, versionBefore + 1);
    // the day itself
    const done = await jobRow(env, hk);
    assert.equal(done.status, "DONE");
    const next = new Date();
    next.setUTCHours(HOUSEKEEPING_HOUR_UTC, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    const planned = (
      await env.owner.query(`SELECT status::text AS s FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`, [
        `housekeeping:${next.toISOString().slice(0, 10)}`,
      ])
    ).rows;
    assert.deepEqual(planned, [{ s: "QUEUED" }], "the next 21:00 UTC run is planned");
    assert.deepEqual(
      telemetry.checkIns.map((c) => c.status),
      ["in_progress", "ok"],
    );
  });

  // regression: lost-housekeeping-response (FIX-2, review round 2). The day's batch went through a plain db.batch: when
  // it committed and its response was lost, the retry's lock guard failed with 22012 and the runner reported the job
  // "lost", so the slices' after() hooks (the regrade enqueues) and the monitor's "ok" check-in never ran.
  it("a day's batch whose response is lost is still done: the follow-ups run and the monitor gets ok", async () => {
    await env.owner.query(`DELETE FROM ${env.schema}.jobs`);
    await env.owner.query(`DELETE FROM ${env.schema}.game_analyses`);
    const w = await makeUser(env.owner, "hlw");
    const b = await makeUser(env.owner, "hlb");
    const g = await makeGame(env.owner, w, b, { analysisStatus: "DONE" });
    await env.owner.query(
      `INSERT INTO ${env.schema}.game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "totalPlies", "gradedPlies",
                                                 evals, second, best, judgements, "updatedAt", "completedAt")
       VALUES ($1, $2, 'fake/sf18-v1', 120000, 1000000, 40, 40, '{}', '{}', '{}', '{}', now(), now())`,
      [g.id, GRADING_VERSION - 1],
    );
    const analyzeJob = await insertJob(env, {
      status: "DONE",
      gameId: g.id,
      dedupeKey: `analyze:${g.id}`,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
    const day = new Date(Date.now() - 2 * DAY * 1000).toISOString().slice(0, 10);
    const hk = await insertJob(env, {
      kind: "HOUSEKEEPING",
      priority: JOB_PRIORITY.HOUSEKEEPING,
      maxAttempts: 2,
      dedupeKey: `housekeeping:${day}`,
      payload: { v: 1, day },
    });
    // Commits the day's batch (lock guard … DONE), then loses its response once.
    const inner = pgDriver(env.workerUrl);
    let lost = false;
    const db = new CountingDb({
      async run(ss: readonly Statement[], tx: boolean): Promise<Row[][]> {
        const out = await inner.run(ss, tx);
        if (!lost && ss[0]!.text.includes("SELECT 1 / (SELECT count(*)") && ss.some((x) => x.text.includes("SET status = 'DONE'"))) {
          lost = true;
          throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
        }
        return out;
      },
      close: () => inner.close(),
    });
    try {
      const clock = realClock();
      const telemetry = new RecordingTelemetry();
      const job = await claimJob(db, ME, ["HOUSEKEEPING"], 1);
      assert.equal(job?.id, hk);
      const result = await runJob(job!, {
        db,
        clock,
        log: silentLogger,
        metrics: new Metrics({ workerId: ME, bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now()),
        telemetry,
        emitter: new RecordingEmitter(),
        me: ME,
        appEnv: "test",
        handlers: { HOUSEKEEPING: housekeepingHandler(RECURRING_SLICES) },
        engine: null,
        evalCache: null,
        evalCacheMaxBytes: 0,
        lag: null,
        stopSignal: new AbortController().signal,
        isWatched: () => false,
        takeFault: () => null,
      });
      assert.ok(lost, "the batch's response was lost after it committed");
      assert.equal(db.counters.retries, 1);
      assert.equal(result, "done");
      assert.equal((await jobRow(env, hk)).status, "DONE");
      assert.deepEqual(
        telemetry.checkIns.map((c) => c.status),
        ["in_progress", "ok"],
      );
      const revived = await jobRow(env, analyzeJob);
      assert.equal(revived.status, "QUEUED", "the regrade follow-up still enqueued the outdated analysis");
      assert.equal((revived.payload as { reason: string }).reason, "regrade");
    } finally {
      await db.close();
    }
  });
});
