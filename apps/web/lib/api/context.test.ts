import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appEnvName, defaultMemberDenialReason, getRouteDeps, serverBuildId } from "./context";
import { reasonFor } from "@/lib/auth/membership";

// The viewer rules themselves are tested in lib/auth/{membership,viewer}.test.ts (1B·F4a).
describe("viewer defaults (1B·F4a)", () => {
  it("the 402 reason is membership.ts's reasonFor", () => {
    assert.equal(defaultMemberDenialReason, reasonFor);
    assert.equal(getRouteDeps().memberDenialReason, reasonFor);
  });
  it("the reasons follow plan §8.3", () => {
    const trial = { used: false, eligible: true };
    assert.equal(defaultMemberDenialReason({ entitlement: { state: "none", trial, paymentIssue: null } } as never), "trial_available");
    const used = { used: true, eligible: false };
    assert.equal(
      defaultMemberDenialReason({ entitlement: { state: "lapsed", trial: used, paymentIssue: { state: "expired" } } } as never),
      "payment_failed",
    );
    assert.equal(
      defaultMemberDenialReason({ entitlement: { state: "lapsed", trial: used, paymentIssue: null }, billing: { neverPaid: true } } as never),
      "trial_used",
    );
    assert.equal(
      defaultMemberDenialReason({ entitlement: { state: "lapsed", trial: used, paymentIssue: null }, billing: { neverPaid: false } } as never),
      "expired",
    );
  });
});

describe("build info", () => {
  it("appEnvName maps unknown/unset to local", () => {
    assert.equal(appEnvName({ NEXT_PUBLIC_APP_ENV: "dev" }), "dev");
    assert.equal(appEnvName({ NEXT_PUBLIC_APP_ENV: "staging" }), "local");
    assert.equal(appEnvName({}), "local");
  });
  it("serverBuildId prefers the server commit sha", () => {
    assert.equal(serverBuildId({ VERCEL_GIT_COMMIT_SHA: "abc", NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "def" }), "abc");
    assert.equal(serverBuildId({}), "dev");
  });
});
