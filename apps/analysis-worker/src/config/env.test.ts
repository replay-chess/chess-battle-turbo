// P6's worker environment (phase-06 plan §7.7, §7.10; interface check §5 "WK/src/env.ts (+ env.test.ts)"): the kill
// switch's per-environment default, the J4 caps, the debounce below Neon's suspend, and the WEAKNESS_SEED_FREEZE test
// hook that a production worker refuses to boot with (the TE X12 production proof registered for the `env` hook).
// No message echoes a secret.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { EnvError, loadEnv } from "./env";
import { defaultWeaknessSettings } from "../weakness/settings";

const k = () => randomBytes(32).toString("base64");
const RING = `wk:${k()},webwk:${k()},ws:${k()}`;
const test = {
  APP_ENV: "test",
  WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@localhost:5432/replay",
  INTERNAL_API_SECRET: RING,
  ENGINE: "fake",
};
const production = {
  APP_ENV: "production",
  WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-prod-host-123.us-east-1.aws.neon.tech/neondb?sslmode=require",
  INTERNAL_API_SECRET: RING,
  WS_INTERNAL_URL: "http://socket:3002",
};
const dev = {
  APP_ENV: "dev",
  WORKER_DATABASE_URL: "postgresql://replay_worker:secretpw@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require",
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

describe("P6 weakness environment", () => {
  it("defaults: on in test and dev, off in production until P13; caps 100 / 20; debounce 240 s; no seed freeze", () => {
    for (const env of [test, dev]) {
      const w = loadEnv(env).weakness;
      assert.deepEqual(w, { enabled: true, analyseCap: 100, analyseCapTrial: 20, debounceSec: 240, seedFreeze: false, healMaxRows: 40 });
    }
    assert.equal(loadEnv(production).weakness.enabled, false, "the kill switch is closed in production by default");
    assert.equal(loadEnv({ ...production, WEAKNESS_JOBS_ENABLED: "on" }).weakness.enabled, true);
    assert.equal(loadEnv({ ...dev, WEAKNESS_JOBS_ENABLED: "false" }).weakness.enabled, false);
    assert.deepEqual(defaultWeaknessSettings(), loadEnv(test).weakness);
  });

  it("WEAKNESS_HEAL_MAX_ROWS (FIX-1): rows one recompute heals, 1..300", () => {
    assert.equal(loadEnv({ ...test, WEAKNESS_HEAL_MAX_ROWS: "16" }).weakness.healMaxRows, 16);
    refused({ ...test, WEAKNESS_HEAL_MAX_ROWS: "0" }, /WEAKNESS_HEAL_MAX_ROWS must be within 1\.\.300/);
    refused({ ...test, WEAKNESS_HEAL_MAX_ROWS: "many" }, /WEAKNESS_HEAL_MAX_ROWS must be an integer/);
  });

  it("WEAKNESS_SEED_FREEZE is a test hook: accepted in dev and test, refused with APP_ENV=production", () => {
    assert.equal(loadEnv({ ...test, WEAKNESS_SEED_FREEZE: "1" }).weakness.seedFreeze, true);
    assert.equal(loadEnv({ ...dev, WEAKNESS_SEED_FREEZE: "on" }).weakness.seedFreeze, true);
    refused({ ...production, WEAKNESS_SEED_FREEZE: "on" }, /WEAKNESS_SEED_FREEZE is a test hook: it is refused with APP_ENV=production/);
    assert.equal(loadEnv({ ...production, WEAKNESS_SEED_FREEZE: "off" }).weakness.seedFreeze, false);
  });

  it("WEAKNESS_DEBOUNCE_SEC stays below Neon's 5-minute suspend; the caps are bounded and ordered", () => {
    assert.equal(loadEnv({ ...test, WEAKNESS_DEBOUNCE_SEC: "0" }).weakness.debounceSec, 0);
    assert.equal(loadEnv({ ...test, WEAKNESS_DEBOUNCE_SEC: "299" }).weakness.debounceSec, 299);
    refused({ ...test, WEAKNESS_DEBOUNCE_SEC: "300" }, /WEAKNESS_DEBOUNCE_SEC must be within 0\.\.299/);
    refused({ ...test, WEAKNESS_DEBOUNCE_SEC: "4m" }, /WEAKNESS_DEBOUNCE_SEC must be an integer/);
    assert.equal(loadEnv({ ...test, WEAKNESS_ANALYSE_CAP: "150", WEAKNESS_ANALYSE_CAP_TRIAL: "30" }).weakness.analyseCap, 150);
    refused({ ...test, WEAKNESS_ANALYSE_CAP: "0" }, /WEAKNESS_ANALYSE_CAP must be within 1\.\.300/);
    refused({ ...test, WEAKNESS_ANALYSE_CAP: "40", WEAKNESS_ANALYSE_CAP_TRIAL: "50" }, /must not exceed WEAKNESS_ANALYSE_CAP/);
    refused({ ...test, WEAKNESS_JOBS_ENABLED: "maybe" }, /WEAKNESS_JOBS_ENABLED must be on or off/);
  });
});
