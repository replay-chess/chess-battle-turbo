import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeEntitlement } from "../billing/entitlement-rules";
import {
  entitlementOf,
  isPaywallEnabled,
  membershipOf,
  membershipStateOf,
  neverPaidOf,
  paywallUrlFor,
  reasonFor,
  upgradeUrlFor,
  type MembershipRecord,
} from "./membership";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const H = 3_600_000;
const DAY = 24 * H;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const catalog = { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] };
const opts = { now: NOW, paywallEnabled: true, catalog };

function record(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    role: "USER",
    dodoCustomerId: null,
    plan: null,
    planInterval: null,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionProductId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    ...overrides,
  };
}

const sub = (overrides: Partial<MembershipRecord> = {}) =>
  record({ subscriptionId: "sub_1", subscriptionStatus: "active", subscriptionProductId: "pdt_y", currentPeriodEnd: at(200 * DAY), ...overrides });

describe("membershipStateOf (plan §8.2)", () => {
  const state = (r: MembershipRecord) => membershipStateOf(summarizeEntitlement(r, catalog, NOW));
  it("trial wins over cancelling", () => {
    assert.equal(state(sub({ trialStartedAt: at(-DAY), trialEndsAt: at(6 * DAY), cancelAtPeriodEnd: true })), "trial");
  });
  it("grace for entitled on_hold / past_due; cancelling; member", () => {
    assert.equal(state(sub({ subscriptionStatus: "on_hold", currentPeriodEnd: at(DAY) })), "grace");
    assert.equal(state(sub({ subscriptionStatus: "past_due", currentPeriodEnd: at(DAY) })), "grace");
    assert.equal(state(sub({ cancelAtPeriodEnd: true })), "cancelling");
    assert.equal(state(sub({ subscriptionStatus: "cancelled", cancelAtPeriodEnd: true })), "cancelling");
    assert.equal(state(sub()), "member");
  });
  it("lapsed after a trial or any subscription; none otherwise", () => {
    assert.equal(state(record({ trialStartedAt: at(-30 * DAY), trialEndsAt: at(-23 * DAY) })), "lapsed");
    assert.equal(state(sub({ subscriptionStatus: "expired", currentPeriodEnd: at(-DAY) })), "lapsed");
    assert.equal(state(record()), "none");
  });
});

describe("entitlementOf", () => {
  it("member = !paywall || admin || entitled; planKey, interval and price from the catalog", () => {
    const e = membershipOf(sub(), opts).entitlement;
    assert.equal(e.member, true);
    assert.equal(e.planKey, "yearly");
    assert.equal(e.interval, "year");
    assert.equal(e.priceCents, 5000);
    assert.equal(membershipOf(record({ role: "ADMIN" }), opts).entitlement.member, true);
    assert.equal(membershipOf(record(), { ...opts, paywallEnabled: false }).entitlement.member, true);
    assert.equal(membershipOf(record(), opts).entitlement.member, false);
  });
  it("legacy product → planKey legacy", () => {
    assert.equal(membershipOf(sub({ subscriptionProductId: "pdt_old" }), opts).entitlement.planKey, "legacy");
  });
  it("hasBillingPortal follows the customer id passed in (refresh links it)", () => {
    const summary = summarizeEntitlement(sub(), catalog, NOW);
    assert.equal(entitlementOf(summary, { role: "USER", dodoCustomerId: null, now: NOW, paywallEnabled: true }).hasBillingPortal, false);
    assert.equal(entitlementOf(summary, { role: "USER", dodoCustomerId: "cus", now: NOW, paywallEnabled: true }).hasBillingPortal, true);
  });
  it("expired payment issue: failed / on_hold / past_due within 30 days of the period end, not entitled", () => {
    assert.equal(membershipOf(sub({ subscriptionStatus: "failed", currentPeriodEnd: at(-29 * DAY) }), opts).entitlement.paymentIssue?.state, "expired");
    assert.equal(membershipOf(sub({ subscriptionStatus: "on_hold", currentPeriodEnd: at(-DAY) }), opts).entitlement.paymentIssue?.state, "expired");
    assert.equal(membershipOf(sub({ subscriptionStatus: "failed", currentPeriodEnd: at(-31 * DAY) }), opts).entitlement.paymentIssue, null);
    assert.equal(membershipOf(sub({ subscriptionStatus: "cancelled", currentPeriodEnd: at(-DAY) }), opts).entitlement.paymentIssue, null);
  });
  it("last_day at ≤ 36 h, banner above", () => {
    assert.equal(membershipOf(sub({ subscriptionStatus: "past_due", currentPeriodEnd: at(36 * H) }), opts).entitlement.paymentIssue?.state, "last_day");
    assert.equal(membershipOf(sub({ subscriptionStatus: "past_due", currentPeriodEnd: at(37 * H) }), opts).entitlement.paymentIssue?.state, "banner");
  });
});

