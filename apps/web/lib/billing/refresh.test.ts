import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApplyOptions, ApplyOutcome } from "./entitlement";
import type { EntitlementSummary, SubscriptionSnapshot } from "./entitlement-rules";
import { getBillingProvider, refreshMembership, setBillingProvider, type BillingProvider, type RefreshDeps, type RefreshInput } from "./refresh";

const NOW = new Date("2026-11-05T12:00:00.000Z");

const stored: EntitlementSummary = {
  entitled: false,
  plan: null,
  planKey: null,
  interval: null,
  priceCents: null,
  status: null,
  subscriptionId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: { active: false, used: false, endsAt: null, daysLeft: 0 },
};
const fresh: EntitlementSummary = { ...stored, entitled: true, plan: "player", planKey: "monthly", status: "active", subscriptionId: "sub_new" };

const snap = (id: string, status: string, created: string): SubscriptionSnapshot => ({
  subscription_id: id,
  product_id: `pdt_${id}`,
  status,
  next_billing_date: "2026-12-05T00:00:00Z",
  cancel_at_next_billing_date: false,
  created_at: created,
  customer: { customer_id: "cus_1", email: "a@b.test" },
});

const input = (overrides: Partial<RefreshInput> = {}): RefreshInput => ({
  userId: 5n,
  email: "a@b.test",
  dodoCustomerId: "cus_1",
  subscriptionProductId: "pdt_old",
  stored,
  ...overrides,
});

function harness(provider: Partial<BillingProvider>, outcome: ApplyOutcome | (() => ApplyOutcome) = { status: "applied", changed: true, userId: 5n, userRef: "r", entitlement: fresh }) {
  const log = { links: [] as string[], applied: [] as { snapshot: SubscriptionSnapshot; options: ApplyOptions }[], warnings: [] as string[], linkResult: true };
  const deps: RefreshDeps = {
    provider: {
      findCustomerIdByEmail: provider.findCustomerIdByEmail ?? (async () => null),
      listSubscriptions: provider.listSubscriptions ?? (async () => []),
    },
    now: NOW,
    async linkCustomer(_id, customerId) {
      log.links.push(customerId);
      return log.linkResult;
    },
    async apply(snapshot, options) {
      log.applied.push({ snapshot, options });
      return typeof outcome === "function" ? outcome() : outcome;
    },
    warn: (message) => {
      log.warnings.push(message);
    },
  };
  return { deps, log };
}

describe("refreshMembership (plan A19)", () => {
  it("applies the primary subscription (active first) with source api and the viewer's id", async () => {
    const { deps, log } = harness({
      listSubscriptions: async () => [snap("old", "expired", "2026-01-01T00:00:00Z"), snap("new", "active", "2026-10-01T00:00:00Z")],
    });
    const result = await refreshMembership(input(), deps);
    assert.equal(log.applied.length, 1);
    assert.equal(log.applied[0]!.snapshot.subscription_id, "new");
    assert.deepEqual(log.applied[0]!.options, { source: "api", userId: 5n, now: NOW });
    assert.deepEqual(result, { summary: fresh, customerId: "cus_1", productId: "pdt_new", refreshed: true, changed: true });
  });

  it("links the customer by email when the row has none", async () => {
    const { deps, log } = harness({
      findCustomerIdByEmail: async (email) => (email === "a@b.test" ? "cus_found" : null),
      listSubscriptions: async (id) => (id === "cus_found" ? [snap("s", "active", "2026-10-01T00:00:00Z")] : []),
    });
    const result = await refreshMembership(input({ dodoCustomerId: null }), deps);
    assert.deepEqual(log.links, ["cus_found"]);
    assert.equal(result.customerId, "cus_found");
    assert.equal(result.refreshed, true);
  });

  it("no Dodo customer → the stored state, refreshed (Dodo answered)", async () => {
    const { deps, log } = harness({});
    const result = await refreshMembership(input({ dodoCustomerId: null }), deps);
    assert.deepEqual(result, { summary: stored, customerId: null, productId: "pdt_old", refreshed: true, changed: false });
    assert.equal(log.applied.length, 0);
  });

  it("a customer id held by another row is not linked; stored state", async () => {
    const { deps, log } = harness({ findCustomerIdByEmail: async () => "cus_taken" });
    log.linkResult = false;
    const result = await refreshMembership(input({ dodoCustomerId: null }), deps);
    assert.equal(result.customerId, null);
    assert.equal(result.summary, stored);
    assert.equal(log.warnings.length, 1);
  });

  it("Dodo unreachable → the stored state with refreshed: false", async () => {
    const { deps } = harness({
      listSubscriptions: async () => {
        throw new Error("timeout");
      },
    });
    const result = await refreshMembership(input(), deps);
    assert.deepEqual(result, { summary: stored, customerId: "cus_1", productId: "pdt_old", refreshed: false, changed: false });
  });

  it("a stale snapshot (a newer webhook won) returns the stored row's state and product", async () => {
    const { deps } = harness({ listSubscriptions: async () => [snap("s", "active", "2026-10-01T00:00:00Z")] }, {
      status: "stale",
      changed: false,
      userId: 5n,
      userRef: "r",
      entitlement: fresh,
    });
    const result = await refreshMembership(input(), deps);
    assert.equal(result.summary, fresh);
    assert.equal(result.productId, "pdt_old");
    assert.equal(result.refreshed, true);
    assert.equal(result.changed, false);
  });

  it("cas_exhausted → the stored state with refreshed: false", async () => {
    const { deps } = harness({ listSubscriptions: async () => [snap("s", "active", "2026-10-01T00:00:00Z")] }, {
      status: "error",
      changed: false,
      userId: 5n,
      userRef: "r",
      error: "cas_exhausted",
    });
    const result = await refreshMembership(input(), deps);
    assert.equal(result.summary, stored);
    assert.equal(result.refreshed, false);
  });
});

describe("getBillingProvider", () => {
  it("null without DODO_PAYMENTS_API_KEY; the test seam overrides and restores", async () => {
    assert.equal(await getBillingProvider({}), null);
    const fake: BillingProvider = { findCustomerIdByEmail: async () => null, listSubscriptions: async () => [] };
    const restore = setBillingProvider(fake);
    assert.equal(await getBillingProvider({}), fake);
    restore();
    assert.equal(await getBillingProvider({}), null);
  });
});
