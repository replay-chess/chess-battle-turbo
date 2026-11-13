// The post-deploy smoke against a booted worker (phase-03 plan §12.8): Postgres as replay_worker, ENGINE=fake (the
// dev box runs it with the real engine). A 26-ply game is reset, enqueued with reason "smoke", kicked with a signed
// `ops` call, polled to DONE, and checked: every ply graded, a review, readyMs null. A second run resets it first and
// passes again. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { bootWorker, type RunningWorker } from "./boot";
import { loadEnv } from "./config/env";
import { silentLogger } from "./obs/log";
import { runSmoke } from "./smoke";
import { makeGame, makeUser, setupInt, skipInt, type IntEnv } from "./testing/pg";

const k = () => randomBytes(32).toString("base64");
const MOVES = mockGradeInput("GAME").replay.uci.slice(0, 26);

describe("post-deploy smoke (Postgres, ENGINE=fake)", { skip: skipInt }, () => {
  let env: IntEnv;
  let worker: RunningWorker;
  const ring = `wk:${k()},webwk:${k()},ws:${k()},opswk:${k()}`;

  before(async () => {
    env = await setupInt("smoke");
    const workerEnv = loadEnv({
      APP_ENV: "test",
      // A P3 test: no import work (the boot backstop would sweep other int files' linked accounts, FIX-1).
      IMPORT_PAUSED: "on",
      WORKER_DATABASE_URL: env.workerUrl,
      INTERNAL_API_SECRET: ring,
      ENGINE: "fake",
      WORKER_ID: "int-smoke",
      PORT: "0",
      EVAL_CACHE: "off",
    });
    worker = await bootWorker(workerEnv, { log: silentLogger });
  });
  after(async () => {
    await worker?.shutdown();
    await env?.close();
  });

  it("resets, enqueues, kicks and sees the smoke game graded; twice", async () => {
    const w = await makeUser(env.owner, "sm");
    const b = await makeUser(env.owner, "sb");
    const g = await makeGame(env.owner, w, b, { analysisStatus: "DONE" });
    await env.owner.query(`UPDATE games SET moves = $2, "plyCount" = 26 WHERE id = $1`, [g.id, MOVES.join(" ")]);
    const lines: Record<string, unknown>[] = [];
    const run = () =>
      runSmoke({
        db: env.db,
        keys: parseRing(),
        workerUrl: `http://127.0.0.1:${worker.port}`,
        ref: g.ref,
        pollMs: 100,
        log: (l) => lines.push(l),
      });
    const first = await run();
    assert.deepEqual(first.failures, []);
    assert.equal(first.ok, true);
    assert.equal(first.state?.gradedPlies, 26);
    assert.equal(first.state?.readyMs, null);
    assert.ok(lines.some((l) => l.step === "kick" && l.status === 202 && l.kid === "opswk"));
    const second = await run();
    assert.equal(
      second.ok,
      true,
      `a second smoke resets the game and passes again: ${JSON.stringify(lines.slice(-4))}`,
    );
  });

  it("fails clearly when the smoke game is not seeded", async () => {
    const result = await runSmoke({
      db: env.db,
      keys: parseRing(),
      workerUrl: `http://127.0.0.1:${worker.port}`,
      ref: "cnosuchgame00000000000000",
      log: () => undefined,
    });
    assert.equal(result.ok, false);
    assert.match(result.failures[0] ?? "", /not seeded/);
  });

  function parseRing() {
    return loadEnv({ APP_ENV: "test", WORKER_DATABASE_URL: env.workerUrl, INTERNAL_API_SECRET: ring, ENGINE: "fake" })
      .acceptKeys;
  }
});