describe("neverPaidOf", () => {
  it("no subscription → true; a trial that ended with its subscription → true; a paid period after the trial → false", () => {
    assert.equal(neverPaidOf(record()), true);
    assert.equal(neverPaidOf(sub({ trialEndsAt: at(-3 * DAY), currentPeriodEnd: at(-3 * DAY) })), true);
    assert.equal(neverPaidOf(sub({ trialEndsAt: at(-40 * DAY), currentPeriodEnd: at(-10 * DAY) })), false);
    assert.equal(neverPaidOf(sub({ currentPeriodEnd: at(-10 * DAY) })), false);
  });
});

describe("reasonFor (plan §8.3)", () => {
  const reason = (r: MembershipRecord) => reasonFor(membershipOf(r, opts));
  it("trial_available: never subscribed", () => {
    assert.equal(reason(record()), "trial_available");
  });
  it("trial_used: lapsed after a trial that never converted", () => {
    assert.equal(
      reason(sub({ subscriptionStatus: "cancelled", trialStartedAt: at(-10 * DAY), trialEndsAt: at(-3 * DAY), currentPeriodEnd: at(-3 * DAY) })),
      "trial_used",
    );
    assert.equal(reason(record({ trialStartedAt: at(-10 * DAY), trialEndsAt: at(-3 * DAY) })), "trial_used");
  });
  it("payment_failed: inside the expired payment-issue window", () => {
    assert.equal(reason(sub({ subscriptionStatus: "failed", currentPeriodEnd: at(-2 * DAY) })), "payment_failed");
  });
  it("expired: any other lapse", () => {
    assert.equal(reason(sub({ subscriptionStatus: "expired", currentPeriodEnd: at(-60 * DAY) })), "expired");
    assert.equal(
      reason(sub({ subscriptionStatus: "cancelled", trialStartedAt: at(-400 * DAY), trialEndsAt: at(-393 * DAY), currentPeriodEnd: at(-40 * DAY) })),
      "expired",
    );
  });
  it("regression: ledger-402-reason (FIX-2): never subscribed but the ledger knows them (a ledger-aware viewer) → trial_used", () => {
    assert.equal(reasonFor({ entitlement: { state: "none", trial: { used: false, eligible: false }, paymentIssue: null } }), "trial_used");
    assert.equal(reasonFor({ entitlement: { state: "none", trial: { used: false, eligible: true }, paymentIssue: null } }), "trial_available");
  });
  it("without billing facts trial_used falls back to expired (never guesses never-paid)", () => {
    assert.equal(reasonFor({ entitlement: { state: "lapsed", trial: { used: true, eligible: false }, paymentIssue: null } }), "expired");
  });
});

describe("paywall URLs and the switch", () => {
  it("required for the trial offer, ended for every lapse", () => {
    assert.equal(upgradeUrlFor("trial_available"), "/pricing?reason=required");
    for (const r of ["trial_used", "expired", "payment_failed"] as const) assert.equal(upgradeUrlFor(r), "/pricing?reason=ended");
  });
  it("redirect_url only for same-site paths", () => {
    assert.equal(paywallUrlFor("expired", "/play?x=1"), "/pricing?reason=ended&redirect_url=%2Fplay%3Fx%3D1");
    assert.equal(paywallUrlFor("expired", "//evil.example"), "/pricing?reason=ended");
    assert.equal(paywallUrlFor("expired", "https://evil.example"), "/pricing?reason=ended");
    assert.equal(paywallUrlFor("trial_available", null), "/pricing?reason=required");
  });
  it("isPaywallEnabled: only BILLING_PAYWALL=off (any case) turns it off", () => {
    assert.equal(isPaywallEnabled({}), true);
    assert.equal(isPaywallEnabled({ BILLING_PAYWALL: "OFF" }), false);
    assert.equal(isPaywallEnabled({ BILLING_PAYWALL: "on" }), true);
  });
});
