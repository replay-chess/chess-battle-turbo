// Lost responses against a real Postgres (FIX-1; plan P3-D11 "retry once", §8.12 claim, failure, final batch). The
// server commits a statement and the HTTP response is lost (`fetch failed` / ECONNRESET), so CountingDb retries it.
// Each case proves the retry leaves the queue consistent and the worker still reports what happened:
//   - a claim: the retry adopts the row the lost claim took, never claims a second one;
//   - a fail write: the retry returns the job it already failed, so `analysis:failed` still goes out;
//   - a final batch (skip/finish): the retry's lock guard fails, but the job is DONE by this worker, so it is done;
//   - an orphan this boot holds is requeued by the reaper at the end of the drain, not 3 minutes later.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { CountingDb, pgDriver, type Driver, type Row, type Statement } from "../db/client";
import { SqlAnalysisStore } from "../pipeline/sql-store";
import { queueSummaryStatement } from "../scheduler/scheduler";
import { insertJob, jobRow, makeGame, makeUser, setupInt, skipInt, type IntEnv } from "../testing/pg";
import { claimJob } from "./claim";
import { failStatement, ORPHAN_STALE_SEC, reapStatement, toFailedJob } from "./outcome";
import { handleReaped } from "./reaper";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { RecordingEmitter } from "../socket/emit";

const WORKER = "dev-worker";
const ME = "dev-worker-abcd1234";

/** A driver that runs the statements, commits, and then loses the response of the first call `match` accepts. */
function losesOneResponse(url: string, match: (ss: readonly Statement[]) => boolean): Driver & { lost: boolean } {
  const inner = pgDriver(url);
  const d = {
    lost: false,
    async run(ss: readonly Statement[], tx: boolean): Promise<Row[][]> {
      const out = await inner.run(ss, tx);
      if (!d.lost && match(ss)) {
        d.lost = true;
        throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
      }
      return out;
    },
    close: () => inner.close(),
  };
  return d;
}

