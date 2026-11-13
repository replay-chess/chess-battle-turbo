// The whole worker core against a real Postgres (phase-03 plan §8.12, tasks C2–C4): boot in APP_ENV=test with
// ENGINE=fake, the boot batch (an earlier boot's orphan reaped, DAILY_PLAN's HOUSEKEEPING row, inserted once across
// boots), a signed kick draining a due HOUSEKEEPING job to DONE (tomorrow planned), /ready, /health, signed metrics,
// and a clean shutdown. Runs as replay_worker when TEST_WORKER_DATABASE_URL is set. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { bootWorker, type RunningWorker } from "./boot";
import { loadEnv, type WorkerEnv } from "./config/env";
import { silentLogger } from "./obs/log";
import { HOUSEKEEPING_HOUR_UTC } from "./scheduler/recurring/housekeeping-plan";
import { ORPHAN_STALE_SEC } from "./queue/outcome";
import { insertJob, jobRow, makeUser, setupInt, skipInt, type IntEnv } from "./testing/pg";

const k = () => randomBytes(32).toString("base64");

describe("worker boot (Postgres, ENGINE=fake)", { skip: skipInt }, () => {
  let env: IntEnv;
  let workerEnv: WorkerEnv;
  const ring = `wk:${k()},webwk:${k()},ws:${k()}`;
  const web = parseKeyRing(ring);

  before(async () => {
    env = await setupInt("boot");
    workerEnv = loadEnv({
      APP_ENV: "test",
      // A P3 test: no import work (the boot backstop would sweep other int files' linked accounts, FIX-1).
      IMPORT_PAUSED: "on",
      WORKER_DATABASE_URL: env.workerUrl,
      INTERNAL_API_SECRET: ring,
      ENGINE: "fake",
      WORKER_ID: "int-worker",
      PORT: "0",
      EVAL_CACHE_PATH: join(mkdtempSync(join(tmpdir(), "wk-boot-")), "evals.sqlite"),
    });
  });
  after(async () => {
    await env?.close();
  });

  const hkRows = async () =>
    (await env.owner.query(`SELECT "dedupeKey", status::text AS status FROM ${env.schema}.jobs WHERE kind = 'HOUSEKEEPING' ORDER BY "runAt"`)).rows as {
      dedupeKey: string;
      status: string;
    }[];

  async function until(check: () => Promise<boolean>, ms = 10_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out");
  }

  it("boots, reaps an earlier boot's orphan, plans HOUSEKEEPING, drains on a signed kick, and shuts down", async () => {
    const orphan = await insertJob(env, {
      kind: "HOUSEKEEPING",
      status: "RUNNING",
      lockedBy: "int-worker-deadbeef",
      // Its heartbeat stopped longer ago than ORPHAN_STALE_SEC (a crashed boot; a fresher one could be a live worker).
      heartbeatSec: -(ORPHAN_STALE_SEC + 5),
      runAtSec: -60,
      payload: { v: 1, day: "2026-01-02" },
      dedupeKey: "housekeeping:2026-01-02",
      maxAttempts: 2,
      attempts: 1,
    });
    let worker: RunningWorker | null = await bootWorker(workerEnv, { log: silentLogger });
    try {
      const base = `http://127.0.0.1:${worker.port}`;
      const reaped = await jobRow(env, orphan);
      assert.equal(reaped.status, "QUEUED", "the earlier boot's orphan was reaped at boot");
      assert.match(reaped.lastError ?? "", /^worker_stalled/);

      const now = new Date();
      const today21 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), HOUSEKEEPING_HOUR_UTC);
      const next = new Date(today21 > now.getTime() ? today21 : today21 + 86_400_000).toISOString().slice(0, 10);
      assert.ok((await hkRows()).some((r) => r.dedupeKey === `housekeeping:${next}` && r.status === "QUEUED"), "DAILY_PLAN at boot");

      assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
      // The boot drain runs right after bootWorker() returns (claim, the drain-end hook, reap + summary): wait for it.
      await until(async () => ((await (await fetch(`${base}/ready`)).json()) as { draining: boolean }).draining === false);
      const ready = await fetch(`${base}/ready`);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { ready: true, engine: "fake", evalCache: "open", draining: false });

      // A due HOUSEKEEPING row (the web or the cron would kick after enqueueing).
      const due = await insertJob(env, { kind: "HOUSEKEEPING", priority: 0, payload: { v: 1, day: "2026-01-01" }, dedupeKey: "housekeeping:2026-01-01", maxAttempts: 2 });
      const body = JSON.stringify({ v: 1, reason: "test" });
      const res = await fetch(`${base}/internal/analysis/kick`, {
        method: "POST",
        headers: { ...signInternal({ keys: web, kid: "webwk", method: "POST", path: "/internal/analysis/kick", body, nowMs: Date.now() }), "content-type": "application/json" },
        body,
      });
      assert.equal(res.status, 202);
      await until(async () => (await jobRow(env, due)).status === "DONE");
      const done = await jobRow(env, due);
      assert.equal(done.lockedBy, worker.me);
      // One 21:00 in the next 26 h, two when the run starts between 19:00 and 21:00 UTC.
      const result = done.result as { day: string; planned: number };
      assert.equal(result.day, "2026-01-01");
      assert.ok(result.planned === 1 || result.planned === 2, `planned ${result.planned}`);

      const metrics = await fetch(`${base}/internal/metrics`, {
        headers: signInternal({ keys: web, kid: "webwk", method: "GET", path: "/internal/metrics", body: "", nowMs: Date.now() }),
      });
      assert.equal(metrics.status, 200);
      const m = (await metrics.json()) as { jobs: { done: Record<string, number> }; lastHousekeepingAt: string | null; workerId: string };
      assert.equal(m.jobs.done.HOUSEKEEPING, 1);
      assert.ok(m.lastHousekeepingAt);
      assert.equal(m.workerId, worker.me);

      await worker.shutdown();
      await assert.rejects(fetch(`${base}/health`), "the port is closed");
      worker = null;

      // A second boot plans the same day again without a duplicate.
      const before = (await hkRows()).length;
      worker = await bootWorker(workerEnv, { log: silentLogger });
      assert.equal((await hkRows()).length, before);
    } finally {
      await worker?.shutdown();
    }
  });
  it("regression: p3-boot-no-import-sweep (FIX-1): a worker booted with IMPORT_PAUSED enqueues no import work for overdue accounts", async () => {
    // An overdue auto-import account in the shared public schema, as another int file would leave one.
    const u = await makeUser(env.owner, "bootsweep");
    const { rows } = await env.owner.query<{ id: string }>(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "autoImport", "nextAutoSyncAt", "updatedAt")
       VALUES ($1, 'LICHESS', $2, $2, $2, true, (now() AT TIME ZONE 'UTC') - interval '3 days', now()) RETURNING id::text AS id`,
      [u.id, `bootsweep_${u.id}`],
    );
    const la = rows[0]!.id;
    const ours = `SELECT 1 FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`;
    try {
      const worker = await bootWorker(workerEnv, { log: silentLogger });
      await worker.shutdown();
      // (An earlier test's HOUSEKEEPING may have swept other accounts into this schema's queue: inert, the paused worker
      // has no I/O lane. This account was created after it, so only the boot could have queued it.)
      const jobs = await env.owner.query(ours, [`import:${la}`]);
      assert.equal(jobs.rowCount, 0, "no IMPORT_SYNC row: the boot backstop does not run while imports are paused");
      const runs = await env.owner.query(`SELECT 1 FROM import_runs WHERE "linkedAccountId" = $1`, [la]);
      assert.equal(runs.rowCount, 0, "nothing imported");
    } finally {
      await env.owner.query(`UPDATE linked_accounts SET "autoImport" = false WHERE id = $1`, [la]);
    }
  });
});
