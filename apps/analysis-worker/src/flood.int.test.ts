// The throughput tool's database half against a real Postgres, as replay_worker (scripts/worker-flood.ts; plan §12.7;
// FIX-1): it finds the bench games, resets them (reviews, analyses and jobs gone, NONE), enqueues all of them at
// BACKLOG in one batch with a fair-share ordinal, polls their progress and reports the run. The worker side (the kick
// and the metrics) is injected: the "worker" marks the games DONE when kicked. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import type { WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import { flood, parseArgs } from "../scripts/worker-flood";
import { makeGame, makeUser, setupInt, skipInt, type IntEnv } from "./testing/pg";

function metrics(hits: number, misses: number, emits: Record<string, number>): WorkerMetricsResponse {
  return {
    v: 1, workerId: "w", bootId: "b", version: "0", profile: "sf18-v1", uptimeSec: 1, draining: false, nextRunAt: null,
    lastDrainAt: null, lastHousekeepingAt: null,
    queue: { depth: { "80+": 0, "<80": 0 }, oldestSec: { "80+": 0, "<80": 0 }, queueSeenAt: null },
    jobs: { done: {}, failed: {}, durationMsP50: {} }, engine: { nps: 350_000, restarts: 0 },
    cache: { hitsMemory: hits, hitsDisk: 0, misses }, db: { statements: 0, retries: 0 }, lagPauseMs: 0, emits,
  } as WorkerMetricsResponse;
}

describe("worker-flood database half (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  const ids: string[] = [];

  before(async () => {
    env = await setupInt("flood");
    const w = await makeUser(env.owner, "fl_w");
    const b = await makeUser(env.owner, "fl_b");
    for (let i = 0; i < 3; i++) {
      const g = await makeGame(env.owner, w, b, { analysisStatus: "DONE", plyCount: 40 });
      await env.owner.query(
        `UPDATE games SET "gameData" = '{"p3Seed":"bench"}'::jsonb, "completedAt" = now() - ($2::int * interval '1 minute') WHERE id = $1`,
        [g.id, 10 - i],
      );
      // A stale result from an earlier run, which the reset must clear.
      await env.owner.query(`INSERT INTO ${env.schema}.jobs (kind, status, priority, payload, "dedupeKey", "gameId")
                             VALUES ('ANALYZE_GAME', 'DONE', 10, '{"v":1}'::jsonb, $1, $2::bigint)`, [`analyze:${g.id}`, g.id]);
      ids.push(g.id);
    }
  });
  after(async () => {
    if (env) await env.owner.query(`DELETE FROM games WHERE id = ANY($1::bigint[])`, [ids]);
    await env?.close();
  });

  it("resets, enqueues at BACKLOG, follows the games to DONE and reports the run", async () => {
    let clock = Date.parse("2026-11-12T10:00:00Z");
    let kicked = 0;
    const lines: string[] = [];
    const report = await flood(parseArgs(["--games", "3", "--timeout-min", "5"], {}), {
      db: env.db,
      keys: { signingKid: undefined, keys: new Map() },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: (l) => lines.push(l),
      metrics: async () => (kicked ? metrics(40, 120, { "analysis:batch": 1 }) : metrics(0, 0, {})),
      kick: async () => {
        kicked++;
        const jobs = await env.owner.query(
          `SELECT priority, status::text AS status, payload->>'reason' AS reason, "fairSeq" FROM ${env.schema}.jobs
            WHERE "gameId" = ANY($1::bigint[]) ORDER BY "fairSeq"`,
          [ids],
        );
        assert.equal(jobs.rows.length, 3);
        for (const [k, j] of jobs.rows.entries()) {
          assert.equal(j.priority, JOB_PRIORITY.BACKLOG);
          assert.equal(j.status, "QUEUED");
          assert.equal(j.reason, "backfill");
          assert.equal(j.fairSeq, k);
        }
        const st = await env.owner.query(`SELECT DISTINCT "analysisStatus"::text AS s FROM games WHERE id = ANY($1::bigint[])`, [ids]);
        assert.deepEqual(st.rows.map((r) => r.s), ["QUEUED"]);
        // The "worker": done 45 minutes later.
        clock += 45 * 60_000;
        await env.owner.query(`UPDATE games SET "analysisStatus" = 'DONE' WHERE id = ANY($1::bigint[])`, [ids]);
        return 202;
      },
      lag: async () => null,
    });
    assert.equal(kicked, 1);
    assert.deepEqual(report.games, { enqueued: 3, done: 3, failed: 0, skipped: 0, averagePlies: 40 });
    assert.equal(report.gamesPerHour, 4);
    assert.equal(report.cache.hitRatio, 0.25);
    assert.equal(report.engineNps, 350_000);
    assert.deepEqual(Object.values(report.perGameEmits), [0, 0, 0, 0]);
    // 3 games in 45 min is below the 60/hour gate: the report says so.
    assert.equal(report.gate.pass, false);
    assert.match(report.gate.failures.join(";"), /games\/hour < 60/);
    assert.ok(lines.some((l) => /enqueued 3 bench games at BACKLOG; kick → HTTP 202/.test(l)));
  });

  it("refuses to run with fewer bench games than asked for", async () => {
    await assert.rejects(
      flood(parseArgs(["--games", "50"], {}), {
        db: env.db,
        keys: { signingKid: undefined, keys: new Map() },
        sleep: async () => undefined,
        now: () => 0,
        log: () => undefined,
        metrics: async () => metrics(0, 0, {}),
        kick: async () => 202,
        lag: async () => null,
      }),
      /found 3 of 50 bench games: run `pnpm --filter @repo\/db exec tsx seed\/bench\.ts --apply` first/,
    );
  });
});
