import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { eventTimeOf, failureReasonOf, handleDodoEvent, unwrapDodoEvent, type DodoEventDeps, type DuplicateTrialGuard, type HolderRow, type PaymentFailureStore } from "./dodo-events";
import type { ApplyOutcome } from "./entitlement";

const KEY = `whsec_${Buffer.from("f4b-unit-test-secret-0123456789ab").toString("base64")}`;
const SUB = {
  subscription_id: "sub_1",
  product_id: "pdt_m",
  status: "active",
  next_billing_date: "2026-12-05T00:00:00Z",
  cancel_at_next_billing_date: false,
  customer: { customer_id: "cus_1", email: "a@example.test" },
};

function signed(body: string, id = "msg_1", at = new Date()) {
  const sig = new Webhook(KEY).sign(id, at, body);
  return { "webhook-id": id, "webhook-timestamp": String(Math.floor(at.getTime() / 1000)), "webhook-signature": sig };
}

function deps(result: ApplyOutcome, extra: Partial<DodoEventDeps> = {}) {
  const calls: unknown[] = [];
  const d: Partial<DodoEventDeps> = {
    apply: async (snapshot, options) => (calls.push({ snapshot, options }), result),
    warn: () => {},
    // Every entitled snapshot asks the duplicate guard (FIX-1): no holder here unless a test brings its own guard.
    guard: { findHolder: async () => null, cancelAtNextBillingDate: async () => {}, report: async () => {} },
    ...extra,
  };
  return { d, calls };
}

const entitlement = {} as never;

describe("unwrapDodoEvent (dodo.webhooks.unwrap)", () => {
  const body = JSON.stringify({ type: "subscription.active", timestamp: "2026-11-05T10:00:00Z", data: SUB });
  it("verifies and parses a correctly signed body", () => {
    const event = unwrapDodoEvent(body, signed(body), KEY);
    assert.equal(event.type, "subscription.active");
    assert.equal(eventTimeOf(event)?.toISOString(), "2026-11-05T10:00:00.000Z");
  });
  it("throws on a bad signature, a changed body or a stale timestamp", () => {
    const headers = signed(body);
    assert.throws(() => unwrapDodoEvent(body, { ...headers, "webhook-signature": "v1,AAAA" }, KEY));
    assert.throws(() => unwrapDodoEvent(body.replace("active", "on_hold"), headers, KEY));
    assert.throws(() => unwrapDodoEvent(body, signed(body, "msg_1", new Date(Date.now() - 10 * 60_000)), KEY));
  });
});

describe("handleDodoEvent", () => {
  it("applies a subscription event with the webhook timestamp as the provider time", async () => {
    const { d, calls } = deps({ status: "applied", changed: true, userId: 3n, userRef: "ref_3", entitlement });
    const out = await handleDodoEvent({ type: "subscription.renewed", timestamp: "2026-11-05T10:00:00Z", data: SUB }, d);
    assert.deepEqual(out, { status: "applied", changed: true, userId: 3n, userRef: "ref_3" });
    const { options } = calls[0] as { options: { source: string; eventTime: Date } };
    assert.equal(options.source, "webhook");
    assert.equal(options.eventTime.toISOString(), "2026-11-05T10:00:00.000Z");
  });

  it("maps stale, unmatched and cas_exhausted", async () => {
    const event = { type: "subscription.on_hold", timestamp: "2026-11-05T10:00:00Z", data: SUB };
    assert.equal((await handleDodoEvent(event, deps({ status: "stale", changed: false, userId: 1n, userRef: "r", entitlement }).d)).status, "stale");
    assert.equal((await handleDodoEvent(event, deps({ status: "unmatched", changed: false }).d)).status, "unmatched");
    const err = await handleDodoEvent(event, deps({ status: "error", changed: false, userId: 1n, userRef: "r", error: "cas_exhausted" }).d);
    assert.deepEqual([err.status, err.error], ["error", "cas_exhausted"]);
  });

  it("ignores a subscription event without the subscription fields", async () => {
    const { d, calls } = deps({ status: "unmatched", changed: false });
    const out = await handleDodoEvent({ type: "subscription.active", data: { subscription_id: "x" } }, d);
    assert.equal(out.status, "ignored");
    assert.equal(calls.length, 0);
  });

  it("payment.succeeded links the customer only while the row has none", async () => {
    const links: Array<[bigint, string]> = [];
    const payments = (dodoCustomerId: string | null) => ({
      findByEmail: async () => ({ id: 4n, referenceId: "ref_4", dodoCustomerId }),
      linkCustomer: async (id: bigint, c: string) => (links.push([id, c]), 1),
    });
    const event = { type: "payment.succeeded", data: { customer: { customer_id: "cus_9", email: "a@example.test" } } };
    const linked = await handleDodoEvent(event, { ...deps({ status: "unmatched", changed: false }).d, payments: payments(null) });
    assert.deepEqual([linked.status, linked.changed, linked.userId], ["applied", true, 4n]);
    const already = await handleDodoEvent(event, { ...deps({ status: "unmatched", changed: false }).d, payments: payments("cus_9") });
    assert.equal(already.changed, false);
    assert.deepEqual(links, [[4n, "cus_9"]]);
  });

  it("ignores other event types", async () => {
    assert.equal((await handleDodoEvent({ type: "refund.succeeded", data: {} }, deps({ status: "unmatched", changed: false }).d)).status, "ignored");
  });
});

