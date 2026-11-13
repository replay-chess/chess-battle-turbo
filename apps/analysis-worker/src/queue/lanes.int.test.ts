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
import { claimJob } from "./claim";
import { bootLockIds } from "./lanes";
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
});
