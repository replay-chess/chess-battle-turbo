import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memberDenial, pageGateRedirect, passesMemberGate } from "./guards";

type GateInput = Parameters<typeof pageGateRedirect>[0];

function viewer(state: string, member: boolean, extra: { onboarded?: boolean; eligible?: boolean; used?: boolean; neverPaid?: boolean } = {}) {
  return {
    user: { onboarded: extra.onboarded ?? true },
    entitlement: {
      state,
      member,
      trial: { used: extra.used ?? false, eligible: extra.eligible ?? false },
      paymentIssue: null,
    },
    billing: { neverPaid: extra.neverPaid ?? false },
  } as unknown as NonNullable<GateInput>;
}

describe("passesMemberGate", () => {
  it("members pass; lapsed only with allowLapsedRead (B26)", () => {
    assert.equal(passesMemberGate(viewer("member", true)), true);
    assert.equal(passesMemberGate(viewer("lapsed", false)), false);
    assert.equal(passesMemberGate(viewer("lapsed", false), { allowLapsedRead: true }), true);
    assert.equal(passesMemberGate(viewer("none", false), { allowLapsedRead: true }), false);
  });
});

describe("memberDenial", () => {
  it("402 subscription_required with reason and upgradeUrl", () => {
    const err = memberDenial(viewer("none", false, { eligible: true }));
    assert.equal(err.status, 402);
    assert.equal(err.code, "subscription_required");
    assert.deepEqual(err.details, { reason: "trial_available", upgradeUrl: "/pricing?reason=required" });
    assert.deepEqual(memberDenial(viewer("lapsed", false, { used: true, neverPaid: true })).details, {
      reason: "trial_used",
      upgradeUrl: "/pricing?reason=ended",
    });
  });
});

describe("pageGateRedirect (requireMemberPage)", () => {
  it("signed out → sign-in with the return path", () => {
    assert.equal(pageGateRedirect(null, { returnTo: "/play" }), "/sign-in?redirect_url=%2Fplay");
    assert.equal(pageGateRedirect(null), "/sign-in");
    assert.equal(pageGateRedirect(null, { returnTo: "//evil.example" }), "/sign-in");
  });
  it("not onboarded → onboarding, unless skipped", () => {
    assert.equal(pageGateRedirect(viewer("member", true, { onboarded: false })), "/onboarding");
    assert.equal(pageGateRedirect(viewer("member", true, { onboarded: false }), { skipOnboarding: true }), null);
  });
  it("non-member → pricing reason=required|ended with redirect_url (B26 default)", () => {
    assert.equal(pageGateRedirect(viewer("none", false, { eligible: true }), { returnTo: "/play" }), "/pricing?reason=required&redirect_url=%2Fplay");
    assert.equal(pageGateRedirect(viewer("lapsed", false, { used: true }), { returnTo: "/play" }), "/pricing?reason=ended&redirect_url=%2Fplay");
  });
  it("member → null (render)", () => {
    assert.equal(pageGateRedirect(viewer("member", true)), null);
  });
});
