// Boot guards (phase-03 plan §8.12, §7.9, §11.2 rule 10, §12.1 `boot.test`, TST X12): APP_ENV=production with
// WORKER_FAULT or ENGINE=fake → the process exits 1; the frozen profile; the database target per environment; the
// internal key ring; the kick `fault` honoured only with APP_ENV=test. No message ever echoes a secret.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { defaultWorkerId, EnvError, kickFaultsHonoured, loadEnv } from "./config/env";
import { formatFault, parseFault } from "./config/faults";

const k = () => randomBytes(32).toString("base64");
const RING = `wk:${k()},webwk:${k()},ws:${k()}`;
const DEV_HOST = "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech";
const base = {
  APP_ENV: "test",
  WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@localhost:5432/replay",
  INTERNAL_API_SECRET: RING,
  ENGINE: "fake",
};
const dev = {
  APP_ENV: "dev",
  WORKER_DATABASE_URL: `postgresql://replay_worker:secretpw@${DEV_HOST}/neondb?sslmode=require`,
  INTERNAL_API_SECRET: RING,
  WS_INTERNAL_URL: "http://localhost:3002",
};

function refused(env: Record<string, string>, pattern: RegExp) {
  assert.throws(
    () => loadEnv(env),
    (e: unknown) => {
      assert.ok(e instanceof EnvError, String(e));
      assert.match(e.message, pattern);
      assert.doesNotMatch(e.message, /secretpw/, "never echoes the password");
      return true;
    },
  );
}

describe("WORKER_ID default", () => {
  // regression: shared-worker-id (FIX-2, review round 2). The default was `<APP_ENV>-worker`, so a laptop worker with
  // APP_ENV=dev and no WORKER_ID became `dev-worker`, the dev VM's id, and each reaped the other's live jobs.
  it("is <APP_ENV>-<host>: two machines that leave it unset never share an id", () => {
    assert.equal(defaultWorkerId("dev", "Rohits-MacBook-Pro.local"), "dev-rohits-macbook-pro");
    assert.equal(defaultWorkerId("dev", "replay-chess-dev"), "dev-replay-chess-dev");
    assert.notEqual(defaultWorkerId("dev", "Rohits-MacBook-Pro.local"), "dev-worker");
    const long = defaultWorkerId("production", "a-very-long-host-name-that-goes-on.example.internal");
    assert.ok(long.length <= 30, long);
    assert.match(long, /^[a-z0-9][a-z0-9-]{0,29}$/);
    assert.equal(defaultWorkerId("dev", "___"), "dev-host");
    for (const host of ["ip-10-0-0-1.ec2.internal", "MY_BOX", "x"]) {
      assert.match(defaultWorkerId("dev", host), /^[a-z0-9][a-z0-9-]{0,29}$/, host);
    }
  });
});

