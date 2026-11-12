// Environment and TIMING_PROFILE (phase-02 plan 12.1 `timing-profile`), the DB-row → session mapping, the per-game
// timer, eviction, and the idle-server rule (plan 12.4 `no-idle-queries`: no live games → zero DB queries).
import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_MACHINE_CONFIG, INITIAL_FEN } from "@repo/game-core";
import { EnvError, loadEnv, originAllowed } from "../src/config/env";
import { timingFor } from "../src/config/timing";
import { buildServerGame } from "../src/game/SessionRegistry";
import { GameTimer } from "../src/game/timers";
import { MemoryPersistence, SOCKET_TOKEN_SECRET, record, startServer, testTiming, user } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("TIMING_PROFILE and the environment", () => {
  test("loadEnv refuses TIMING_PROFILE unless APP_ENV=test", () => {
    for (const APP_ENV of ["dev", "production", "local"]) {
      assert.throws(
        () => loadEnv({ APP_ENV, TIMING_PROFILE: "fast", ALLOWED_ORIGINS: "https://x.example", SOCKET_TOKEN_SECRET }),
        (e: unknown) => e instanceof EnvError && /TIMING_PROFILE/.test(e.message),
      );
    }
    assert.equal(loadEnv({ APP_ENV: "test", TIMING_PROFILE: "fast" }).timingProfile, "fast");
  });

  test("the process exits at boot with TIMING_PROFILE outside test (and never prints a secret)", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: ROOT,
      env: {
        // eslint-disable-next-line turbo/no-undeclared-env-vars -- the child process needs a PATH, nothing else
        PATH: process.env.PATH ?? "",
        APP_ENV: "production",
        TIMING_PROFILE: "fast",
        ALLOWED_ORIGINS: "https://x.example",
        SOCKET_TOKEN_SECRET,
        SENTRY_DSN: "",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /TIMING_PROFILE is a test hook/);
    assert.equal(run.stderr.includes(SOCKET_TOKEN_SECRET.slice(3)), false);
  });

  test("dev and production need ALLOWED_ORIGINS and SOCKET_TOKEN_SECRET; APP_ENV is required", () => {
    assert.throws(() => loadEnv({}), /APP_ENV/);
    assert.throws(() => loadEnv({ APP_ENV: "dev", SOCKET_TOKEN_SECRET }), /ALLOWED_ORIGINS/);
    assert.throws(() => loadEnv({ APP_ENV: "dev", ALLOWED_ORIGINS: "https://a.example" }), /SOCKET_TOKEN_SECRET/);
    assert.throws(() => loadEnv({ APP_ENV: "test", SOCKET_TOKEN_SECRET: "t1:short" }), /SOCKET_TOKEN_SECRET/);
  });

  test("a bare LEGACY secret is accepted as kid s0 outside production only (rollout fallback, plan 7.1.7)", () => {
    const dev = loadEnv({
      APP_ENV: "dev",
      ALLOWED_ORIGINS: "https://a.example",
      LEGACY_INTERNAL_API_SECRET: "old-bare",
      ANALYSIS_WORKER_URL: "http://analysis-worker:3003",
    });
    assert.equal(dev.socketKeys.keys.has("s0"), true);
    assert.throws(
      () => loadEnv({ APP_ENV: "production", ALLOWED_ORIGINS: "https://a.example", LEGACY_INTERNAL_API_SECRET: "old" }),
      /SOCKET_TOKEN_SECRET/,
    );
  });

  test("origins fail closed outside test/local", () => {
    assert.equal(originAllowed({ appEnv: "dev", allowedOrigins: ["https://a.example"] }, "https://a.example"), true);
    assert.equal(originAllowed({ appEnv: "dev", allowedOrigins: ["https://a.example"] }, "https://b.example"), false);
    assert.equal(originAllowed({ appEnv: "test", allowedOrigins: [] }, "https://b.example"), true);
    assert.equal(originAllowed({ appEnv: "dev", allowedOrigins: [] }, "https://b.example"), false);
  });

  test("fast scales every timer of plan 7.9; real keeps the plan values (env tuning applies)", () => {
    const real = timingFor({ timingProfile: "real", overrides: {} });
    assert.deepEqual(real.machine, DEFAULT_MACHINE_CONFIG);
    assert.equal(real.ipGuardBootGraceMs, 120_000);
    assert.equal(real.postGameRetentionMs, 60_000);
    const fast = timingFor({ timingProfile: "fast", overrides: {} });
    assert.ok(fast.machine.firstMoveMs <= 5_000 && fast.machine.graceMs <= 5_000 && fast.machine.rematchMs <= 5_000);
    assert.ok(fast.machine.studyScale * 30_000 <= 5_000);
    assert.ok(fast.ipGuardBootGraceMs <= 5_000 && fast.machine.resumeMaxWaitMs <= 5_000);
    assert.equal(timingFor({ timingProfile: "real", overrides: { graceMs: 1234 } }).machine.graceMs, 1234);
  });
});

