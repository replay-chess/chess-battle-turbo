// The claim against a real Postgres (phase-03 plan §8.12 "Claim", §12.1, task C2): order (priority DESC, fairSeq,
// runAt), due rows only, the kinds filter, the payload version filter (rollback safety), the row it returns, and two
// workers claiming side by side never taking the same row (FOR UPDATE SKIP LOCKED). Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { CountingDb, pgDriver } from "../db/client";
import { insertJob, jobRow, setupInt, skipInt, type IntEnv } from "../testing/pg";
import { claimJob } from "./claim";

describe("claim (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;

  before(async () => {
    env = await setupInt("claim");
  });
  after(async () => {
    await env?.close();
  });
  beforeEach(async () => {
    await env.owner.query(`DELETE FROM ${env.schema}.jobs`);
  });

  it("returns null on an empty queue", async () => {
    assert.equal(await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME"], 1), null);
  });

  it("claims by priority DESC, then fairSeq, then runAt", async () => {
    const lowOld = await insertJob(env, { priority: 10, runAtSec: -600 });
    const hiLate = await insertJob(env, { priority: 100, runAtSec: -1 });
    const hiEarly = await insertJob(env, { priority: 100, runAtSec: -60 });
    const hiFair1 = await insertJob(env, { priority: 100, fairSeq: 1, runAtSec: -3600 });
    const mid = await insertJob(env, { priority: 80, runAtSec: -3600 });
    const order: string[] = [];
    for (;;) {
      const job = await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME"], 1);
      if (!job) break;
      order.push(job.id);
    }
    assert.deepEqual(order, [hiEarly, hiLate, hiFair1, mid, lowOld]);
  });

  it("marks the row RUNNING under the claimer and returns what the runner needs", async () => {
    const id = await insertJob(env, { priority: 80, attempts: 1, maxAttempts: 4, gameId: "42", payload: { v: 1, x: 1 } });
    const job = await claimJob(env.db, "wk-a-12345678", ["ANALYZE_GAME"], 1);
    assert.ok(job);
    assert.equal(job.id, id);
    assert.equal(job.kind, "ANALYZE_GAME");
    assert.equal(job.attempts, 2, "the claim counts the attempt");
    assert.equal(job.maxAttempts, 4);
    assert.equal(job.priority, 80);
    assert.equal(job.gameId, "42");
    assert.deepEqual(job.payload, { v: 1, x: 1 });
    const row = await jobRow(env, id);
    assert.equal(row.status, "RUNNING");
    assert.equal(row.lockedBy, "wk-a-12345678");
    assert.ok(row.heartbeatAtMs !== null && Math.abs(row.heartbeatAtMs - row.nowMs) < 5_000);
    assert.ok(Math.abs(job.claimedAtMs - row.nowMs) < 5_000);
  });

  it("never claims a row that is not due, not QUEUED, or of another kind", async () => {
    await insertJob(env, { runAtSec: 300 });
    await insertJob(env, { status: "RUNNING", lockedBy: "other-00000000", heartbeatSec: 0 });
    await insertJob(env, { status: "DONE" });
    await insertJob(env, { status: "FAILED" });
    await insertJob(env, { kind: "IMPORT_SYNC", payload: { v: 1 } });
    assert.equal(await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME", "HOUSEKEEPING"], 1), null);
    const hk = await insertJob(env, { kind: "HOUSEKEEPING", priority: 0, payload: { v: 1, day: "2026-11-11" } });
    assert.equal((await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME", "HOUSEKEEPING"], 1))?.id, hk);
  });

  it("leaves a payload of a newer version for the newer build; a non-numeric v counts as 1", async () => {
    await insertJob(env, { priority: 100, payload: { v: 2, gameId: "1" } });
    const odd = await insertJob(env, { priority: 10, payload: { v: "x" } });
    const job = await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME"], 1);
    assert.equal(job?.id, odd, "v=2 skipped; v='x' claimed (and failed as invalid by the runner)");
    assert.equal(await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME"], 1), null);
    assert.ok(await claimJob(env.db, "wk-a-00000000", ["ANALYZE_GAME"], 2), "a v2 build takes it");
  });

  it("two workers claiming side by side never take the same row", async () => {
    const total = 120;
    for (let i = 0; i < total; i++) await insertJob(env, { priority: [10, 80, 100][i % 3]!, fairSeq: i % 7 });
    const second = new CountingDb(pgDriver(env.workerUrl));
    const claimed = new Map<string, string>();
    const worker = async (db: CountingDb, me: string) => {
      for (;;) {
        const job = await claimJob(db, me, ["ANALYZE_GAME"], 1);
        if (!job) return;
        assert.equal(claimed.has(job.id), false, `job ${job.id} claimed twice`);
        claimed.set(job.id, me);
      }
    };
    try {
      await Promise.all([
        worker(env.db, "wk-a-00000001"),
        worker(second, "wk-b-00000002"),
        worker(env.db, "wk-a-00000001"),
        worker(second, "wk-b-00000002"),
      ]);
    } finally {
      await second.close();
    }
    assert.equal(claimed.size, total);
    const { rows } = await env.owner.query(
      `SELECT "lockedBy", count(*)::int AS n FROM ${env.schema}.jobs WHERE status = 'RUNNING' GROUP BY "lockedBy"`,
    );
    const byWorker = Object.fromEntries(rows.map((r: { lockedBy: string; n: number }) => [r.lockedBy, r.n]));
    assert.equal((byWorker["wk-a-00000001"] ?? 0) + (byWorker["wk-b-00000002"] ?? 0), total);
    assert.ok((byWorker["wk-a-00000001"] ?? 0) > 0 && (byWorker["wk-b-00000002"] ?? 0) > 0, "both workers took a share");
    for (const [id, me] of claimed) assert.equal((await jobRow(env, id)).lockedBy, me);
  });
});
