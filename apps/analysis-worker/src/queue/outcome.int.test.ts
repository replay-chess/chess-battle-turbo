// Done / fail / release / heartbeat / the lock guard against a real Postgres (phase-03 plan §8.12 "Failure",
// "Graceful SIGTERM", §7.7 back-off). Every statement is guarded by `lockedBy = me AND status = 'RUNNING'`, so a
// worker that lost its job cannot overwrite the new owner's state. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { insertJob, jobRow, makeGame, makeUser, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { claimJob } from "./claim";
import {
  backoffSec,
  doneStatement,
  failStatement,
  heartbeatStatement,
  isLockLost,
  lockGuardStatement,
  releaseStatement,
  toFailedJob,
} from "./outcome";

describe("job outcomes (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let w: TestUser;
  let b: TestUser;
  const ME = "dev-worker-0utc0me1";

  before(async () => {
    env = await setupInt("outcome");
    w = await makeUser(env.owner, "out_w");
    b = await makeUser(env.owner, "out_b");
  });
  after(async () => {
    await env?.close();
  });
  beforeEach(async () => {
    await env.owner.query(`DELETE FROM ${env.schema}.jobs`);
  });

  async function claimedAnalysis(attempts = 0) {
    const g = await makeGame(env.owner, w, b, { plyCount: 30, analysisStatus: "QUEUED" });
    const id = await insertJob(env, { gameId: g.id, attempts, payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" } });
    const job = await claimJob(env.db, ME, ["ANALYZE_GAME"], 1);
    assert.equal(job?.id, id);
    await env.owner.query(`UPDATE games SET "analysisStatus" = 'RUNNING' WHERE id = $1`, [g.id]);
    return { g, job: job! };
  }

  it("back-off is 30 s, 2 min, 10 min by attempt", () => {
    assert.deepEqual([1, 2, 3, 4, 9].map(backoffSec), [30, 120, 600, 600, 600]);
  });

  it("a failed attempt is QUEUED after its back-off; the game is FAILED and the members returned", async () => {
    const { g, job } = await claimedAnalysis();
    const rows = await env.db.query(failStatement({ jobId: job.id, me: ME, code: "engine_failed", message: "twice", attempt: job.attempts }));
    const failed = toFailedJob(rows[0]!);
    assert.equal(failed.status, "QUEUED");
    assert.deepEqual(failed.game?.members, [w.ref, b.ref]);
    const row = await jobRow(env, job.id);
    assert.equal(row.status, "QUEUED");
    assert.equal(row.lastError, "engine_failed: twice");
    assert.equal(row.lockedBy, null);
    assert.ok(Math.abs(row.runAtMs - (row.nowMs + 30_000)) < 5_000, "attempt 1 → 30 s");
    const game = await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id]);
    assert.equal(game.rows[0].s, "FAILED");
  });

  it("the 4th failed attempt is terminal (FAILED, finishedAt) and so is a `terminal` failure", async () => {
    const { job } = await claimedAnalysis(3);
    assert.equal(job.attempts, 4);
    const [r] = await env.db.query(failStatement({ jobId: job.id, me: ME, code: "internal", message: "x", attempt: 4 }));
    assert.equal(toFailedJob(r!).status, "FAILED");
    assert.ok((await jobRow(env, job.id)).finishedAtMs !== null);
    const { job: j2 } = await claimedAnalysis(0);
    const [r2] = await env.db.query(failStatement({ jobId: j2.id, me: ME, code: "internal", message: "bad payload", attempt: 1, terminal: true }));
    assert.equal(toFailedJob(r2!).status, "FAILED");
  });

  it("writes nothing when this worker no longer holds the job", async () => {
    const { job } = await claimedAnalysis();
    await env.owner.query(`UPDATE ${env.schema}.jobs SET "lockedBy" = 'someone-else1' WHERE id = $1`, [job.id]);
    assert.deepEqual(await env.db.query(failStatement({ jobId: job.id, me: ME, code: "internal", message: "x", attempt: 1 })), []);
    assert.deepEqual(await env.db.query(doneStatement(job.id, ME)), []);
    assert.deepEqual(await env.db.query(heartbeatStatement(job.id, ME)), []);
    assert.deepEqual(await env.db.query(releaseStatement(job.id, ME)), []);
    assert.equal((await jobRow(env, job.id)).status, "RUNNING");
  });

  it("release (SIGTERM) re-queues at once without counting the attempt and puts the game back to QUEUED", async () => {
    const { g, job } = await claimedAnalysis(1);
    assert.equal(job.attempts, 2);
    const [r] = await env.db.query(releaseStatement(job.id, ME));
    assert.equal(r?.gamesRequeued, 1);
    const row = await jobRow(env, job.id);
    assert.equal(row.status, "QUEUED");
    assert.equal(row.attempts, 1);
    assert.ok(row.runAtMs <= row.nowMs + 1_000);
    const game = await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id]);
    assert.equal(game.rows[0].s, "QUEUED");
  });

  it("the heartbeat refreshes heartbeatAt and returns the current priority (an A3 raise mid-run)", async () => {
    const { job } = await claimedAnalysis();
    await env.owner.query(`UPDATE ${env.schema}.jobs SET priority = 100, "heartbeatAt" = "heartbeatAt" - interval '1 minute' WHERE id = $1`, [job.id]);
    const [r] = await env.db.query(heartbeatStatement(job.id, ME));
    assert.equal(Number(r?.priority), 100);
    const row = await jobRow(env, job.id);
    assert.ok(row.heartbeatAtMs !== null && Math.abs(row.heartbeatAtMs - row.nowMs) < 5_000);
  });

  it("the lock guard commits a batch while the job is held and rolls it back when it is not", async () => {
    const { job } = await claimedAnalysis();
    const results = await env.db.batch([lockGuardStatement(job.id, ME), doneStatement(job.id, ME, { ok: true })]);
    assert.equal(results[1]?.length, 1);
    const row = await jobRow(env, job.id);
    assert.equal(row.status, "DONE");
    assert.deepEqual(row.result, { ok: true });
    assert.ok(row.finishedAtMs !== null);

    const { g, job: lost } = await claimedAnalysis();
    await env.owner.query(`UPDATE ${env.schema}.jobs SET "lockedBy" = 'someone-else1' WHERE id = $1`, [lost.id]);
    const error = await env.db
      .batch([
        lockGuardStatement(lost.id, ME),
        { text: `UPDATE games SET "analysisStatus" = 'DONE' WHERE id = $1`, values: [g.id] },
      ])
      .catch((e: unknown) => e);
    assert.ok(isLockLost(error), "SQLSTATE 22012 from the guard");
    const game = await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id]);
    assert.equal(game.rows[0].s, "RUNNING", "the batch was rolled back");
  });
});
