// The signed Dodo webhooks of the e2e specs (fixtures/dodo-webhook.ts) are what the webhook route accepts: a valid
// Standard Webhooks signature over the exact body, a `subscription.active` the handler's snapshot schema parses, and a
// `payment.failed` whose identifying keys the failure store resolves by (plan §7.5.3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { subscriptionSnapshotSchema, unwrapDodoEvent } from "../../lib/billing/dodo-events";
import { paidSubscription, paymentData, signDodoWebhook, trialSubscription } from "./dodo-webhook";

const KEY = `whsec_${Buffer.from("dodo-webhook-fixture-test-key-0123").toString("base64")}`;
const INPUT = { clerkUserId: "user_e2e", customerId: "cus_e2e", email: "e2e@example.test", productId: "pdt_monthly" };

describe("dodo-webhook fixture", () => {
  it("signs the exact body with Standard Webhooks headers the route verifies; the handler parses the snapshot", () => {
    const at = new Date();
    const signed = signDodoWebhook("subscription.active", trialSubscription({ ...INPUT, at }), { key: KEY, id: "msg_1", at });
    const event = unwrapDodoEvent(signed.body, signed.headers, KEY);
    assert.equal(event.type, "subscription.active");
    const snapshot = subscriptionSnapshotSchema.parse(event.data);
    assert.equal(snapshot.customer.customer_id, "cus_e2e");
    assert.equal(signed.headers["webhook-id"], "msg_1");
    assert.equal(signed.headers["webhook-timestamp"], String(Math.floor(at.getTime() / 1000)));
    assert.throws(() => new Webhook(KEY).verify(signed.body.replace("active", "on_hold"), signed.headers));
  });

  it("refuses to sign without a key (never sends an unsigned webhook)", () => {
    const previous = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    try {
      assert.throws(() => signDodoWebhook("payment.failed", {}), /DODO_PAYMENTS_WEBHOOK_KEY/);
    } finally {
      if (previous !== undefined) process.env.DODO_PAYMENTS_WEBHOOK_KEY = previous;
    }
  });

  it("a trial snapshot bills in 7 days; a paid one after the plan's period; both carry the Clerk id", () => {
    const at = new Date("2026-11-12T10:00:00Z");
    const trial = trialSubscription({ ...INPUT, at });
    assert.equal(trial.status, "active");
    assert.equal(trial.trial_period_days, 7);
    assert.equal(Date.parse(trial.next_billing_date) - at.getTime(), 7 * 86_400_000);
    assert.deepEqual(trial.metadata, { clerkUserId: "user_e2e" });
    assert.deepEqual(trial.customer, { customer_id: "cus_e2e", email: "e2e@example.test" });
    const year = paidSubscription({ ...INPUT, at, interval: "Year", subscriptionId: trial.subscription_id });
    assert.equal(year.subscription_id, trial.subscription_id);
    assert.equal(Date.parse(year.next_billing_date) - at.getTime(), 365 * 86_400_000);
    assert.equal(year.payment_frequency_interval, "Year");
  });

  it("payment data carries every key the failure store resolves a member by", () => {
    const failed = paymentData({ ...INPUT, subscriptionId: "sub_1", checkoutSessionId: "cks_1", totalAmount: 0, errorCode: "CARD_DECLINED" });
    assert.deepEqual(failed.metadata, { clerkUserId: "user_e2e" });
    assert.deepEqual(failed.customer, { customer_id: "cus_e2e", email: "e2e@example.test" });
    assert.equal(failed.subscription_id, "sub_1");
    assert.equal(failed.checkout_session_id, "cks_1");
    assert.equal(failed.error_code, "CARD_DECLINED");
    assert.equal(paymentData(INPUT).total_amount, 499);
    assert.equal("error_code" in paymentData(INPUT), false);
  });
});
