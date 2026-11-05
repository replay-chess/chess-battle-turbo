import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatchesSecret, isPerfBypassRequest, tokenMatchesSecret } from "./secrets";

test("tokenMatchesSecret: equal values match", () => {
  assert.equal(tokenMatchesSecret("s3cret-value", "s3cret-value"), true);
});

test("tokenMatchesSecret: different value of the same length fails", () => {
  assert.equal(tokenMatchesSecret("s3cret-valuX", "s3cret-value"), false);
});

test("tokenMatchesSecret: different length fails without throwing", () => {
  assert.equal(tokenMatchesSecret("short", "s3cret-value"), false);
  assert.equal(tokenMatchesSecret("s3cret-value-longer", "s3cret-value"), false);
});

test("tokenMatchesSecret: empty token or empty secret fails", () => {
  assert.equal(tokenMatchesSecret("", "s3cret-value"), false);
  assert.equal(tokenMatchesSecret("s3cret-value", ""), false);
  assert.equal(tokenMatchesSecret("", ""), false);
});

test("tokenMatchesSecret: undefined or null secret fails", () => {
  assert.equal(tokenMatchesSecret("anything", undefined), false);
  assert.equal(tokenMatchesSecret("anything", null), false);
  assert.equal(tokenMatchesSecret(null, "s3cret-value"), false);
  assert.equal(tokenMatchesSecret(undefined, undefined), false);
});

test("tokenMatchesSecret: multi-byte characters compare by bytes", () => {
  assert.equal(tokenMatchesSecret("pässwörd", "pässwörd"), true);
  // 8 characters vs 10, but both are 10 bytes: the byte compare decides.
  assert.equal(tokenMatchesSecret("pässwörd", "passwordxx"), false);
  // Same character count, different byte length.
  assert.equal(tokenMatchesSecret("pässwörd", "password"), false);
});

test("bearerMatchesSecret", () => {
  assert.equal(bearerMatchesSecret("Bearer abc123", "abc123"), true);
  assert.equal(bearerMatchesSecret("bearer abc123", "abc123"), true);
  assert.equal(bearerMatchesSecret("Bearer abc124", "abc123"), false);
  assert.equal(bearerMatchesSecret("abc123", "abc123"), false);
  assert.equal(bearerMatchesSecret("Bearer ", "abc123"), false);
  assert.equal(bearerMatchesSecret(null, "abc123"), false);
  assert.equal(bearerMatchesSecret("Bearer abc123", undefined), false);
});

// AA F-11 / plan §11.6: PERF_AUTH_BYPASS needs test hooks AND a matching x-perf-token. The paywall
// (require-subscription.ts) and identity (resolve-user.ts) both call this helper.
const perfReq = (token?: string) => ({ headers: new Headers(token === undefined ? {} : { "x-perf-token": token }) });
const PERF_ON = { PERF_AUTH_BYPASS: "true", PERF_TOKEN: "perf-tok-123", NEXT_PUBLIC_APP_ENV: "dev", ALLOW_TEST_HOOKS: "1" };

test("isPerfBypassRequest: honoured with bypass, test hooks and the right token", () => {
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), PERF_ON), true);
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, NEXT_PUBLIC_APP_ENV: "test" }), true);
});

test("isPerfBypassRequest: a raw PERF_AUTH_BYPASS is not enough", () => {
  assert.equal(isPerfBypassRequest(perfReq(), PERF_ON), false);
  assert.equal(isPerfBypassRequest(perfReq("wrong-token-1"), PERF_ON), false);
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, PERF_TOKEN: undefined }), false);
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, PERF_AUTH_BYPASS: "1" }), false);
});

test("isPerfBypassRequest: ignored in production and without ALLOW_TEST_HOOKS", () => {
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, NEXT_PUBLIC_APP_ENV: "production" }), false);
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, NEXT_PUBLIC_APP_ENV: undefined }), false);
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, ALLOW_TEST_HOOKS: undefined }), false);
  assert.equal(isPerfBypassRequest(perfReq("perf-tok-123"), { ...PERF_ON, VERCEL_ENV: "development", NEXT_PUBLIC_APP_ENV: "production" }), false);
});

test("require-subscription.ts uses the fenced helper, never a raw PERF_AUTH_BYPASS read", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./require-subscription.ts", import.meta.url), "utf8");
  assert.match(src, /isPerfBypassRequest\(request\)/);
  assert.doesNotMatch(src, /process\.env\.PERF_AUTH_BYPASS/);
});
