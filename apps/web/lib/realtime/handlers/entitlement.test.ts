// Phase-04 plan 12.1 (`entitlement.test.ts`): payload → setQueryData; router.refresh() only when visible and the gate
// decision changed; a hidden tab defers to visibilitychange (AP-39); the socket token refresh.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { ActivationData } from "@repo/contracts/http/billing";
import { activationPendingFixture, noneEntitlementFixture, trialEntitlementFixture } from "@repo/contracts/http/fixtures/p04";
import type { MeData } from "@repo/contracts/http/me";
import { qk } from "@/lib/api/keys";
import { applyEntitlementEvent, refreshDecision, refreshRealtimeToken } from "./entitlement";

function seed(member: boolean) {
  const qc = new QueryClient();
  const entitlement = member ? trialEntitlementFixture : noneEntitlementFixture;
  qc.setQueryData(qk.me(), { entitlement, user: { ref: "cme" } } as unknown as MeData);
  qc.setQueryData<ActivationData>(qk.billing.activation("sub_1"), activationPendingFixture);
  qc.setQueryData<ActivationData>(qk.billing.activation("latest"), activationPendingFixture);
  return qc;
}

describe("applyEntitlementEvent", () => {
  it("entitled: me gets the payload's entitlement, every activation query turns active, the gate changed", () => {
    const qc = seed(false);
    const effect = applyEntitlementEvent(qc, { v: 1, entitlement: trialEntitlementFixture, subscriptionUpdatedAt: "2026-11-05T10:00:00.000Z" });
    assert.deepEqual(effect, { gateChanged: true, entitled: true, paymentFailed: false });
    assert.deepEqual(qc.getQueryData<MeData>(qk.me())?.entitlement, trialEntitlementFixture);
    for (const key of ["sub_1", "latest"]) {
      const a = qc.getQueryData<ActivationData>(qk.billing.activation(key))!;
      assert.equal(a.state, "active");
      assert.deepEqual(a.entitlement, trialEntitlementFixture);
      assert.equal(a.trial.active, trialEntitlementFixture.trial.active);
    }
  });

  it("a payment failure leaves the caches to a refetch and changes no gate", async () => {
    const qc = seed(false);
    const effect = applyEntitlementEvent(qc, { v: 1, entitlement: noneEntitlementFixture, subscriptionUpdatedAt: null, paymentFailed: true });
    assert.deepEqual(effect, { gateChanged: false, entitled: false, paymentFailed: true });
    assert.equal(qc.getQueryData<ActivationData>(qk.billing.activation("sub_1"))?.state, "pending");
    assert.equal(qc.getQueryState(qk.billing.activation("sub_1"))?.isInvalidated, true);
  });

  it("no cached viewer: nothing to merge and no gate decision", () => {
    const qc = new QueryClient();
    const effect = applyEntitlementEvent(qc, { v: 1, entitlement: trialEntitlementFixture, subscriptionUpdatedAt: null });
    assert.equal(effect.gateChanged, false);
    assert.equal(qc.getQueryData(qk.me()), undefined);
  });

  it("an unchanged member state (trial → trial) is not a gate change", () => {
    const qc = seed(true);
    assert.equal(applyEntitlementEvent(qc, { v: 1, entitlement: trialEntitlementFixture, subscriptionUpdatedAt: null }).gateChanged, false);
  });
});

describe("refreshDecision", () => {
  it("refresh only in the visible tab, defer in a hidden one, nothing without a gate change", () => {
    assert.equal(refreshDecision({ gateChanged: true }, true), "refresh");
    assert.equal(refreshDecision({ gateChanged: true }, false), "defer");
    assert.equal(refreshDecision({ gateChanged: false }, true), "none");
  });
});

describe("refreshRealtimeToken", () => {
  it("seeds the fresh token and hands it to a live socket; no connection → false", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { token: "tok", expiresAt: 9_999_999_999 } }), { status: 200 })) as typeof fetch;
    try {
      const seen: unknown[] = [];
      const rt = {
        seedToken: (t: unknown) => void seen.push(["seed", t]),
        isLive: () => true,
        command: async (name: string, payload: unknown) => (seen.push([name, payload]), undefined),
      };
      assert.equal(await refreshRealtimeToken(rt as never), true);
      assert.deepEqual(seen, [["seed", { token: "tok", expiresAt: 9_999_999_999 }], ["session:refresh_token", { token: "tok" }]]);
      assert.equal(await refreshRealtimeToken(null), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