// ── Phase 4 (plan 7.5.3, 8.4.5) ────────────────────────────────────────────────────────────────────────────────────
describe("handleDodoEvent: payment failures", () => {
  function failures(user: { id: bigint; referenceId: string } | null, written = 1) {
    const seen: { keys: unknown[]; records: unknown[][] } = { keys: [], records: [] };
    const store: PaymentFailureStore = {
      resolveUser: async (keys) => (seen.keys.push(keys), user),
      record: async (...args) => (seen.records.push(args), written),
    };
    return { store, seen };
  }

  it("payment.failed resolves the user by metadata.clerkUserId → customer → subscription → email and records the code", async () => {
    const f = failures({ id: 9n, referenceId: "ref_9" });
    const out = await handleDodoEvent(
      {
        type: "payment.failed",
        timestamp: "2026-11-05T10:00:00Z",
        data: {
          customer: { customer_id: "cus_9", email: "A@Example.test" },
          metadata: { clerkUserId: "user_9" },
          subscription_id: "sub_9",
          error_code: "CARD_DECLINED: insufficient funds",
          total_amount: 0,
        },
      },
      { ...deps({ status: "unmatched", changed: false }).d, failures: f.store },
    );
    assert.deepEqual(out, { status: "applied", changed: true, userId: 9n, userRef: "ref_9", paymentFailed: true });
    assert.deepEqual(f.seen.keys[0], { clerkUserId: "user_9", customerId: "cus_9", subscriptionId: "sub_9", email: "A@Example.test" });
    assert.deepEqual(f.seen.records[0], [9n, new Date("2026-11-05T10:00:00Z"), "card_declined_insufficient_funds"]);
  });

  it("an older, out-of-order failure writes nothing and emits nothing; an unknown payer is unmatched", async () => {
    const older = await handleDodoEvent(
      { type: "payment.failed", timestamp: "2026-11-01T00:00:00Z", data: { customer: { customer_id: "cus_9" } } },
      { ...deps({ status: "unmatched", changed: false }).d, failures: failures({ id: 9n, referenceId: "ref_9" }, 0).store },
    );
    assert.deepEqual(older, { status: "applied", changed: false, userId: 9n, userRef: "ref_9", paymentFailed: false });
    const nobody = await handleDodoEvent(
      { type: "payment.failed", data: { customer: { customer_id: "cus_x" } } },
      { ...deps({ status: "unmatched", changed: false }).d, failures: failures(null).store },
    );
    assert.equal(nobody.status, "unmatched");
  });

  it("subscription.failed applies the snapshot AND records the failure keyed by the subscription", async () => {
    const f = failures({ id: 3n, referenceId: "ref_3" });
    const { d } = deps({ status: "applied", changed: true, userId: 3n, userRef: "ref_3", entitlement });
    const out = await handleDodoEvent(
      { type: "subscription.failed", timestamp: "2026-11-05T10:00:00Z", data: { ...SUB, status: "failed", metadata: { clerkUserId: "user_3" } } },
      { ...d, failures: f.store },
    );
    assert.deepEqual(out, { status: "applied", changed: true, userId: 3n, userRef: "ref_3", paymentFailed: true });
    assert.deepEqual(f.seen.keys[0], { clerkUserId: "user_3", customerId: "cus_1", subscriptionId: "sub_1", email: "a@example.test" });
    assert.equal(f.seen.records[0]![2], "subscription_failed");
  });

  it("failureReasonOf folds provider codes into a short safe token", () => {
    assert.equal(failureReasonOf(null, "payment_failed"), "payment_failed");
    assert.equal(failureReasonOf("  ", "x"), "x");
    assert.equal(failureReasonOf("Do Not Honor!", "x"), "do_not_honor");
    assert.equal(failureReasonOf("a".repeat(300), "x").length, 120);
  });
});

