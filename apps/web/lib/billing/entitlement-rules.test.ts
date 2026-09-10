import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fieldsFromSnapshot,
  isEntitled,
  pickPrimarySubscription,
  shouldApplySnapshot,
  summarizeEntitlement,
  type EntitlementRecord,
  type SubscriptionSnapshot,
} from "./entitlement-rules";

const NOW = new Date("2026-09-10T12:00:00Z");
const FUTURE = new Date("2026-10-10T12:00:00Z");
const PAST = new Date("2026-08-10T12:00:00Z");

const catalog = { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] };

function record(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    plan: null,
    planInterval: null,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionProductId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    subscription_id: "sub_1",
    product_id: "pdt_m",
    status: "active",
    next_billing_date: FUTURE.toISOString(),
    cancel_at_next_billing_date: false,
    created_at: PAST.toISOString(),
    payment_frequency_interval: "Month",
    customer: { customer_id: "cus_1", email: "a@b.c" },
    ...overrides,
  };
}

describe("isEntitled", () => {
  it("grants access to active subscriptions", () => {
    assert.equal(isEntitled(record({ subscriptionStatus: "active" }), NOW), true);
  });

  it("keeps access until the period ends after a failed renewal", () => {
    for (const status of ["on_hold", "past_due"]) {
      assert.equal(
        isEntitled(record({ subscriptionStatus: status, currentPeriodEnd: FUTURE }), NOW),
        true,
        status,
      );
      assert.equal(
        isEntitled(record({ subscriptionStatus: status, currentPeriodEnd: PAST }), NOW),
        false,
        status,
      );
    }
  });

  it("revokes access for an immediate cancellation even before the period ends", () => {
    // Immediate cancel / refund: Dodo reports `cancelled` with
    // cancel_at_next_billing_date=false and a future next_billing_date.
    assert.equal(
      isEntitled(
        record({ subscriptionStatus: "cancelled", currentPeriodEnd: FUTURE, cancelAtPeriodEnd: false }),
        NOW,
      ),
      false,
    );
  });

  it("keeps access until the period ends for a scheduled cancellation", () => {
    assert.equal(
      isEntitled(
        record({ subscriptionStatus: "cancelled", currentPeriodEnd: FUTURE, cancelAtPeriodEnd: true }),
        NOW,
      ),
      true,
    );
    assert.equal(
      isEntitled(
        record({ subscriptionStatus: "cancelled", currentPeriodEnd: PAST, cancelAtPeriodEnd: true }),
        NOW,
      ),
      false,
    );
    assert.equal(
      isEntitled(
        record({ subscriptionStatus: "cancelled", currentPeriodEnd: null, cancelAtPeriodEnd: true }),
        NOW,
      ),
      false,
    );
  });

  it("denies everything else", () => {
    for (const status of [null, "pending", "paused", "expired", "failed"]) {
      assert.equal(
        isEntitled(record({ subscriptionStatus: status, currentPeriodEnd: FUTURE }), NOW),
        false,
        String(status),
      );
    }
  });
});

describe("fieldsFromSnapshot", () => {
  it("maps a yearly subscription onto the user row", () => {
    const fields = fieldsFromSnapshot(
      snapshot({ product_id: "pdt_y", payment_frequency_interval: "Year" }),
      catalog,
      NOW,
    );
    assert.equal(fields.plan, "player");
    assert.equal(fields.planInterval, "year");
    assert.equal(fields.subscriptionStatus, "active");
    assert.equal(fields.currentPeriodEnd?.toISOString(), FUTURE.toISOString());
    assert.equal(fields.subscriptionUpdatedAt, NOW);
  });

  it("falls back to the billing interval for unknown products", () => {
    const fields = fieldsFromSnapshot(
      snapshot({ product_id: "pdt_other", payment_frequency_interval: "Year" }),
      catalog,
    );
    assert.equal(fields.planInterval, "year");
    assert.equal(fields.plan, "player");
  });

  it("clears the plan for expired subscriptions", () => {
    assert.equal(fieldsFromSnapshot(snapshot({ status: "expired" }), catalog).plan, null);
  });

  it("clears the plan for an immediate cancellation but keeps it for a scheduled one", () => {
    const immediate = fieldsFromSnapshot(
      snapshot({ status: "cancelled", cancel_at_next_billing_date: false }),
      catalog,
    );
    assert.equal(immediate.plan, null);
    assert.equal(immediate.cancelAtPeriodEnd, false);

    const scheduled = fieldsFromSnapshot(
      snapshot({ status: "cancelled", cancel_at_next_billing_date: true }),
      catalog,
    );
    assert.equal(scheduled.plan, "player");
    assert.equal(scheduled.cancelAtPeriodEnd, true);
  });
});

