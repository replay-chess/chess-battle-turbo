import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEV_ENV_FILE,
  MAX_TARGET_USERS,
  SeedGuardError,
  assertDevTarget,
  assertFixtureContentTarget,
  assertSourceNotTarget,
  assertUserTripwire,
  hostOf,
  isDevHost,
  isLocalHost,
  resolveEnvVar,
} from "./seed-guards";

const DEV = "ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech";
const DEV_POOLER = "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech";
const OLD_PROD = "ep-noisy-cake-a55zbrl9.us-east-2.aws.neon.tech";
const OLD_PROD_POOLER = "ep-noisy-cake-a55zbrl9-pooler.us-east-2.aws.neon.tech";
const url = (host: string) => `postgresql://user:secret@${host}/neondb?sslmode=require`;

test("allow-list accepts the dev host and its -pooler variant", () => {
  assert.equal(isDevHost(DEV), true);
  assert.equal(isDevHost(DEV_POOLER), true);
  assert.equal(assertDevTarget(url(DEV)), DEV);
  assert.equal(assertDevTarget(url(DEV_POOLER)), DEV_POOLER);
  assert.equal(assertDevTarget(`postgres://u:p@${DEV.toUpperCase()}:5432/neondb`), DEV);
});

test("allow-list rejects old prod and any other host", () => {
  for (const host of [
    OLD_PROD,
    OLD_PROD_POOLER,
    // withered-cake production branch endpoints (any endpoint that is not the dev one)
    "ep-shiny-shape-b8lvr0f5.c-14.us-east-1.aws.neon.tech",
    "ep-shiny-shape-b8lvr0f5-pooler.c-14.us-east-1.aws.neon.tech",
    "ep-withered-cake-82837167.c-14.us-east-1.aws.neon.tech",
    // look-alikes
    "ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech.evil.com",
    "xep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech",
    "ep-fancy-dust-b8b3dp81-pooler-pooler.c-14.us-east-1.aws.neon.tech",
    "ep-fancy-dust-b8b3dp81.c-14.us-east-2.aws.neon.tech",
    "localhost",
    "127.0.0.1",
  ]) {
    assert.equal(isDevHost(host), false, host);
    assert.throws(() => assertDevTarget(url(host)), SeedGuardError, host);
  }
});

test("the design-fixture content target is the dev endpoint or a loopback Postgres, nothing else", () => {
  assert.equal(assertFixtureContentTarget(url(DEV)), DEV);
  assert.equal(assertFixtureContentTarget(url(DEV_POOLER)), DEV_POOLER);
  for (const host of ["localhost", "127.0.0.1", "LOCALHOST"]) {
    assert.equal(isLocalHost(host), true, host);
    assert.equal(assertFixtureContentTarget(`postgresql://postgres:secret@${host}:5432/replay`), host.toLowerCase());
  }
  assert.equal(assertFixtureContentTarget("postgresql://postgres:secret@[::1]:5432/replay"), "[::1]");
  for (const host of [
    OLD_PROD,
    OLD_PROD_POOLER,
    "ep-shiny-shape-b8lvr0f5.c-14.us-east-1.aws.neon.tech",
    "localhost.evil.com",
    "127.0.0.1.nip.io",
    "db.internal",
  ]) {
    assert.equal(isLocalHost(host), false, host);
    assert.throws(() => assertFixtureContentTarget(url(host)), SeedGuardError, host);
  }
  // The dev-only guard is unchanged: loopback stays refused there (personas, copies of old prod content).
  assert.throws(() => assertDevTarget("postgresql://postgres:secret@localhost:5432/replay"), SeedGuardError);
});

test("bad target URLs are rejected without echoing the value", () => {
  for (const bad of [undefined, null, "", "   ", "not a url", "https://" + DEV + "/x"]) {
    assert.throws(() => assertDevTarget(bad), (e: unknown) => {
      assert.ok(e instanceof SeedGuardError);
      assert.ok(!e.message.includes("secret"));
      return true;
    });
  }
  assert.throws(() => hostOf("postgresql://user:secret@[bad/neondb"), (e: unknown) => {
    assert.ok(e instanceof SeedGuardError);
    assert.ok(!(e as Error).message.includes("secret"));
    return true;
  });
});

test("source == target is rejected, and so is any dev host as a source", () => {
  assert.throws(() => assertSourceNotTarget(url(DEV), DEV), /equals the target/);
  assert.throws(() => assertSourceNotTarget(url(DEV_POOLER), DEV), /dev endpoint/);
  assert.throws(() => assertSourceNotTarget(url(DEV), DEV.toUpperCase()), /equals the target/);
  assert.throws(() => assertSourceNotTarget(undefined, DEV), SeedGuardError);
  assert.equal(assertSourceNotTarget(url(OLD_PROD), DEV), OLD_PROD);
});

test("user tripwire", () => {
  assert.equal(MAX_TARGET_USERS, 60, "SPEC 11.2 guard 5");
  assert.doesNotThrow(() => assertUserTripwire(0));
  assert.doesNotThrow(() => assertUserTripwire(24));
  assert.doesNotThrow(() => assertUserTripwire(49));
  assert.doesNotThrow(() => assertUserTripwire(60));
  assert.doesNotThrow(() => assertUserTripwire(24n));
  assert.throws(() => assertUserTripwire(61), /looks like production/);
  assert.throws(() => assertUserTripwire(90), /looks like production/);
  assert.throws(() => assertUserTripwire(104n), /looks like production/);
  assert.throws(() => assertUserTripwire(Number.NaN), SeedGuardError);
  assert.throws(() => assertUserTripwire(-1), SeedGuardError);
  assert.throws(() => assertUserTripwire(5, 4), /looks like production/);
});

test("resolveEnvVar reports whether the value came from the file or the shell", () => {
  assert.equal(DEV_ENV_FILE, ".env.development.local");
  assert.deepEqual(resolveEnvVar("DIRECT_URL", undefined, "a"), { value: "a", origin: "file" });
  assert.deepEqual(resolveEnvVar("DIRECT_URL", "", "a"), { value: "a", origin: "file" });
  assert.deepEqual(resolveEnvVar("DIRECT_URL", "a", "a"), { value: "a", origin: "shell" });
  assert.deepEqual(resolveEnvVar("DIRECT_URL", "b", undefined), { value: "b", origin: "shell" });
  assert.deepEqual(resolveEnvVar("DIRECT_URL", "b", "a"), { value: "b", origin: "shell (differs from file)" });
  assert.throws(() => resolveEnvVar("DIRECT_URL", undefined, undefined), /DIRECT_URL is not set/);
});