describe("handleDodoEvent: duplicate-trial guard (plan 8.4.5)", () => {
  const TRIAL_SUB = { ...SUB, subscription_id: "sub_Y", trial_period_days: 7, created_at: "2026-11-05T09:00:00Z", next_billing_date: "2099-01-01T00:00:00Z" };
  const holderX: HolderRow = {
    id: 5n,
    referenceId: "ref_5",
    subscriptionId: "sub_X",
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2099-01-01T00:00:00Z"),
  };
  function guard(holder: HolderRow | null) {
    const seen = { cancels: [] as string[], reports: [] as unknown[][] };
    const g: DuplicateTrialGuard = {
      findHolder: async () => holder,
      cancelAtNextBillingDate: async (id) => void seen.cancels.push(id),
      report: async (...args) => void seen.reports.push(args),
    };
    return { g, seen };
  }

  it("a second live trial for a member who holds another entitled subscription is cancelled at its trial end and not applied", async () => {
    const { g, seen } = guard(holderX);
    const { d, calls } = deps({ status: "applied", changed: true, userId: 5n, userRef: "ref_5", entitlement });
    const out = await handleDodoEvent({ type: "subscription.active", timestamp: "2026-11-05T10:00:00Z", data: TRIAL_SUB }, { ...d, guard: g });
    assert.deepEqual(out, { status: "ignored", changed: false, userId: 5n, userRef: "ref_5", error: "duplicate_trial" });
    assert.deepEqual(seen.cancels, ["sub_Y"]);
    assert.equal(seen.reports.length, 1);
    assert.equal(calls.length, 0, "the duplicate is never applied over the kept subscription");
  });

  it("a replay of an already-flagged duplicate makes no second Dodo call and writes no second audit row", async () => {
    const { g, seen } = guard(holderX);
    const out = await handleDodoEvent(
      { type: "subscription.updated", data: { ...TRIAL_SUB, cancel_at_next_billing_date: true } },
      { ...deps({ status: "unmatched", changed: false }).d, guard: g },
    );
    assert.equal(out.error, "duplicate_trial");
    assert.deepEqual(seen.cancels, []);
    assert.equal(seen.reports.length, 0);
  });

  it("regression: duplicate-paid-subscription (FIX-1): a second PAID subscription next to an entitled one is cancelled, not applied, and listed for a refund", async () => {
    const { g, seen } = guard(holderX);
    // The compare-and-set saw the row holding X (entitled) and wrote nothing: status "duplicate" (entitlement.ts).
    const { d, calls } = deps({ status: "duplicate", changed: false, userId: 5n, userRef: "ref_5", entitlement, kept: "sub_X" });
    const PAID = { ...TRIAL_SUB, trial_period_days: 0 };
    const out = await handleDodoEvent({ type: "subscription.active", timestamp: "2026-11-05T10:00:00Z", data: PAID }, { ...d, guard: g });
    assert.deepEqual(out, { status: "ignored", changed: false, userId: 5n, userRef: "ref_5", error: "duplicate_subscription" });
    assert.deepEqual(seen.cancels, ["sub_Y"]);
    assert.deepEqual(seen.reports, [[{ id: 5n, referenceId: "ref_5", subscriptionId: "sub_X" }, "sub_Y", "paid"]]);
    assert.equal(calls.length, 1, "one apply (its own user read decided), nothing written over X");
    // A replay of the already-cancelled duplicate makes no second Dodo call.
    const again = guard(holderX);
    await handleDodoEvent({ type: "subscription.updated", data: { ...PAID, cancel_at_next_billing_date: true } }, { ...deps({ status: "duplicate", changed: false, userId: 5n, userRef: "ref_5", entitlement, kept: "sub_X" }).d, guard: again.g });
    assert.deepEqual(again.seen.cancels, []);
  });

  it("the same subscription, a lapsed holder, no holder, or a snapshot that grants nothing all apply normally", async () => {
    const applied = { status: "applied", changed: true, userId: 5n, userRef: "ref_5", entitlement } as const;
    for (const [holder, data] of [
      [{ ...holderX, subscriptionId: "sub_Y" }, TRIAL_SUB],
      [{ ...holderX, subscriptionStatus: "expired" }, TRIAL_SUB],
      [null, TRIAL_SUB],
      [{ ...holderX, subscriptionStatus: "expired" }, { ...TRIAL_SUB, trial_period_days: 0 }],
      [holderX, { ...TRIAL_SUB, trial_period_days: 0, status: "cancelled", next_billing_date: "2020-01-01T00:00:00Z" }],
    ] as const) {
      const { g, seen } = guard(holder);
      const { d, calls } = deps(applied);
      const out = await handleDodoEvent({ type: "subscription.active", data }, { ...d, guard: g });
      assert.equal(out.status, "applied");
      assert.equal(calls.length, 1);
      assert.deepEqual(seen.cancels, []);
    }
  });

  it("a Dodo failure on the cancel throws (the route answers 500 and Dodo retries the delivery)", async () => {
    const g: DuplicateTrialGuard = {
      findHolder: async () => holderX,
      cancelAtNextBillingDate: async () => {
        throw new Error("dodo down");
      },
      report: async () => {},
    };
    await assert.rejects(handleDodoEvent({ type: "subscription.active", data: TRIAL_SUB }, { ...deps({ status: "unmatched", changed: false }).d, guard: g }));
  });
});

