// The daily-sync backstop against a real Postgres (phase-04 plan §7.7.2, §6.3, D4-27), as role replay_worker: which
// accounts count as lost, the upsert of their `import:<id>` row, idempotence, and the HOUSEKEEPING slice around it.
// `linked_accounts` is shared with the other test files running at the same time, so every assertion looks at this
// file's own accounts and job rows only. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { ImportWorld } from "../../import/__tests__/harness";
import { nextAutoSyncAt } from "../../import/schedule";
import { silentLogger } from "../../obs/log";
import { insertJob, jobRow, run as RUN_ID, setupInt, skipInt, type IntEnv, type TestUser } from "../../testing/pg";
import { importBackstop, importBackstopStatement, releaseParkedImportsStatement } from "./import-backstop";
import { RECURRING_SLICES } from "./index";

let seq = 0;
const tag = () => `${RUN_ID.replace(/[^0-9]/g, "").slice(-6)}${String(90 + ++seq)}`;

describe("import backstop (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let w: ImportWorld;

  before(async () => {
    env = await setupInt("impbackstop");
    w = new ImportWorld(env, tag());
  });
  after(async () => {
    await w?.close();
    await env?.close();
  });

  /** A linked account with these columns (owner writes); `overdueMin` minutes past its nextAutoSyncAt. */
  async function account(
    u: TestUser,
    provider: "CHESSCOM" | "LICHESS",
    cols: { overdueMin: number; autoImport?: boolean; status?: string; importState?: string },
  ): Promise<string> {
    const la = await w.link(u, provider, `bs_${provider.toLowerCase()}_${u.id}`, { autoImport: cols.autoImport ?? true });
    await env.owner.query(
      `UPDATE linked_accounts SET "nextAutoSyncAt" = (now() AT TIME ZONE 'UTC') - ($2::int * interval '1 minute'),
              status = $3::"LinkStatus", "importState" = $4::"ImportState" WHERE id = $1`,
      [la, cols.overdueMin, cols.status ?? "ACTIVE", cols.importState ?? "IDLE"],
    );
    return la;
  }

  const importRow = async (la: string) => {
    const { rows } = await env.owner.query<{ id: string }>(`SELECT id::text AS id FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`, [`import:${la}`]);
    return rows[0] ? jobRow(env, rows[0].id) : null;
  };

  it("re-enqueues exactly the lost daily syncs, as a fresh DAILY wake due now; a second sweep changes nothing", async () => {
    const users = await Promise.all(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"].map((l) => w.member("paying", l)));
    // Lost: its DAILY row FAILED after 5 attempts (the handback case), and one whose row is gone (pruned).
    const failed = await account(users[0]!, "CHESSCOM", { overdueMin: 2 * 24 * 60 });
    const failedJob = await insertJob(env, {
      kind: "IMPORT_SYNC",
      status: "FAILED",
      priority: JOB_PRIORITY.IMPORT_SYNC_DAILY,
      payload: { v: 1, linkedAccountId: failed, runId: null, trigger: "DAILY" },
      dedupeKey: `import:${failed}`,
      attempts: 5,
      maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_SYNC,
      runAtSec: -3 * 86_400,
    });
    const missing = await account(users[1]!, "LICHESS", { overdueMin: 2 * 24 * 60 });
    // Not lost.
    const queued = await account(users[2]!, "CHESSCOM", { overdueMin: 2 * 24 * 60 });
    const queuedJob = await insertJob(env, {
      kind: "IMPORT_SYNC",
      priority: JOB_PRIORITY.IMPORT_SYNC_DAILY,
      payload: { v: 1, linkedAccountId: queued, runId: null, trigger: "DAILY" },
      dedupeKey: `import:${queued}`,
      runAtSec: 3_600,
    });
    const graceful = await account(users[3]!, "CHESSCOM", { overdueMin: 30 });
    const autoOff = await account(users[4]!, "CHESSCOM", { overdueMin: 2 * 24 * 60, autoImport: false });
    const parked = await account(users[5]!, "CHESSCOM", { overdueMin: 2 * 24 * 60, importState: "WAITING_FOR_MEMBERSHIP" });
    const broken = await account(users[6]!, "CHESSCOM", { overdueMin: 2 * 24 * 60, status: "ERROR" });
    const running = await account(users[7]!, "CHESSCOM", { overdueMin: 2 * 24 * 60 });
    const run = await w.run(users[7]!, running, "CHESSCOM", "MANUAL");
    await env.owner.query(`UPDATE import_runs SET status = 'RUNNING' WHERE id = $1`, [run.id]);

    const rows = await w.db.query(importBackstopStatement());
    assert.ok(Number(rows[0]!.requeued) >= 2, "at least this file's two lost accounts");

    const revived = await importRow(failed);
    assert.equal(revived!.id, failedJob, "the reused row, not a second one");
    for (const job of [revived!, (await importRow(missing))!]) {
      assert.equal(job.status, "QUEUED");
      assert.equal(job.kind, "IMPORT_SYNC");
      assert.equal(job.priority, JOB_PRIORITY.IMPORT_SYNC_DAILY);
      assert.equal(job.attempts, 0);
      assert.equal(job.maxAttempts, JOB_MAX_ATTEMPTS.IMPORT_SYNC);
      assert.equal(job.lockedBy, null);
      assert.equal(job.lastError, null);
      assert.ok(Math.abs(job.runAtMs - job.nowMs) < 5_000, "due now");
      assert.equal((job.payload as { trigger: string }).trigger, "DAILY");
      assert.equal((job.payload as { runId: unknown }).runId, null);
    }
    assert.equal((await importRow(missing))!.dedupeKey, `import:${missing}`);
    const q = await jobRow(env, queuedJob);
    assert.ok(q.runAtMs - q.nowMs > 3_000_000, "a live row keeps its own runAt");
    for (const la of [graceful, autoOff, parked, broken, running]) assert.equal(await importRow(la), null, `account ${la}`);

    // Idempotent: nothing of ours is touched again (a resend after a lost response is harmless).
    const before = await jobRow(env, failedJob);
    await w.db.query(importBackstopStatement());
    const again = await jobRow(env, failedJob);
    assert.deepEqual({ ...again, nowMs: 0 }, { ...before, nowMs: 0 });

    // The revived wake runs: a DAILY sync that imports what is new and reschedules the same row to its next slot.
    // (Rows the sweep made for other files' accounts are dropped first: this file must never run their imports.)
    await env.owner.query(`DELETE FROM ${env.schema}.jobs WHERE "dedupeKey" <> ALL($1)`, [[`import:${failed}`]]);
    w.upstream.addChessComFixture(`bs_chesscom_${users[0]!.id}`);
    assert.equal(await w.runNext("imp-bstop-0000aai1"), "done");
    const after = await jobRow(env, failedJob);
    assert.equal(after.status, "QUEUED");
    const slot = nextAutoSyncAt("Asia/Kolkata", new Date(w.clock.now()), new Date(w.clock.now()), BigInt(failed));
    assert.equal(after.runAtMs, slot.getTime(), "rescheduled by the shared schedule rule (§8.10)");
    const [acc] = await w.q(`SELECT "importedCount", "importState"::text AS state FROM linked_accounts WHERE id = $1`, [failed]);
    assert.equal(acc!.state, "IDLE");
    assert.ok(Number(acc!.importedCount) > 0);
  });

  it("regression: parked-import-no-backstop (FIX-1): parked runs of members are released, non-members stay parked; idempotent", async () => {
    const paying = await w.member("paying", "r1");
    const none = await w.member("none", "r2");
    const parked = async (u: TestUser, provider: "CHESSCOM" | "LICHESS") => {
      const la = await account(u, provider, { overdueMin: 0, importState: "WAITING_FOR_MEMBERSHIP" });
      const run = await w.run(u, la, provider, "INITIAL");
      await env.owner.query(`UPDATE import_runs SET status = 'WAITING_FOR_MEMBERSHIP' WHERE id = $1`, [run.id]);
      // The parked INITIAL's job ended DONE without a reschedule (import-sync.ts park).
      await insertJob(env, {
        kind: "IMPORT_SYNC",
        status: "DONE",
        priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL,
        payload: { v: 1, linkedAccountId: la, runId: run.id, trigger: "INITIAL" },
        dedupeKey: `import:${la}`,
        maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_SYNC,
        runAtSec: -600,
      });
      return { la, run: run.id };
    };
    const mine = await parked(paying, "CHESSCOM");
    const theirs = await parked(none, "LICHESS");

    const [row] = await w.db.query(releaseParkedImportsStatement(true));
    assert.ok(Number(row!.released) >= 1);
    const runStatus = async (id: string) =>
      (await env.owner.query<{ s: string }>(`SELECT status::text AS s FROM import_runs WHERE id = $1`, [id])).rows[0]!.s;
    assert.equal(await runStatus(mine.run), "QUEUED");
    assert.equal(await runStatus(theirs.run), "WAITING_FOR_MEMBERSHIP", "a non-member stays parked");
    const job = (await importRow(mine.la))!;
    assert.equal(job.status, "QUEUED");
    assert.equal(job.priority, JOB_PRIORITY.IMPORT_SYNC_INITIAL);
    assert.deepEqual(job.payload, { v: 1, linkedAccountId: mine.la, runId: mine.run, trigger: "INITIAL" });
    assert.ok(Math.abs(job.runAtMs - job.nowMs) < 5_000, "due now");
    assert.equal((await importRow(theirs.la))!.status, "DONE");
    const [acc] = await w.q(`SELECT "importState"::text AS state FROM linked_accounts WHERE id = $1`, [mine.la]);
    assert.equal(acc!.state, "QUEUED");

    // A resend after a lost response releases nothing more and leaves the queued job as it is.
    const before = await jobRow(env, job.id);
    await w.db.query(releaseParkedImportsStatement(true));
    assert.deepEqual({ ...(await jobRow(env, job.id)), nowMs: 0 }, { ...before, nowMs: 0 });
    // (BILLING_PAYWALL=off — everyone a member — is the statement's `$2 = false`; not run here: import_runs is shared
    // with the other int files, whose parked non-member runs it would release.)
    assert.equal(releaseParkedImportsStatement(false).values[1], false);
    await env.owner.query(`UPDATE import_runs SET status = 'CANCELLED' WHERE id = $1`, [theirs.run]);
    await env.owner.query(`DELETE FROM ${env.schema}.jobs WHERE "dedupeKey" = ANY($1)`, [[`import:${mine.la}`, `import:${theirs.la}`]]);
  });

  it("rides in the daily HOUSEKEEPING batch as a statements() slice, before the plan", async () => {
    const ids = RECURRING_SLICES.map((s) => s.id);
    assert.ok(ids.includes("import-backstop"));
    assert.ok(ids.indexOf("import-backstop") < ids.indexOf("housekeeping-plan"));
    assert.equal(importBackstop.run, undefined, "no work of its own outside the batch");
    assert.equal(importBackstop.plan, undefined, "no timer of its own");
    const ctx = {
      db: w.db,
      clock: w.clock,
      log: silentLogger,
      metrics: w.metrics,
      signal: new AbortController().signal,
      now: new Date(),
      evalCache: null,
      evalCacheMaxBytes: 0,
    };
    const statements = importBackstop.statements!(ctx);
    assert.equal(statements.length, 2, "the daily-sync backstop and the parked-import release (FIX-1)");
    const out = await w.db.batch(statements);
    await importBackstop.after!(ctx, out);
  });
});
