// The reaper against a real Postgres (phase-03 plan §8.12, §12.1 `reaper`, owner test T11): an orphan of an earlier
// boot (by `lockedBy` prefix), a stale heartbeat (> 3 min), a fresh job untouched, another worker's job untouched,
// FAILED once the attempts are used up; the reaped analysis's game is FAILED, its failedAtPly recorded, both members'
// gamesVersion bumped once, and the members returned for `analysis:failed`. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { RecordingEmitter } from "../socket/emit";
import { insertJob, jobRow, makeGame, makeUser, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { freshSiblingsStatement, ORPHAN_STALE_SEC, orphanPattern, reapStatement, REAP_RETRY_SEC } from "./outcome";
import { handleReaped } from "./reaper";

describe("reaper (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let w: TestUser;
  let b: TestUser;
  const WORKER = "dev-worker";
  const ME = "dev-worker-cafe0001";

  before(async () => {
    env = await setupInt("reaper");
    w = await makeUser(env.owner, "reap_w");
    b = await makeUser(env.owner, "reap_b");
  });
  after(async () => {
    await env?.close();
  });
  beforeEach(async () => {
    await env.owner.query(`DELETE FROM ${env.schema}.jobs`);
  });

  const reap = async (drainEnd = false) => {
    const emitter = new RecordingEmitter();
    const metrics = new Metrics({ workerId: ME, bootId: "cafe0001", version: "0", profile: "sf18-v1" }, 0);
    const rows = await env.db.query(reapStatement({ workerId: WORKER, me: ME, drainEnd }));
    const reaped = await handleReaped(rows, { emitter, log: silentLogger, metrics });
    return { reaped, emitter, metrics };
  };

  it("escapes LIKE wildcards in the worker id and matches exactly an 8-char boot id", () => {
    assert.equal(orphanPattern("dev-worker"), "dev-worker-________");
    assert.equal(orphanPattern("a_b%c"), "a\\_b\\%c-________");
  });

  it("requeues an orphan of an earlier boot in 30 s, and leaves fresh, own and other workers' jobs alone", async () => {
    const orphan = await insertJob(env, {
      status: "RUNNING",
      lockedBy: "dev-worker-0ld0b007",
      heartbeatSec: -(ORPHAN_STALE_SEC + 5),
      attempts: 1,
    });
    const mine = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: -5, attempts: 1 });
    const other = await insertJob(env, {
      status: "RUNNING",
      lockedBy: "dev-worker-2-0ld0b007",
      heartbeatSec: -5,
      attempts: 1,
    });
    const otherBox = await insertJob(env, {
      status: "RUNNING",
      lockedBy: "ci-worker-0ld0b007",
      heartbeatSec: -60,
      attempts: 1,
    });
    const queued = await insertJob(env, { status: "QUEUED", runAtSec: -600 });
    const { reaped, metrics } = await reap();
    assert.deepEqual(
      reaped.map((r) => r.id),
      [orphan],
    );
    const row = await jobRow(env, orphan);
    assert.equal(row.status, "QUEUED");
    assert.equal(row.lockedBy, null);
    assert.equal(row.attempts, 1, "a reap is the failed attempt the claim already counted");
    assert.match(row.lastError ?? "", /^worker_stalled: /);
    assert.ok(Math.abs(row.runAtMs - (row.nowMs + REAP_RETRY_SEC * 1000)) < 5_000);
    for (const id of [mine, other, otherBox]) assert.equal((await jobRow(env, id)).status, "RUNNING");
    assert.equal((await jobRow(env, queued)).status, "QUEUED");
    assert.deepEqual(metrics.snapshot(0, { draining: false, nextRunAtMs: null, lastDrainAtMs: null }).jobs.failed, {
      worker_stalled: 1,
    });
  });

  it("requeues any worker's job whose heartbeat is older than 3 minutes", async () => {
    const stale = await insertJob(env, { status: "RUNNING", lockedBy: "ci-worker-0ld0b007", heartbeatSec: -181 });
    const fresh = await insertJob(env, { status: "RUNNING", lockedBy: "ci-worker-0ld0b007", heartbeatSec: -170 });
    const { reaped } = await reap();
    assert.deepEqual(
      reaped.map((r) => r.id),
      [stale],
    );
    assert.equal((await jobRow(env, fresh)).status, "RUNNING");
  });

  it("fails the job for good when its attempts are used up", async () => {
    const id = await insertJob(env, {
      status: "RUNNING",
      lockedBy: "dev-worker-0ld0b007",
      heartbeatSec: -(ORPHAN_STALE_SEC + 5),
      attempts: 4,
      maxAttempts: 4,
    });
    const { reaped } = await reap();
    assert.equal(reaped[0]?.status, "FAILED");
    const row = await jobRow(env, id);
    assert.equal(row.status, "FAILED");
    assert.ok(row.finishedAtMs !== null, "finishedAt set for the prune slice");
  });

  it("marks a reaped analysis's game FAILED, records failedAtPly, bumps both members once and emits analysis:failed", async () => {
    const g = await makeGame(env.owner, w, b, { plyCount: 44 });
    await env.owner.query(
      `INSERT INTO ${env.schema}.game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "totalPlies", "gradedPlies",
                                  evals, second, best, judgements, "countsWhite", "countsBlack", "updatedAt")
       VALUES ($1, 1, 'fake/sf18-v1', 120000, 1000000, 44, 20, '{}', '{}', '{}', '{}', '{}', '{}', now())`,
      [g.id],
    );
    const before = await env.owner.query(`SELECT id::text AS id, "gamesVersion" AS v FROM users WHERE id IN ($1, $2)`, [
      w.id,
      b.id,
    ]);
    await insertJob(env, {
      status: "RUNNING",
      lockedBy: "dev-worker-0ld0b007",
      heartbeatSec: -(ORPHAN_STALE_SEC + 5),
      attempts: 2,
      gameId: g.id,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
    const { reaped, emitter } = await reap();
    assert.equal(reaped.length, 1);
    assert.deepEqual(reaped[0]!.game, { ref: g.ref, plyCount: 44, gradedPlies: 20, members: [w.ref, b.ref] });
    const game = await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id]);
    assert.equal(game.rows[0].s, "FAILED");
    const ga = await env.owner.query(`SELECT "failedAtPly" FROM ${env.schema}.game_analyses WHERE "gameId" = $1`, [
      g.id,
    ]);
    assert.equal(ga.rows[0].failedAtPly, 20);
    const afterRows = await env.owner.query(
      `SELECT id::text AS id, "gamesVersion" AS v FROM users WHERE id IN ($1, $2)`,
      [w.id, b.id],
    );
    for (const r of afterRows.rows) assert.equal(r.v, before.rows.find((x: { id: string }) => x.id === r.id).v + 1);
    assert.equal(emitter.sent.length, 1);
    const sent = emitter.sent[0]!;
    assert.equal(sent.event, "analysis:failed");
    assert.deepEqual(sent.userRefs, [w.ref, b.ref]);
    assert.equal((sent.data as { code: string }).code, "worker_stalled");
    assert.equal((sent.data as { retryable: boolean }).retryable, true);
    assert.equal((sent.data as { failedAtPly: number }).failedAtPly, 20);
    assert.equal(typeof (sent.data as { retryAt: string }).retryAt, "string");
  });

  it("reaps a non-analysis job without touching any game", async () => {
    const id = await insertJob(env, {
      kind: "HOUSEKEEPING",
      status: "RUNNING",
      lockedBy: "dev-worker-0ld0b007",
      heartbeatSec: -(ORPHAN_STALE_SEC + 5),
      payload: { v: 1, day: "2026-11-11" },
    });
    const { reaped, emitter } = await reap();
    assert.equal(reaped[0]?.id, id);
    assert.equal(reaped[0]?.game, null);
    assert.equal(emitter.sent.length, 0);
  });

  // regression: shared-worker-id (FIX-2, review round 2). Two live workers with the same WORKER_ID reaped each other's
  // RUNNING jobs (at boot, and at drain end, where the heartbeat was ignored). Another boot's row is an orphan only
  // once its heartbeat is ORPHAN_STALE_SEC old; at drain end only this boot's own rows are taken at once.
  it("never reaps a row another boot of this worker id is still heart-beating, at boot or at drain end", async () => {
    const live = await insertJob(env, { status: "RUNNING", lockedBy: "dev-worker-11ve0b07", heartbeatSec: -20, attempts: 1 });
    const dead = await insertJob(env, {
      status: "RUNNING",
      lockedBy: "dev-worker-dead0b07",
      heartbeatSec: -(ORPHAN_STALE_SEC + 2),
      attempts: 1,
    });
    const mine = await insertJob(env, { status: "RUNNING", lockedBy: ME, heartbeatSec: -1, attempts: 1 });
    const boot = await reap(false);
    assert.deepEqual(boot.reaped.map((r) => r.id), [dead]);
    assert.equal((await jobRow(env, live)).status, "RUNNING");
    assert.equal((await jobRow(env, mine)).status, "RUNNING", "at boot no row can be this boot's");
    const siblings = await env.db.query(freshSiblingsStatement({ workerId: WORKER, me: ME }));
    assert.equal(siblings[0]?.n, 1, "the live sibling is reported, so the scheduler re-checks it later");
    assert.ok(typeof siblings[0]?.lastBeatMs === "number");
    const drainEnd = await reap(true);
    assert.deepEqual(drainEnd.reaped.map((r) => r.id), [mine], "drain end: this boot's own orphan only");
    assert.equal((await jobRow(env, live)).status, "RUNNING");
    assert.equal((await jobRow(env, live)).lockedBy, "dev-worker-11ve0b07");
  });

  // regression: reaped-compare-never-failed (FIX-2, review round 2). Only the runner's failure path called the
  // LEGEND_COMPARE handler's onFailed, so a compare job failed for good by the reaper left the row FACTS_READY and the
  // waiting compare page never heard `compare:ready`.
  it("a LEGEND_COMPARE failed for good by the reaper fails the comparison and emits compare:ready failed", async () => {
    const g = await makeGame(env.owner, w, b, { plyCount: 30, analysisStatus: "DONE" });
    await env.owner.query(
      `INSERT INTO legend_comparisons ("gameId", "userId", status, facts, attempts, "updatedAt")
       VALUES ($1, $2, 'FACTS_READY', '{"v":1}'::jsonb, 1, now()), ($1, $3, 'FACTS_READY', '{"v":1}'::jsonb, 1, now())`,
      [g.id, w.id, b.id],
    );
    const last = await insertJob(env, {
      kind: "LEGEND_COMPARE",
      status: "RUNNING",
      lockedBy: "ci-worker-0ld0b007",
      heartbeatSec: -400,
      attempts: 3,
      maxAttempts: 3,
      gameId: g.id,
      payload: { v: 1, gameId: g.id, userId: w.id, gameRef: g.ref },
    });
    const retry = await insertJob(env, {
      kind: "LEGEND_COMPARE",
      status: "RUNNING",
      lockedBy: "ci-worker-0ld0b007",
      heartbeatSec: -400,
      attempts: 1,
      maxAttempts: 3,
      gameId: g.id,
      payload: { v: 1, gameId: g.id, userId: b.id, gameRef: g.ref },
    });
    const { reaped, emitter } = await reap();
    assert.deepEqual(reaped.map((r) => [r.id, r.status]).sort(), [
      [last, "FAILED"],
      [retry, "QUEUED"],
    ].sort());
    const rows = (
      await env.owner.query(
        `SELECT "userId"::text AS "userId", status::text AS status, error FROM legend_comparisons WHERE "gameId" = $1`,
        [g.id],
      )
    ).rows as { userId: string; status: string; error: string | null }[];
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    assert.equal(byUser.get(w.id)?.status, "FAILED");
    assert.match(byUser.get(w.id)?.error ?? "", /^worker_stalled: /);
    assert.equal(byUser.get(b.id)?.status, "FACTS_READY", "a reap with attempts left is only a retry");
    assert.deepEqual(
      emitter.sent.map((e) => [e.event, e.userRefs, e.data]),
      [["compare:ready", [w.ref], { v: 1, gameRef: g.ref, status: "failed" }]],
    );
    const game = await env.owner.query(`SELECT "analysisStatus"::text AS s FROM games WHERE id = $1`, [g.id]);
    assert.equal(game.rows[0].s, "DONE", "a compare job never touches the game's analysis status");
  });

  it("a compare row already READY is not failed by a reaped compare job", async () => {
    const g = await makeGame(env.owner, w, b, { plyCount: 30, analysisStatus: "DONE" });
    await env.owner.query(
      `INSERT INTO legend_comparisons ("gameId", "userId", status, facts, attempts, "updatedAt") VALUES ($1, $2, 'READY', '{"v":1}'::jsonb, 1, now())`,
      [g.id, w.id],
    );
    await insertJob(env, {
      kind: "LEGEND_COMPARE",
      status: "RUNNING",
      lockedBy: "ci-worker-0ld0b007",
      heartbeatSec: -400,
      attempts: 3,
      maxAttempts: 3,
      gameId: g.id,
      payload: { v: 1, gameId: g.id, userId: w.id, gameRef: g.ref },
    });
    const { emitter } = await reap();
    assert.equal(emitter.sent.length, 0);
    const row = await env.owner.query(`SELECT status::text AS s FROM legend_comparisons WHERE "gameId" = $1`, [g.id]);
    assert.equal(row.rows[0].s, "READY");
  });
});
