import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoreSubscription } from "@/lib/stores/useUserStore";
import type { EntitlementSummary } from "./entitlement-rules";
import {
  CANCELLATION_FEEDBACK_VALUES,
  availablePlanChanges,
  cancellationRejection,
  decidePlanChange,
  formatMembershipDate,
  formatMinorUnits,
  isPlanChangeRejection,
  mapPlanChangePreview,
  mergeEntitlementIntoStore,
  normalizeCancellationFeedback,
  resumeRejection,
} from "./subscription-action-rules";

describe("availablePlanChanges", () => {
  it("offers monthly members a prorated upgrade to yearly", () => {
    assert.deepEqual(availablePlanChanges("monthly"), [
      {
        target: "yearly",
        kind: "upgrade",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
      },
    ]);
  });

  it("offers yearly members a downgrade that waits for renewal", () => {
    assert.deepEqual(availablePlanChanges("yearly"), [
      {
        target: "monthly",
        kind: "downgrade",
        effectiveAt: "next_billing_date",
        prorationBillingMode: "do_not_bill",
      },
    ]);
  });

  it("treats both new products as upgrades for legacy members", () => {
    const changes = availablePlanChanges("legacy");
    assert.deepEqual(
      changes.map((c) => [c.target, c.kind, c.effectiveAt]),
      [
        ["yearly", "upgrade", "immediately"],
        ["monthly", "upgrade", "immediately"],
      ],
    );
  });

  it("offers nothing without a recognised plan", () => {
    assert.deepEqual(availablePlanChanges(null), []);
  });
});

describe("decidePlanChange", () => {
  it("rejects switching to the current plan", () => {
    const decision = decidePlanChange("monthly", "active", "monthly");
    assert.ok(isPlanChangeRejection(decision));
    assert.equal(decision.status, 409);
    assert.equal(decision.code, "same_plan");
  });

  it("rejects changes on subscriptions that are not active", () => {
    for (const status of ["on_hold", "past_due", "paused", "cancelled", null]) {
      const decision = decidePlanChange("monthly", status, "yearly");
      assert.ok(isPlanChangeRejection(decision), `status ${status}`);
      assert.equal(decision.code, "not_active");
    }
    const held = decidePlanChange("monthly", "on_hold", "yearly");
    assert.ok(isPlanChangeRejection(held));
    assert.match(held.message, /payment/i);
  });

  it("upgrades monthly to yearly immediately with proration", () => {
    const decision = decidePlanChange("monthly", "active", "yearly");
    assert.ok(!isPlanChangeRejection(decision));
    assert.equal(decision.kind, "upgrade");
    assert.equal(decision.effectiveAt, "immediately");
    assert.equal(decision.prorationBillingMode, "prorated_immediately");
  });

  it("schedules yearly to monthly for the next billing date without billing", () => {
    const decision = decidePlanChange("yearly", "active", "monthly");
    assert.ok(!isPlanChangeRejection(decision));
    assert.equal(decision.kind, "downgrade");
    assert.equal(decision.effectiveAt, "next_billing_date");
    assert.equal(decision.prorationBillingMode, "do_not_bill");
  });

  it("moves legacy and unknown products to a new product immediately", () => {
    for (const current of ["legacy", null] as const) {
      const decision = decidePlanChange(current, "active", "monthly");
      assert.ok(!isPlanChangeRejection(decision));
      assert.equal(decision.kind, "upgrade");
      assert.equal(decision.target, "monthly");
    }
  });
});

describe("cancellation and resume guards", () => {
  it("only cancels once, and never an ended subscription", () => {
    assert.equal(cancellationRejection("active", false), null);
    assert.equal(cancellationRejection("on_hold", false), null);
    assert.equal(cancellationRejection("active", true)?.status, 409);
    assert.equal(cancellationRejection("expired", false)?.status, 409);
    assert.equal(cancellationRejection("cancelled", false)?.status, 409);
  });

  it("only resumes a scheduled cancellation", () => {
    assert.equal(resumeRejection("active", true), null);
    assert.equal(resumeRejection("active", false)?.status, 409);
    assert.match(resumeRejection("cancelled", true)?.message ?? "", /pricing/);
    assert.equal(resumeRejection("expired", true)?.status, 409);
  });
});

describe("normalizeCancellationFeedback", () => {
  it("accepts only the SDK feedback values", () => {
    for (const value of CANCELLATION_FEEDBACK_VALUES) {
      assert.equal(normalizeCancellationFeedback(value), value);
    }
    assert.equal(normalizeCancellationFeedback("TOO_EXPENSIVE"), undefined);
    assert.equal(normalizeCancellationFeedback(""), undefined);
    assert.equal(normalizeCancellationFeedback(42), undefined);
    assert.equal(normalizeCancellationFeedback(undefined), undefined);
  });
});

