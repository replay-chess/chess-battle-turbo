import { test } from "node:test";
import assert from "node:assert/strict";
import { testHooksEnabled } from "./env-server";

test("testHooksEnabled ignores VERCEL_ENV (dev deploys with VERCEL_ENV=production)", () => {
  assert.equal(
    testHooksEnabled({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_ENV: "dev", ALLOW_TEST_HOOKS: "1" }),
    true,
  );
});

test("testHooksEnabled is off on production even with ALLOW_TEST_HOOKS=1", () => {
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "production", ALLOW_TEST_HOOKS: "1" }), false);
});

test("testHooksEnabled is off when nothing is set", () => {
  assert.equal(testHooksEnabled({}), false);
});

test("testHooksEnabled needs ALLOW_TEST_HOOKS=1 in dev", () => {
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "dev" }), false);
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "dev", ALLOW_TEST_HOOKS: "true" }), false);
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "dev", ALLOW_TEST_HOOKS: "0" }), false);
});

test("testHooksEnabled is on in test with ALLOW_TEST_HOOKS=1", () => {
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "test", ALLOW_TEST_HOOKS: "1" }), true);
});

test("testHooksEnabled rejects unknown app envs", () => {
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "staging", ALLOW_TEST_HOOKS: "1" }), false);
  assert.equal(testHooksEnabled({ NEXT_PUBLIC_APP_ENV: "", ALLOW_TEST_HOOKS: "1" }), false);
});
