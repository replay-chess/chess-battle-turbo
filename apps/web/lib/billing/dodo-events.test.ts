import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { eventTimeOf, handleDodoEvent, unwrapDodoEvent, type DodoEventDeps } from "./dodo-events";
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