describe("mapPlanChangePreview", () => {
  const resolve = (productId: string | null) =>
    productId === "pdt_y"
      ? { planKey: "yearly" as const, interval: "year" as const, priceCents: 5000 }
      : { planKey: null, interval: null, priceCents: null };

  it("flattens the SDK response", () => {
    const preview = mapPlanChangePreview(
      {
        immediate_charge: {
          effective_at: "2026-09-10T12:00:00Z",
          line_items: [
            {
              id: "li_1",
              type: "subscription",
              name: "Player (Yearly)",
              description: null,
              quantity: 1,
              unit_price: 5000,
              proration_factor: 1,
              tax: 0,
              currency: "USD",
            },
            { id: "li_2", type: "meter", name: "Usage", subtotal: 0 },
          ],
          // Dodo reports credits as a signed net movement; negative means credit
          // was consumed to offset the charge.
          summary: { currency: "USD", total_amount: 4501, tax: 0, customer_credits: -499 },
        },
        new_plan: {
          product_id: "pdt_y",
          next_billing_date: "2027-09-10T12:00:00Z",
          status: "active",
        },
      },
      resolve,
    );

    assert.equal(preview.immediateChargeCents, 4501);
    assert.equal(preview.currency, "USD");
    assert.equal(preview.customerCreditsCents, -499);
    assert.equal(preview.effectiveAt, "2026-09-10T12:00:00Z");
    assert.equal(preview.lineItems.length, 2);
    assert.deepEqual(preview.lineItems[0], {
      type: "subscription",
      name: "Player (Yearly)",
      description: null,
      quantity: 1,
      unitPriceCents: 5000,
      prorationFactor: 1,
      taxCents: 0,
    });
    assert.equal(preview.lineItems[1]!.unitPriceCents, null);
    assert.deepEqual(preview.newPlan, {
      productId: "pdt_y",
      planKey: "yearly",
      interval: "year",
      priceCents: 5000,
      nextBillingDate: "2027-09-10T12:00:00Z",
      status: "active",
    });
  });

  it("returns nulls when the response is missing pieces", () => {
    const preview = mapPlanChangePreview({}, resolve);
    assert.equal(preview.immediateChargeCents, null);
    assert.equal(preview.currency, null);
    assert.equal(preview.effectiveAt, null);
    assert.deepEqual(preview.lineItems, []);
    assert.equal(preview.newPlan.productId, null);
    assert.equal(preview.newPlan.planKey, null);
  });
});

describe("formatting", () => {
  it("formats minor units in the given currency", () => {
    assert.equal(formatMinorUnits(4501, "USD"), "$45.01");
    assert.equal(formatMinorUnits(5000, null), "$50.00");
    assert.equal(formatMinorUnits(1234, "not-a-currency"), "12.34 not-a-currency");
  });

  it("formats membership dates and tolerates bad input", () => {
    assert.equal(formatMembershipDate("2026-09-10T12:00:00.000Z"), "Sep 10, 2026");
    assert.equal(formatMembershipDate("nope"), "—");
    assert.equal(formatMembershipDate(null), "—");
  });
});

describe("mergeEntitlementIntoStore", () => {
  const entitlement: EntitlementSummary = {
    entitled: true,
    plan: "player",
    planKey: "yearly",
    interval: "year",
    priceCents: 5000,
    status: "active",
    subscriptionId: "sub_1",
    currentPeriodEnd: "2027-09-10T12:00:00.000Z",
    cancelAtPeriodEnd: false,
  };

  it("keeps store-only fields and rewrites the entitlement ones", () => {
    const current: StoreSubscription = {
      plan: "player",
      entitled: true,
      paywall: true,
      customerId: "cus_1",
      status: "active",
      cancelAtPeriodEnd: true,
      subscription: {
        id: "sub_1",
        status: "active",
        productId: "pdt_m",
        nextBillingDate: "2026-10-10T12:00:00.000Z",
        planKey: "monthly",
        interval: "month",
        priceCents: 499,
      },
    };
    const merged = mergeEntitlementIntoStore(current, entitlement);
    assert.equal(merged.customerId, "cus_1");
    assert.equal(merged.paywall, true);
    assert.equal(merged.cancelAtPeriodEnd, false);
    assert.equal(merged.currentPeriodEnd, entitlement.currentPeriodEnd);
    assert.equal(merged.subscription?.planKey, "yearly");
    assert.equal(merged.subscription?.priceCents, 5000);
    assert.equal(merged.subscription?.productId, "pdt_m");
    assert.equal(merged.subscription?.nextBillingDate, entitlement.currentPeriodEnd);
  });

  it("builds a store entry from nothing and drops details when access ends", () => {
    const fresh = mergeEntitlementIntoStore(null, entitlement);
    assert.equal(fresh.entitled, true);
    assert.equal(fresh.subscription?.id, "sub_1");
    assert.equal(fresh.subscription?.productId, "");

    const ended = mergeEntitlementIntoStore(fresh, {
      ...entitlement,
      entitled: false,
      plan: null,
      status: null,
      subscriptionId: null,
    });
    assert.equal(ended.entitled, false);
    assert.equal(ended.subscription, undefined);
  });
});