describe("shouldApplySnapshot", () => {
  it("applies when nothing is stored", () => {
    assert.equal(shouldApplySnapshot(record(), snapshot(), NOW, NOW), true);
  });

  it("ignores older events for the same subscription", () => {
    const current = record({ subscriptionId: "sub_1", subscriptionUpdatedAt: NOW });
    assert.equal(shouldApplySnapshot(current, snapshot(), PAST, NOW), false);
    assert.equal(shouldApplySnapshot(current, snapshot(), FUTURE, NOW), true);
    assert.equal(shouldApplySnapshot(current, snapshot(), null, NOW), true);
  });

  it("does not let an old expired subscription overwrite a new active one", () => {
    const current = record({
      subscriptionId: "sub_new",
      subscriptionStatus: "active",
      currentPeriodEnd: FUTURE,
      subscriptionUpdatedAt: NOW,
    });
    const old = snapshot({ subscription_id: "sub_old", status: "expired" });
    assert.equal(shouldApplySnapshot(current, old, FUTURE, NOW), false);
  });

  it("lets a new active subscription replace an expired one", () => {
    const current = record({
      subscriptionId: "sub_old",
      subscriptionStatus: "expired",
      currentPeriodEnd: PAST,
      subscriptionUpdatedAt: PAST,
    });
    assert.equal(shouldApplySnapshot(current, snapshot({ subscription_id: "sub_new" }), NOW, NOW), true);
  });
});

describe("pickPrimarySubscription", () => {
  it("prefers active, then grace period, then newest", () => {
    const expired = snapshot({ subscription_id: "expired", status: "expired", created_at: FUTURE.toISOString() });
    const grace = snapshot({
      subscription_id: "grace",
      status: "cancelled",
      cancel_at_next_billing_date: true,
    });
    const active = snapshot({ subscription_id: "active" });
    assert.equal(pickPrimarySubscription([expired, grace, active], NOW)?.subscription_id, "active");
    assert.equal(pickPrimarySubscription([expired, grace], NOW)?.subscription_id, "grace");
    assert.equal(pickPrimarySubscription([expired], NOW)?.subscription_id, "expired");
    assert.equal(pickPrimarySubscription([], NOW), null);
  });

  it("does not rank an immediately cancelled subscription above a newer ended one", () => {
    const immediate = snapshot({
      subscription_id: "immediate",
      status: "cancelled",
      cancel_at_next_billing_date: false,
      created_at: PAST.toISOString(),
    });
    const expired = snapshot({ subscription_id: "expired", status: "expired", created_at: NOW.toISOString() });
    assert.equal(pickPrimarySubscription([immediate, expired], NOW)?.subscription_id, "expired");
  });
});

describe("summarizeEntitlement", () => {
  it("produces a client-safe summary", () => {
    const summary = summarizeEntitlement(
      record({
        subscriptionId: "sub_1",
        subscriptionStatus: "cancelled",
        subscriptionProductId: "pdt_y",
        planInterval: "year",
        currentPeriodEnd: FUTURE,
        cancelAtPeriodEnd: true,
      }),
      catalog,
      NOW,
    );
    assert.deepEqual(summary, {
      entitled: true,
      plan: "player",
      planKey: "yearly",
      interval: "year",
      priceCents: 5000,
      status: "cancelled",
      subscriptionId: "sub_1",
      currentPeriodEnd: FUTURE.toISOString(),
      cancelAtPeriodEnd: true,
    });
  });
});