describe("lost responses (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;

  before(async () => {
    env = await setupInt("lostresp");
  });
  after(async () => {
    await env?.close();
  });
  beforeEach(async () => {
    await env.owner.query(`DELETE FROM ${env.schema}.jobs`);
  });

  // regression: lost-claim-response (FIX-1)
  it("a claim whose response is lost adopts the row it took instead of claiming a second one", async () => {
    const a = await insertJob(env, { priority: 80, runAtSec: -60 });
    const b = await insertJob(env, { priority: 80, runAtSec: -30 });
    const driver = losesOneResponse(env.workerUrl, (ss) => ss[0]!.text.includes("SET status = 'RUNNING'"));
    const db = new CountingDb(driver);
    try {
      const job = await claimJob(db, ME, ["ANALYZE_GAME"], 1);
      assert.ok(driver.lost);
      assert.equal(db.counters.retries, 1);
      assert.equal(job?.id, a, "the runner gets the row the lost claim took");
      assert.equal(job?.attempts, 1, "adopting counts no second attempt");
      const ra = await jobRow(env, a);
      const rb = await jobRow(env, b);
      assert.equal(ra.status, "RUNNING");
      assert.equal(ra.lockedBy, ME);
      assert.equal(rb.status, "QUEUED", "no second row was claimed");
      assert.equal(rb.attempts, 0);
      // The next claim (no lost response) takes b as usual.
      assert.equal((await claimJob(db, ME, ["ANALYZE_GAME"], 1))?.id, b);
    } finally {
      await db.close();
    }
  });

  it("a claim lost before it committed claims normally on the retry", async () => {
    const a = await insertJob(env, { priority: 80, runAtSec: -60 });
    const inner = pgDriver(env.workerUrl);
    let failed = false;
    const db = new CountingDb({
      async run(ss, tx) {
        if (!failed) {
          failed = true;
          throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
        }
        return inner.run(ss, tx);
      },
      close: () => inner.close(),
    });
    try {
      const job = await claimJob(db, ME, ["ANALYZE_GAME"], 1);
      assert.equal(job?.id, a);
      assert.equal(job?.attempts, 1);
    } finally {
      await db.close();
    }
  });

  // regression: lost-fail-response (FIX-1)
  it("a fail write whose response is lost still returns the failed job (so analysis:failed goes out)", async () => {
    const w = await makeUser(env.owner, "lr_w");
    const bl = await makeUser(env.owner, "lr_b");
    const g = await makeGame(env.owner, w, bl, { analysisStatus: "RUNNING" });
    const id = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: 0, attempts: 1, gameId: g.id });
    const driver = losesOneResponse(env.workerUrl, (ss) => ss[0]!.text.includes("WITH j AS"));
    const db = new CountingDb(driver);
    try {
      const rows = await db.query(
        failStatement({ jobId: id, me: ME, code: "engine_failed", message: "the engine stopped", attempt: 1 }),
      );
      assert.ok(driver.lost);
      assert.equal(rows.length, 1, "the retry recognises the attempt it already failed");
      const failed = toFailedJob(rows[0]!);
      assert.equal(failed.status, "QUEUED");
      assert.equal(failed.game?.ref, g.ref);
      assert.deepEqual([...(failed.game?.members ?? [])].sort(), [w.ref, bl.ref].sort());
      const row = await jobRow(env, id);
      assert.equal(row.status, "QUEUED");
      assert.equal(row.lockedBy, null);
      assert.equal(row.attempts, 1);
    } finally {
      await db.close();
    }
  });

  // regression: rate-limit-uses-attempts (FIX-2): a paused (refunded) attempt's lost response is recognised too.
  it("a pause (refundAttempt) gives the attempt back, and its lost response is still recognised", async () => {
    const id = await insertJob(env, { kind: "IMPORT_SYNC", status: "RUNNING", lockedBy: ME, heartbeatSec: 0, attempts: 5 });
    const driver = losesOneResponse(env.workerUrl, (ss) => ss[0]!.text.includes("WITH j AS"));
    const db = new CountingDb(driver);
    try {
      const rows = await db.query(
        failStatement({ jobId: id, me: ME, code: "rate_limited", message: "429 (paused until 2026-11-13T10:15:00.000Z)", attempt: 5, kind: "IMPORT_SYNC", delaySec: 900, refundAttempt: true }),
      );
      assert.ok(driver.lost);
      assert.equal(rows.length, 1, "the retry recognises the pause it already wrote");
      const row = await jobRow(env, id);
      assert.equal(row.status, "QUEUED", "attempts 5 of maxAttempts 4: a fail would be terminal, a pause never is");
      assert.equal(row.attempts, 4);
      assert.ok(Math.abs(row.runAtMs - row.nowMs - 900_000) < 2_000);
    } finally {
      await db.close();
    }
  });

  it("the fail write's retry form never touches a job another worker holds now", async () => {
    const id = await insertJob(env, { status: "RUNNING", lockedBy: "dev-worker-2-00000000", heartbeatSec: 0, attempts: 1 });
    const retry = failStatement({ jobId: id, me: ME, code: "internal", message: "x", attempt: 1 }).retry;
    assert.ok(retry && retry !== "never");
    assert.deepEqual(await env.db.query(retry), []);
    assert.equal((await jobRow(env, id)).status, "RUNNING");
  });

  // regression: lost-final-response (FIX-1)
  it("a final batch whose response is lost is done, not lost", async () => {
    const w = await makeUser(env.owner, "lf_w");
    const bl = await makeUser(env.owner, "lf_b");
    const g = await makeGame(env.owner, w, bl, { analysisStatus: "RUNNING", plyCount: 4 });
    const id = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: 0, gameId: g.id });
    const driver = losesOneResponse(env.workerUrl, (ss) => ss.length > 1);
    const db = new CountingDb(driver);
    try {
      await new SqlAnalysisStore(db).skip({ jobId: id, me: ME, gameId: g.id, reason: "too_short" });
      assert.ok(driver.lost);
      assert.equal((await jobRow(env, id)).status, "DONE");
      const st = await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id]);
      assert.equal(st.rows[0].s, "SKIPPED");
    } finally {
      await db.close();
    }
  });

  it("a final batch that finds the job reaped by someone else still reports the lost lock", async () => {
    const w = await makeUser(env.owner, "ll_w");
    const bl = await makeUser(env.owner, "ll_b");
    const g = await makeGame(env.owner, w, bl, { analysisStatus: "RUNNING", plyCount: 4 });
    const id = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: 0, gameId: g.id });
    // The first attempt fails before it reaches the server; meanwhile the reaper requeued the job.
    const inner = pgDriver(env.workerUrl);
    let failed = false;
    const db = new CountingDb({
      async run(ss, tx) {
        if (!failed) {
          failed = true;
          await env.owner.query(
            `UPDATE ${env.schema}.jobs SET status = 'QUEUED', "lockedBy" = NULL WHERE id = $1`,
            [id],
          );
          throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
        }
        return inner.run(ss, tx);
      },
      close: () => inner.close(),
    });
    try {
      await assert.rejects(
        new SqlAnalysisStore(db).skip({ jobId: id, me: ME, gameId: g.id, reason: "too_short" }),
        (e: unknown) => (e as { code?: string }).code === "22012",
      );
      assert.equal((await jobRow(env, id)).status, "QUEUED");
    } finally {
      await db.close();
    }
  });

  // regression: drain-end-own-orphan (FIX-1)
  it("the drain-end reaper requeues a row this boot still holds, and the summary then wakes the worker", async () => {
    const orphan = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: -1, attempts: 1 });
    const [bootReap] = await env.db.batch([reapStatement({ workerId: WORKER, me: ME })]);
    assert.equal(bootReap!.length, 0, "at boot (or mid-drain) a row of this boot is not an orphan");
    const [reaped, summary] = await env.db.batch([
      reapStatement({ workerId: WORKER, me: ME, drainEnd: true }),
      queueSummaryStatement(["ANALYZE_GAME"], 1),
    ]);
    assert.deepEqual(
      reaped!.map((r) => String(r.id)),
      [orphan],
    );
    const row = await jobRow(env, orphan);
    assert.equal(row.status, "QUEUED");
    assert.equal(row.lockedBy, null);
    assert.ok(summary![0]!.nextRunAtMs !== null, "the requeued row sets the next wake");
  });

  // regression: adopt-stranded-row (FIX-2, review round 2). A job whose fail write failed on both attempts stays
  // RUNNING under this boot until the drain-end reaper; the next claim's retry form adopted it (the failed attempt run
  // again at once, uncounted, no back-off) while the due row waited.
  it("the claim's retry form never adopts a row this boot was already handed", async () => {
    const stranded = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: -1, attempts: 1 });
    const due = await insertJob(env, { priority: 80, runAtSec: -30 });
    // The first attempt fails before it reaches the server, so the client sends the retry form (adopt or claim).
    const inner = pgDriver(env.workerUrl);
    let failedOnce = false;
    const db = new CountingDb({
      async run(ss: readonly Statement[], tx: boolean): Promise<Row[][]> {
        if (!failedOnce) {
          failedOnce = true;
          throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
        }
        return inner.run(ss, tx);
      },
      close: () => inner.close(),
    });
    try {
      const job = await claimJob(db, ME, ["ANALYZE_GAME"], 1, [stranded]);
      assert.equal(db.counters.retries, 1, "the retry form ran");
      assert.equal(job?.id, due, "the due row is claimed");
      assert.equal(job?.attempts, 1);
      const s = await jobRow(env, stranded);
      assert.equal(s.status, "RUNNING", "the stranded row waits for the drain-end reaper");
      assert.equal(s.attempts, 1, "and is not run again uncounted");
    } finally {
      await db.close();
    }
  });

  // regression: lost-reap-response (FIX-2, review round 2). The reap had no retry form: sent again unchanged it found
  // nothing left to reap, so the game was FAILED in the database but analysis:failed never went out.
  it("a reap whose response is lost still returns what it reaped, so analysis:failed goes out", async () => {
    const w = await makeUser(env.owner, "lr_w");
    const b = await makeUser(env.owner, "lr_b");
    const g = await makeGame(env.owner, w, b, { plyCount: 30 });
    const id = await insertJob(env, {
      status: "RUNNING",
      lockedBy: `${WORKER}-0ld0b007`,
      heartbeatSec: -(ORPHAN_STALE_SEC + 5),
      attempts: 1,
      gameId: g.id,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
    const driver = losesOneResponse(env.workerUrl, (ss) => ss[0]!.text.includes(`"lockedBy" LIKE $1 ESCAPE`));
    const db = new CountingDb(driver);
    try {
      const [reaped] = await db.batch([reapStatement({ workerId: WORKER, me: ME, drainEnd: true })]);
      assert.ok(driver.lost);
      assert.equal(db.counters.retries, 1);
      assert.deepEqual(
        reaped!.map((r) => String(r.id)),
        [id],
      );
      const emitter = new RecordingEmitter();
      const metrics = new Metrics({ workerId: ME, bootId: "abcd1234", version: "0", profile: "sf18-v1" }, 0);
      await handleReaped(reaped!, { emitter, log: silentLogger, metrics });
      assert.deepEqual(
        emitter.sent.map((e) => [e.event, e.userRefs]),
        [["analysis:failed", [w.ref, b.ref]]],
      );
      const row = await jobRow(env, id);
      assert.equal(row.status, "QUEUED");
      assert.equal(row.attempts, 1, "the retry counted nothing more");
      // Another reap (a later drain) finds nothing: the token in lastError belongs to the first call only.
      assert.equal((await db.query(reapStatement({ workerId: WORKER, me: ME, drainEnd: true }))).length, 0);
    } finally {
      await db.close();
    }
  });
});