describe("DB row → session", () => {
  const now = Date.now();
  test("waiting / fresh rows start in waiting; CANCELLED and bot rows are refused", () => {
    const r = record({ white: user("a"), black: null });
    const built = buildServerGame(r, now, 60_000);
    assert.equal(built.ok && built.state.phase, "waiting");
    assert.deepEqual(buildServerGame({ ...r, status: "CANCELLED" }, now, 60_000), { ok: false, code: "not_found", reason: "closed" });
    assert.equal(buildServerGame({ ...r, mode: "BOT" }, now, 60_000).ok, false);
  });

  test("a row with progress is restored by replay, frozen until both attach", () => {
    const r = record({ white: user("a"), black: user("b"), moves: "e2e4 e7e5 g1f3", phase: "PLAYING" });
    r.moveClocksMs = [300_000, 300_000, 299_000];
    r.lastMoveAt = new Date(now - 5_000);
    const built = buildServerGame(r, now, 60_000);
    assert.ok(built.ok);
    assert.equal(built.restored, true);
    assert.equal(built.state.moves.length, 3);
    assert.equal(built.state.turn, "b");
    assert.ok(built.state.frozen);
    assert.equal(built.state.frozen.run, "b");
    const corrupt = buildServerGame({ ...r, moves: "e2e4 e2e4" }, now, 60_000);
    assert.equal(corrupt.ok, false);
  });

  test("a finished row becomes an ended session with the stored result", () => {
    const r = record({ white: user("a"), black: user("b"), moves: "f2f3 e7e5 g2g4 d8h4", status: "COMPLETED" });
    r.endMethod = "CHECKMATE";
    r.outcome = "BLACK";
    r.completedAt = new Date(now - 1_000);
    const built = buildServerGame(r, now, 60_000);
    assert.ok(built.ok);
    assert.equal(built.state.phase, "ended");
    assert.deepEqual(
      { winner: built.state.result?.winner, method: built.state.result?.method, ply: built.state.result?.ply },
      { winner: "b", method: "checkmate", ply: 4 },
    );
    assert.equal(built.state.startFen, INITIAL_FEN);
  });
});

describe("timer and eviction", () => {
  test("GameTimer keeps one timeout and re-arms only on a new deadline", async () => {
    let fired = 0;
    const t = new GameTimer(Date.now, () => fired++);
    t.sync({ at: Date.now() + 30, kind: "flag" });
    t.sync({ at: Date.now() + 10_000, kind: "grace" });
    t.sync({ at: Date.now() + 20, kind: "flag" });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fired, 1);
    t.sync(null);
    assert.equal(t.pending, null);
  });

  test("ended sessions without players leave memory at the next sweep", async () => {
    const server = await startServer({ timing: testTiming({}, { postGameRetentionMs: 50, waitingRetentionMs: 50 }) });
    try {
      const r = server.persistence.add(record({ white: user("a"), black: null }));
      const opened = await server.handle.registry.open(r.ref);
      assert.ok(opened.ok);
      await new Promise((res) => setTimeout(res, 60));
      assert.equal(server.handle.registry.sweep(), 1, "a waiting session with no player socket");
      assert.equal(server.handle.registry.get(r.ref), undefined);
    } finally {
      await server.close();
    }
  });
});

describe("no idle queries", () => {
  test("with no live games, 24 simulated hours of timers make zero DB calls", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const persistence = new MemoryPersistence();
    const calls = () =>
      persistence.loads + persistence.checkpoints.length + persistence.finishes.length + persistence.aborts.length;
    let server: Awaited<ReturnType<typeof startServer>> | null = null;
    try {
      server = await startServer({ persistence, timing: testTiming() });
      for (let i = 0; i < 24 * 60; i++) mock.timers.tick(60_000);
      assert.equal(calls(), 0);
    } finally {
      mock.timers.reset();
      await server?.close();
    }
  });
});