describe("handleDodoEvent: payment.succeeded (phase 4)", () => {
  const payments = { findByEmail: async () => ({ id: 4n, referenceId: "ref_4", dodoCustomerId: "cus_9" }), linkCustomer: async () => 0 };
  it("a paid charge for a user with an unreleased initial import asks for the backlog release", async () => {
    const probes: bigint[] = [];
    const backlog = { pending: async (id: bigint) => (probes.push(id), true) };
    const event = { type: "payment.succeeded", data: { customer: { customer_id: "cus_9", email: "a@example.test" }, total_amount: 499 } };
    const out = await handleDodoEvent(event, { ...deps({ status: "unmatched", changed: false }).d, payments, backlog });
    assert.deepEqual(out, { status: "applied", changed: false, userId: 4n, userRef: "ref_4", releaseBacklog: true });
    assert.deepEqual(probes, [4n]);
  });

  it("a $0 trial authorisation never probes; an already released backlog is not released again", async () => {
    let probed = 0;
    const zero = { type: "payment.succeeded", data: { customer: { customer_id: "cus_9", email: "a@example.test" }, total_amount: 0 } };
    const out = await handleDodoEvent(zero, { ...deps({ status: "unmatched", changed: false }).d, payments, backlog: { pending: async () => (probed++, true) } });
    assert.equal(out.releaseBacklog, undefined);
    assert.equal(probed, 0);
    const paid = { ...zero, data: { ...zero.data, total_amount: 499 } };
    const done = await handleDodoEvent(paid, { ...deps({ status: "unmatched", changed: false }).d, payments, backlog: { pending: async () => false } });
    assert.equal(done.releaseBacklog, undefined);
  });
});