describe("environment guards", () => {
  it("accepts a CI test worker (fake engine, local Postgres)", () => {
    const env = loadEnv(base);
    assert.equal(env.engine.kind, "fake");
    assert.equal(env.dbDriver, "pg");
    assert.equal(env.host, "127.0.0.1");
    assert.equal(env.port, 3003);
    assert.equal(env.workerId, defaultWorkerId("test"), "no WORKER_ID: <APP_ENV>-<host>");
    assert.match(env.workerId, /^test-[a-z0-9-]+$/);
    assert.equal(env.internalKeys.signingKid, "wk");
    assert.deepEqual([...env.acceptKeys.keys.keys()].sort(), ["webwk", "ws"], "the worker's own kid is not accepted");
    assert.equal(env.evalCache.enabled, true);
    assert.equal(env.lagPauseMs, 40);
  });

  it("accepts a dev worker on the Neon dev endpoint as replay_worker (HTTP driver, all interfaces in the container)", () => {
    const env = loadEnv(dev);
    assert.equal(env.dbDriver, "neon");
    assert.equal(env.host, "0.0.0.0");
    assert.equal(env.engine.kind, "stockfish");
    assert.equal(env.engine.path, "/usr/local/bin/stockfish");
  });

  it("APP_ENV=production refuses WORKER_FAULT and ENGINE=fake", () => {
    const prod = { ...dev, APP_ENV: "production", WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-prod-x.us-east-1.aws.neon.tech/db" };
    loadEnv(prod);
    refused({ ...prod, WORKER_FAULT: "fail_at_ply:12" }, /WORKER_FAULT is a test hook: it is refused with APP_ENV=production/);
    refused({ ...prod, ENGINE: "fake" }, /ENGINE=fake is a test hook: it is refused with APP_ENV=production/);
  });

  it("ENGINE=fake only with APP_ENV=test; WORKER_FAULT only with dev or test", () => {
    refused({ ...dev, ENGINE: "fake" }, /ENGINE=fake .* APP_ENV=dev/);
    refused({ ...base, APP_ENV: "local" , WORKER_FAULT: "hold_queue" }, /WORKER_FAULT .* APP_ENV=local/);
    assert.deepEqual(loadEnv({ ...dev, WORKER_FAULT: "stall_at_ply:20" }).fault, { kind: "stall_at_ply", ply: 20 });
    assert.deepEqual(loadEnv({ ...base, WORKER_FAULT: "hold_queue" }).fault, { kind: "hold_queue" });
    refused({ ...base, WORKER_FAULT: "drop_tables" }, /WORKER_FAULT: fault must be/);
  });

  it("the engine profile is frozen: ENGINE_PROFILE / THREADS / HASH must match sf18-v1", () => {
    assert.equal(loadEnv({ ...dev, ENGINE_PROFILE: "sf18-v1", ENGINE_THREADS: "1", ENGINE_HASH_MB: "64" }).engine.profile, "sf18-v1");
    refused({ ...dev, ENGINE_PROFILE: "sf18-v2" }, /ENGINE_PROFILE must be sf18-v1/);
    refused({ ...dev, ENGINE_THREADS: "2" }, /ENGINE_THREADS must be 1/);
    refused({ ...dev, ENGINE_HASH_MB: "256" }, /ENGINE_HASH_MB must be 64/);
    refused({ ...dev, ENGINE: "lc0" }, /ENGINE must be stockfish or fake/);
  });

  it("the database target must fit the environment and never be the owner role", () => {
    refused({ ...dev, WORKER_DATABASE_URL: "" }, /WORKER_DATABASE_URL is required/);
    refused({ ...dev, WORKER_DATABASE_URL: `postgresql://neondb_owner:secretpw@${DEV_HOST}/neondb` }, /owner role neondb_owner/);
    refused({ ...dev, WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-shiny-shape-b8lvr0f5-pooler.c-14.us-east-1.aws.neon.tech/neondb" }, /not a local Postgres or the dev endpoint/);
    refused({ ...dev, APP_ENV: "production" }, /production worker at the dev endpoint/);
    refused({ ...base, WORKER_DATABASE_URL: `postgresql://replay_worker:secretpw@${DEV_HOST}/neondb` }, /is not local \(APP_ENV=test\)/);
    refused({ ...base, WORKER_DATABASE_URL: "mysql://u:secretpw@localhost/db" }, /postgres:\/\//);
    refused({ ...base, WORKER_DATABASE_URL: "not a url secretpw" }, /does not parse/);
  });

  // regression: local-env-db-guard (FIX-1). APP_ENV=local (the .env.example default) skipped every database check, so
  // a local worker booted against the production branch or the old project, even as the owner role.
  it("APP_ENV=local accepts only a local Postgres or the dev endpoint, never the owner role", () => {
    const local = { ...dev, APP_ENV: "local" };
    assert.equal(loadEnv(local).dbDriver, "neon");
    assert.equal(loadEnv({ ...local, WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@localhost:55432/replay" }).dbDriver, "pg");
    refused(
      { ...local, WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-shiny-shape-b8lvr0f5-pooler.c-14.us-east-1.aws.neon.tech/neondb" },
      /not a local Postgres or the dev endpoint \(APP_ENV=local\)/,
    );
    refused(
      { ...local, WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-still-brook-a5nutqwh-pooler.us-east-2.aws.neon.tech/neondb" },
      /not a local Postgres or the dev endpoint/,
    );
    refused({ ...local, WORKER_DATABASE_URL: `postgresql://neondb_owner:secretpw@${DEV_HOST}/neondb` }, /owner role/);
    refused({ ...local, WORKER_DATABASE_URL: "postgresql://neondb_owner:secretpw@localhost:5432/replay" }, /owner role/);
  });

  it("the key ring signs with wk and holds a caller's key; WS_INTERNAL_URL is required on dev", () => {
    refused({ ...dev, INTERNAL_API_SECRET: `ws:${k()},wk:${k()}` }, /must list the worker's own kid `wk` first/);
    // regression: worker-holds-web-key (FIX-1): a worker ring with the web's or ops' socket key is refused.
    refused({ ...dev, INTERNAL_API_SECRET: `wk:${k()},web:${k()},ws:${k()}` }, /holds the web key/);
    refused({ ...base, INTERNAL_API_SECRET: `wk:${k()},webwk:${k()},ops:${k()}` }, /holds the ops key/);
    refused({ ...dev, INTERNAL_API_SECRET: `wk:${k()}` }, /holds no key the worker accepts/);
    refused({ ...dev, INTERNAL_API_SECRET: "" }, /`wk` first/);
    refused({ ...dev, INTERNAL_API_SECRET: "wk:short" }, /INTERNAL_API_SECRET: .*shorter than 32 bytes/);
    refused({ ...dev, WS_INTERNAL_URL: "" }, /WS_INTERNAL_URL is required with APP_ENV=dev/);
    refused({ ...dev, WS_INTERNAL_URL: "ftp://x" }, /WS_INTERNAL_URL must be http/);
  });

  it("WORKER_ID fits lockedBy (varchar 40 with the boot id) and other values are checked", () => {
    assert.equal(loadEnv({ ...dev, WORKER_ID: "dev-local" }).workerId, "dev-local");
    refused({ ...dev, WORKER_ID: "Dev_Worker" }, /WORKER_ID/);
    refused({ ...dev, WORKER_ID: "x".repeat(31) }, /WORKER_ID/);
    refused({ ...dev, EVAL_CACHE: "maybe" }, /EVAL_CACHE must be on or off/);
    refused({ ...dev, LAG_PAUSE_MS: "-1" }, /LAG_PAUSE_MS must be an integer/);
    refused({ ...dev, APP_ENV: "staging" }, /APP_ENV must be one of/);
    assert.equal(loadEnv({ ...dev, EVAL_CACHE: "off" }).evalCache.enabled, false);
  });

  it("a kick's fault is honoured only with APP_ENV=test; the fault grammar round-trips", () => {
    assert.equal(kickFaultsHonoured("test"), true);
    for (const e of ["dev", "production", "local"] as const) assert.equal(kickFaultsHonoured(e), false);
    for (const f of ["fail_at_ply:12", "stall_at_ply:20", "engine_crash:1", "hold_queue", "pause_at:writing:5000", "pause_at:pass1:500"]) {
      assert.equal(formatFault(parseFault(f)), f);
    }
    // regression: pause-at-pass1 — the pipeline's `pass1` pause point could not be armed (digits were refused).
    assert.deepEqual(parseFault("pause_at:pass1:500"), { kind: "pause_at", phase: "pass1", ms: 500 });
  });
});

describe("the process refuses to boot (exit 1)", () => {
  const main = fileURLToPath(new URL("./main.ts", import.meta.url));
  const boot = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", main], {
      // Only the variables under test (no PATH: node is started by its absolute path).
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
  const prod = { ...dev, APP_ENV: "production", WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-prod-x.us-east-1.aws.neon.tech/db" };

  for (const [name, extra, reason] of [
    ["WORKER_FAULT", { WORKER_FAULT: "fail_at_ply:3" }, /WORKER_FAULT is a test hook/],
    ["ENGINE=fake", { ENGINE: "fake" }, /ENGINE=fake is a test hook/],
  ] as const) {
    it(`APP_ENV=production with ${name}`, () => {
      const r = boot({ ...prod, ...extra });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /worker refused to boot/);
      assert.match(r.stderr, reason);
      assert.doesNotMatch(r.stderr + r.stdout, /secretpw/);
    });
  }
});
