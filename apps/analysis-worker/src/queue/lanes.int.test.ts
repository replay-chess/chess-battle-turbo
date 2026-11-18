// The I/O lane's lock identity against a real Postgres (interface check §0.6; phase-04 plan §7.7.1). P3's claim retry
// form adopts "a RUNNING row locked by me": with one shared `lockedBy`, a slot whose claim response was lost would
// adopt the OTHER slot's running import. Regression: two lanes, one lost claim response, nobody adopts the other's
// row. Also: the reaper never takes a live sibling slot of its own boot as an orphan, and a lost reschedule response
// is recognised by its retry form. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { CountingDb, pgDriver, type Driver, type Row, type Statement } from "../db/client";
import { insertJob, jobRow, setupInt, skipInt, type IntEnv } from "../testing/pg";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { realClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { claimJob, type ClaimedJob } from "./claim";
import { bootLockIds, IO_KINDS, IoLane } from "./lanes";
import { ORPHAN_STALE_SEC, outcomeByMeStatement, reapStatement, rescheduleStatement, rescheduleToken } from "./outcome";

const WORKER = "dev-worker";
const [ME, SLOT1, SLOT2] = bootLockIds("dev-worker-abcd1234") as [string, string, string];

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

const importJob = (env: IntEnv, runAtSec: number, la: number) =>
  insertJob(env, {
    kind: "IMPORT_SYNC",
    priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL,
    runAtSec,
    payload: { v: 1, linkedAccountId: String(la), runId: null, trigger: "DAILY" },
    dedupeKey: `import:${la}`,
    maxAttempts: 5,
  });

describe("I/O lane lock identity (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;

  before(async () => {
    env = await setupInt("lanes");
  });
  after(async () => {
    await env?.close();
  });
  beforeEach(async () => {
    await env.owner.query(`DELETE FROM ${env.schema}.jobs`);
  });

  // regression: lane-adopts-sibling (interface check §0.6)
  it("two lanes, one lost claim response: the slot adopts its own row, never the other slot's", async () => {
    const a = await importJob(env, -60, 1);
    const b = await importJob(env, -30, 2);
    // Slot 2 claims first and is running its import.
    const running = await claimJob(env.db, SLOT2, ["IMPORT_SYNC"], 1);
    assert.equal(running?.id, a);
    // Slot 1's claim commits (it takes b) and its response is lost: the retry form must adopt b, not slot 2's a.
    const driver = losesOneResponse(env.workerUrl, (ss) => ss[0]!.text.includes("SET status = 'RUNNING'"));
    const db = new CountingDb(driver);
    try {
      const job = await claimJob(db, SLOT1, ["IMPORT_SYNC"], 1);
      assert.ok(driver.lost);
      assert.equal(job?.id, b, "slot 1 got the row its lost claim took");
      assert.equal((await jobRow(env, a)).lockedBy, SLOT2, "slot 2's import is untouched");
      assert.equal((await jobRow(env, b)).lockedBy, SLOT1);
      assert.equal((await jobRow(env, b)).attempts, 1, "adopting counts no second attempt");
    } finally {
      await db.close();
    }
  });

  it("the reaper leaves a live sibling slot of its own boot alone (alsoMine); another boot's orphan is reaped", async () => {
    // A slot that has not beaten for 60 s (a long CPU-bound mapping) is a sibling, not an orphan; only the 3-minute
    // stale rule may take it.
    const sibling = await insertJob(env, { kind: "IMPORT_SYNC", status: "RUNNING", lockedBy: SLOT1, heartbeatSec: -(ORPHAN_STALE_SEC + 15), attempts: 1, maxAttempts: 5 });
    const orphan = await insertJob(env, { kind: "IMPORT_SYNC", status: "RUNNING", lockedBy: "dev-worker-0badbo0t", heartbeatSec: -(ORPHAN_STALE_SEC + 15), attempts: 1, maxAttempts: 5 });
    const rows = await env.db.query(reapStatement({ workerId: WORKER, me: ME, drainEnd: true, alsoMine: [SLOT1, SLOT2] }));
    assert.deepEqual(rows.map((r) => r.id).sort(), [orphan]);
    assert.equal((await jobRow(env, sibling)).status, "RUNNING");
    // Without alsoMine (P3's single-lane worker), the same row would have been taken.
    const p3 = await env.db.query(reapStatement({ workerId: WORKER, me: ME, drainEnd: true }));
    assert.deepEqual(p3.map((r) => r.id), [sibling]);
  });

  it("a reschedule whose response is lost is recognised by its retry form and by outcomeByMe", async () => {
    const id = await insertJob(env, { kind: "IMPORT_SYNC", status: "RUNNING", lockedBy: SLOT1, heartbeatSec: 0, attempts: 2, maxAttempts: 5 });
    const token = rescheduleToken(SLOT1, id, 2);
    const runAt = new Date(Date.now() + 6 * 3_600_000);
    runAt.setUTCMinutes(5, 0, 0);
    const payload = { v: 1, linkedAccountId: "9", runId: null, trigger: "DAILY" };
    const driver = losesOneResponse(env.workerUrl, (ss) => ss[0]!.text.includes("rescheduledBy") || ss[0]!.text.includes("result = $6"));
    const db = new CountingDb(driver);
    try {
      const rows = await db.query(rescheduleStatement({ jobId: id, me: SLOT1, runAt, priority: JOB_PRIORITY.IMPORT_SYNC_DAILY, payload, token }));
      assert.ok(driver.lost);
      assert.equal(rows.length, 1, "the retry form returns the row this write rescheduled");
      assert.equal(Number(rows[0]!.runAtMs), runAt.getTime());
    } finally {
      await db.close();
    }
    const row = await jobRow(env, id);
    assert.equal(row.status, "QUEUED");
    assert.equal(row.attempts, 0, "a fresh job for the next wake");
    assert.equal(row.lockedBy, null);
    assert.equal(row.priority, JOB_PRIORITY.IMPORT_SYNC_DAILY);
    assert.deepEqual(row.payload, payload);
    assert.equal(row.runAtMs, runAt.getTime());
    assert.equal((await env.db.query(outcomeByMeStatement({ jobId: id, me: SLOT1, token }))).length, 1);
    assert.equal((await env.db.query(outcomeByMeStatement({ jobId: id, me: SLOT2, token: rescheduleToken(SLOT2, id, 2) }))).length, 0);
    // The retry form never touches a row another worker holds.
    const held = await insertJob(env, { kind: "IMPORT_SYNC", status: "RUNNING", lockedBy: SLOT2, heartbeatSec: 0, attempts: 1 });
    const retry = rescheduleStatement({ jobId: held, me: SLOT1, runAt, priority: JOB_PRIORITY.IMPORT_SYNC_DAILY, payload, token: "x" }).retry;
    assert.ok(retry && retry !== "never");
    assert.deepEqual(await env.db.query(retry), []);
  });

  // regression: io-lane-weakness-fills-both-slots (plan §12.6 "an IMPORT_SYNC waits behind at most one weakness job").
  it("two slots, two due weakness jobs and an import: the import starts while the first weakness job runs", async () => {
    const weak = async (n: number, runAtSec: number) =>
      insertJob(env, {
        kind: "RECOMPUTE_WEAKNESS",
        priority: JOB_PRIORITY.WEAKNESS,
        runAtSec,
        payload: { v: 1, trigger: "weekly" },
        dedupeKey: `weakness:lane${n}`,
        maxAttempts: 3,
      });
    const w1 = await weak(1, -120);
    const w2 = await weak(2, -110);
    const imp = await importJob(env, -10, 7);
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const clock = realClock();
    const lane = new IoLane({
      db: env.db,
      clock,
      log: silentLogger,
      metrics: new Metrics({ workerId: WORKER, bootId: "abcd1234", version: "0", profile: "sf18-v1" }, clock.now()),
      emitter: new RecordingEmitter(),
      me: ME,
      workerId: WORKER,
      kinds: IO_KINDS,
      payloadVMax: 1,
      // A weakness job holds its slot until released (a long heal); an import finishes at once.
      runJob: (job: ClaimedJob, slotMe: string) =>
        new Promise<void>((resolve) => {
          started.push(job.kind);
          const done = async () => {
            await env.owner.query(`UPDATE ${env.schema}.jobs SET status = 'DONE', "finishedAt" = (now() AT TIME ZONE 'UTC') WHERE id = $1 AND "lockedBy" = $2`, [job.id, slotMe]);
            resolve();
          };
          if (job.kind === "RECOMPUTE_WEAKNESS") finish.set(job.id, () => void done());
          else void done();
        }),
    });
    const until = async (check: () => boolean | Promise<boolean>, ms = 10_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`timed out; started ${started.join(",")}`);
    };
    try {
      lane.start();
      await until(async () => (await jobRow(env, imp)).status === "DONE");
      assert.deepEqual([...started].sort(), ["IMPORT_SYNC", "RECOMPUTE_WEAKNESS"], "the import ran while one weakness job held a slot");
      assert.equal((await jobRow(env, w2)).status, "QUEUED", "the second weakness job waits for the first, not the import");
      finish.get(w1)!();
      await until(() => finish.has(w2));
      assert.deepEqual([...started].sort(), ["IMPORT_SYNC", "RECOMPUTE_WEAKNESS", "RECOMPUTE_WEAKNESS"]);
      finish.get(w2)!();
      await until(async () => (await jobRow(env, w2)).status === "DONE");
    } finally {
      for (const f of finish.values()) f();
      await lane.stop(2_000);
    }
  });
});
