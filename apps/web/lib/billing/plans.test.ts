import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BILLING_PLANS,
  describePlanPrice,
  formatPrice,
  isPlanKey,
  monthlyEquivalentCents,
  resolvePlanFromProductId,
  yearlySavings,
} from "./plans";

describe("billing catalog", () => {
  it("prices the Player plan at $4.99 monthly and $50 yearly", () => {
    assert.equal(BILLING_PLANS.monthly.priceCents, 499);
    assert.equal(BILLING_PLANS.yearly.priceCents, 5000);
    assert.equal(formatPrice(BILLING_PLANS.monthly.priceCents), "$4.99");
    assert.equal(formatPrice(BILLING_PLANS.yearly.priceCents), "$50");
  });

  it("computes yearly savings against twelve monthly payments", () => {
    const savings = yearlySavings();
    assert.equal(savings.amountCents, 988);
    assert.equal(savings.percent, 16);
    assert.equal(monthlyEquivalentCents(BILLING_PLANS.yearly), 417);
    assert.equal(monthlyEquivalentCents(BILLING_PLANS.monthly), 499);
  });

  it("recognizes plan keys sent from the client", () => {
    assert.equal(isPlanKey("monthly"), true);
    assert.equal(isPlanKey("yearly"), true);
    assert.equal(isPlanKey("player"), false);
    assert.equal(isPlanKey(undefined), false);
  });
});

describe("resolvePlanFromProductId", () => {
  const catalog = {
    monthly: "pdt_monthly",
    yearly: "pdt_yearly",
    legacy: ["pdt_legacy"],
  };

  it("maps the monthly and yearly products", () => {
    const monthly = resolvePlanFromProductId("pdt_monthly", catalog);
    assert.deepEqual(monthly, {
      plan: "player",
      planKey: "monthly",
      interval: "month",
      priceCents: 499,
      legacy: false,
    });
    const yearly = resolvePlanFromProductId("pdt_yearly", catalog);
    assert.equal(yearly?.planKey, "yearly");
    assert.equal(yearly?.interval, "year");
    assert.equal(describePlanPrice(yearly!), "$50/yr");
  });

  it("keeps grandfathered $8 subscribers on the Player plan", () => {
    const legacy = resolvePlanFromProductId("pdt_legacy", catalog);
    assert.equal(legacy?.plan, "player");
    assert.equal(legacy?.legacy, true);
    assert.equal(describePlanPrice(legacy!), "$8/mo");
  });

  it("returns null for unknown or missing products", () => {
    assert.equal(resolvePlanFromProductId("pdt_other", catalog), null);
    assert.equal(resolvePlanFromProductId(null, catalog), null);
    assert.equal(resolvePlanFromProductId("pdt_monthly", {}), null);
  });
});
