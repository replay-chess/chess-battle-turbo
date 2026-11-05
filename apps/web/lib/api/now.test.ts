import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overriddenNow, resolveNow } from "./now";

const headers = (h: Record<string, string>) => new Headers(h);
const AT = "1893456000000";
const ON = { NEXT_PUBLIC_APP_ENV: "dev", ALLOW_TEST_HOOKS: "1", E2E_TEST_TOKEN: "e2e-token-1" };
const clock = () => 1_700_000_000_000;

describe("x-rc-now (CT X5)", () => {
  it("honoured with the token in dev and test", () => {
    for (const appEnv of ["dev", "test"]) {
      const now = resolveNow(headers({ "x-rc-now": AT, "x-e2e-token": "e2e-token-1" }), { ...ON, NEXT_PUBLIC_APP_ENV: appEnv }, clock);
      assert.equal(now.getTime(), Number(AT));
    }
  });
  it("ignored without the token or with a wrong one", () => {
    assert.equal(resolveNow(headers({ "x-rc-now": AT }), ON, clock).getTime(), clock());
    assert.equal(resolveNow(headers({ "x-rc-now": AT, "x-e2e-token": "e2e-token-2" }), ON, clock).getTime(), clock());
  });
  it("ignored when E2E_TEST_TOKEN is unset (an empty token never matches)", () => {
    const env = { ...ON, E2E_TEST_TOKEN: undefined };
    assert.equal(resolveNow(headers({ "x-rc-now": AT, "x-e2e-token": "" }), env, clock).getTime(), clock());
  });
  it("ignored in production and without ALLOW_TEST_HOOKS", () => {
    const h = headers({ "x-rc-now": AT, "x-e2e-token": "e2e-token-1" });
    assert.equal(overriddenNow(h, { ...ON, NEXT_PUBLIC_APP_ENV: "production" }), null);
    assert.equal(overriddenNow(h, { ...ON, ALLOW_TEST_HOOKS: undefined }), null);
    assert.equal(overriddenNow(h, { ...ON, VERCEL_ENV: "production", NEXT_PUBLIC_APP_ENV: undefined }), null);
  });
  it("rejects malformed or out-of-range values", () => {
    for (const bad of ["abc", "-5", "1e12", "12", "99999999999999"]) {
      assert.equal(overriddenNow(headers({ "x-rc-now": bad, "x-e2e-token": "e2e-token-1" }), ON), null, bad);
    }
  });
});
