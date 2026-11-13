// Phase-04 plan 8.5.1, 12.3 ("Activation: entitled → active; recorded failure → failed; Dodo self-heal path (mocked
// SDK) → active; foreign subscription id (different clerkUserId) → stays pending") at the logic level. The route,
// `rc_act` and the SQL run on Postgres in test/api/billing.contract.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trialEntitlementFixture } from "@repo/contracts/http/fixtures/p04";
import { ApiError } from "@/lib/api/api-error";
import type { ApplyOptions, ApplyOutcome } from "@/lib/billing/entitlement";
import type { EntitlementSummary } from "@/lib/billing/entitlement-rules";
import type { DodoApi, DodoSubscription } from "@/lib/billing/dodo-api";
import { viewerFixture } from "@/test/helpers/route-harness";
import { maskEmail, resolveActivation, shortReference, type ActivationDeps, type ActivationRow } from "./billing";

const NOW = new Date("2026-11-05T12:00:30.000Z");
const PENDING_AT = new Date("2026-11-05T12:00:00.000Z");
const viewer = viewerFixture({
  clerkUserId: "user_me",
  entitlement: { member: false, entitled: false, state: "none", status: null, planKey: null, interval: null, priceCents: null, trial: { eligible: true } },
  billing: { email: "knight.owl@gmail.com", dodoCustomerId: null, subscriptionId: null },
});

function row(over: Partial<ActivationRow> = {}): ActivationRow {
  return {
    email: "knight.owl@gmail.com",
    dodoCustomerId: null,
    subscriptionProductId: null,
    pendingCheckoutSessionId: "cks_1234567890",
    pendingCheckoutPlan: "monthly",
    pendingCheckoutAt: PENDING_AT,
    trialOfferedAt: PENDING_AT,
    lastPaymentFailedAt: null,
    ...over,
  };
}

const trialSummary: EntitlementSummary = {
  entitled: true,
  plan: "player",
  planKey: "monthly",
  interval: "month",
  priceCents: 499,
  status: "active",
  subscriptionId: "sub_8F2KXQ9PQ1",
  currentPeriodEnd: "2026-11-12T12:00:00.000Z",
  cancelAtPeriodEnd: false,
  trial: { active: true, used: true, endsAt: "2026-11-12T12:00:00.000Z", daysLeft: 7 },
};

const sub = (over: Partial<DodoSubscription> = {}): DodoSubscription => ({
  subscription_id: "sub_8F2KXQ9PQ1",
  product_id: "pdt_monthly",
  status: "active",
  next_billing_date: "2026-11-12T12:00:00.000Z",
  cancel_at_next_billing_date: false,
  created_at: "2026-11-05T12:00:05.000Z",
  trial_period_days: 7,
  customer: { customer_id: "cus_1", email: "knight.owl@gmail.com" },
  metadata: { clerkUserId: "user_me" },
  ...over,
});

type Seen = { applies: { snapshot: DodoSubscription; options: ApplyOptions }[]; limits: number; refreshes: number; warns: string[] };

function deps(r: ActivationRow | null, over: Partial<ActivationDeps> & { api?: Partial<DodoApi> | null; allow?: boolean; outcome?: ApplyOutcome } = {}) {
  const { api: apiOver, allow = true, outcome, ...rest } = over;
  const seen: Seen = { applies: [], limits: 0, refreshes: 0, warns: [] };
  const api: DodoApi = {
    createCheckoutSession: async () => {
      throw new Error("unused");
    },
    listSubscriptions: async () => [],
    retrieveSubscription: async () => sub(),
    retrieveCheckoutSession: async () => ({ paymentStatus: null }),
    cancelAtNextBillingDate: async () => {},
    ...apiOver,
  };
  const d: ActivationDeps = {
    readRow: async () => r,
    dodo: async () => (apiOver === null ? null : api),
    allowDodoCheck: async () => (seen.limits++, allow),
    apply: async (snapshot, options) => {
      seen.applies.push({ snapshot, options });
      return outcome ?? { status: "applied", changed: true, userId: 1n, userRef: "cviewer", entitlement: trialSummary };
    },
    refresh: async () => (seen.refreshes++, trialSummary),
    toWire: () => trialEntitlementFixture,
    warn: (m) => void seen.warns.push(m),
    ...rest,
  };
  return { d, seen };
}

const opts = { dodo: true, now: NOW };

describe("resolveActivation", () => {
  it("an entitled viewer is active with no statement (via db)", async () => {
    let reads = 0;
    const member = viewerFixture();
    const out = await resolveActivation(member, {}, opts, deps(row(), { readRow: async () => (reads++, row()) }).d);
    assert.equal(out.data.state, "active");
    assert.equal(out.via, "db");
    assert.equal(reads, 0);
    assert.equal(out.data.reference, "sub_fixture", "an 11-character id is shown whole");
    assert.equal(out.data.emailMasked, "f•••@example.test");
    assert.deepEqual(out.data.plan, { interval: "month", priceCents: 499, legacy: false });
  });

  it("a failure recorded after the pending checkout started → failed {declined}; an older one does not count", async () => {
    const failed = await resolveActivation(viewer, {}, opts, deps(row({ lastPaymentFailedAt: new Date(PENDING_AT.getTime() + 1) })).d);
    assert.deepEqual([failed.data.state, failed.data.reason], ["failed", "declined"]);
    const older = deps(row({ lastPaymentFailedAt: new Date(PENDING_AT.getTime() - 60_000) }), { allow: false });
    assert.equal((await resolveActivation(viewer, {}, opts, older.d)).data.state, "pending");
  });

  it("regression: decline-blocks-self-heal (FIX-1): after a recorded decline, Dodo's subscription_id or Check Again still find a later success", async () => {
    const declinedRow = row({ lastPaymentFailedAt: new Date(PENDING_AT.getTime() + 1_000) });
    // Dodo's return with the second card's subscription: asked at once, applied through the CAS → active.
    const ret = deps(declinedRow);
    const healed = await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, ret.d);
    assert.deepEqual([healed.data.state, healed.via, healed.dodoCalled], ["active", "self_heal", true]);
    assert.equal(ret.seen.applies.length, 1);
    // Check Again (force=1, no subscription_id): the checkout session says succeeded → refresh → active.
    const again = deps(declinedRow, { api: { retrieveCheckoutSession: async () => ({ paymentStatus: "succeeded" }) } });
    const forced = await resolveActivation(viewer, { force: "1" }, opts, again.d);
    assert.deepEqual([forced.data.state, forced.via, again.seen.refreshes], ["active", "self_heal", 1]);
    // Dodo still says nothing paid → the decline stands.
    const still = deps(declinedRow, { outcome: { status: "unchanged", changed: false, userId: 1n, userRef: "cviewer", entitlement: { ...trialSummary, entitled: false } } as never });
    const failed = await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, still.d);
    assert.deepEqual([failed.data.state, failed.data.reason, failed.dodoCalled], ["failed", "declined", true]);
    // The passive poll (neither) never asks Dodo after a decline.
    const passive = deps(declinedRow);
    const p = await resolveActivation(viewer, {}, opts, passive.d);
    assert.deepEqual([p.data.state, p.dodoCalled, passive.seen.limits], ["failed", false, 0]);
  });

  it("the RSC first paint (dodo: false) never asks Dodo or the limiter", async () => {
    const { d, seen } = deps(row());
    const out = await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, { dodo: false, now: NOW }, d);
    assert.equal(out.data.state, "pending");
    assert.equal(out.dodoCalled, false);
    assert.equal(seen.limits, 0);
  });

  it("before 6 s, or when the dodo-activation bucket says no, the answer is pending without Dodo", async () => {
    const early = deps(row({ pendingCheckoutAt: new Date(NOW.getTime() - 5_000) }));
    assert.equal((await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, early.d)).dodoCalled, false);
    assert.equal(early.seen.limits, 0);
    const limited = deps(row(), { allow: false });
    const out = await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, limited.d);
    assert.deepEqual([out.data.state, out.dodoCalled, limited.seen.limits], ["pending", false, 1]);
  });

  it("self-heal: the viewer's subscription is applied through the CAS with the subscription's own time → active", async () => {
    const { d, seen } = deps(row());
    const out = await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, d);
    assert.deepEqual([out.data.state, out.via, out.dodoCalled], ["active", "self_heal", true]);
    assert.deepEqual(seen.applies[0]!.options, { source: "api", userId: 1n, eventTime: new Date("2026-11-05T12:00:05.000Z") });
    assert.equal(out.data.entitlement, trialEntitlementFixture);
    assert.equal(out.data.reference, "sub_8F2K…Q1");
    assert.equal(out.data.waitedMs, 30_000);
  });

  it("a stale CAS answer that is entitled is still active (a webhook won the race)", async () => {
    const { d } = deps(row(), { outcome: { status: "stale", changed: false, userId: 1n, userRef: "c", entitlement: trialSummary } });
    assert.equal((await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, d)).data.state, "active");
  });

  it("a foreign subscription (another clerkUserId) is never applied: pending", async () => {
    const { d, seen } = deps(row(), { api: { retrieveSubscription: async () => sub({ metadata: { clerkUserId: "user_other" } }) } });
    const out = await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, d);
    assert.equal(out.data.state, "pending");
    assert.equal(seen.applies.length, 0);
    assert.equal(seen.warns.length, 1);
    // Without metadata the email (or the linked customer) decides.
    const byEmail = deps(row(), { api: { retrieveSubscription: async () => sub({ metadata: null, customer: { customer_id: "cus_x", email: "Knight.Owl@gmail.com" } }) } });
    assert.equal((await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, byEmail.d)).data.state, "active");
    const stranger = deps(row(), { api: { retrieveSubscription: async () => sub({ metadata: null, customer: { customer_id: "cus_x", email: "x@y.z" } }) } });
    assert.equal((await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, stranger.d)).data.state, "pending");
  });

  it("the checkout session path: failed / cancelled → failed; succeeded → the P1 refresh → active", async () => {
    const failed = deps(row(), { api: { retrieveCheckoutSession: async () => ({ paymentStatus: "failed" }) } });
    assert.deepEqual(
      [(await resolveActivation(viewer, {}, opts, failed.d)).data.state, (await resolveActivation(viewer, {}, opts, failed.d)).data.reason],
      ["failed", "declined"],
    );
    const cancelled = deps(row(), { api: { retrieveCheckoutSession: async () => ({ paymentStatus: "cancelled" }) } });
    assert.equal((await resolveActivation(viewer, {}, opts, cancelled.d)).data.reason, "cancelled");
    const ok = deps(row(), { api: { retrieveCheckoutSession: async () => ({ paymentStatus: "succeeded" }) } });
    const out = await resolveActivation(viewer, {}, opts, ok.d);
    assert.deepEqual([out.data.state, out.via, ok.seen.refreshes], ["active", "self_heal", 1]);
    const waiting = deps(row(), { api: { retrieveCheckoutSession: async () => ({ paymentStatus: "processing" }) } });
    assert.equal((await resolveActivation(viewer, {}, opts, waiting.d)).data.state, "pending");
  });

  it("a Dodo failure is silent on a poll and a 502 upstream_unavailable on Check Again (force=1)", async () => {
    const boom = { retrieveSubscription: async () => Promise.reject(Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" })) };
    const polled = deps(row(), { api: boom });
    assert.equal((await resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1" }, opts, polled.d)).data.state, "pending");
    const forced = deps(row(), { api: boom, allow: false });
    await assert.rejects(resolveActivation(viewer, { subscription_id: "sub_8F2KXQ9PQ1", force: "1" }, opts, forced.d), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "upstream_unavailable");
      assert.deepEqual(err.details, { provider: "dodo", kind: "timeout" });
      return true;
    });
    assert.equal(forced.seen.limits, 0, "force bypasses the per-user Dodo bucket");
  });

  it("no Dodo key: pending on a poll, 503 not_configured on Check Again", async () => {
    assert.equal((await resolveActivation(viewer, { subscription_id: "s" }, opts, deps(row(), { api: null }).d)).data.state, "pending");
    await assert.rejects(resolveActivation(viewer, { subscription_id: "s", force: "1" }, opts, deps(row(), { api: null }).d), (e: unknown) => e instanceof ApiError && e.code === "not_configured");
  });

  it("pending data: the trial this checkout offered gives chargeDate = pendingCheckoutAt + 7 d; the plan from pendingCheckoutPlan", async () => {
    const out = await resolveActivation(viewer, {}, { dodo: false, now: NOW }, deps(row({ pendingCheckoutPlan: "yearly" })).d);
    assert.deepEqual(out.data.trial, { active: false, endsAt: null, chargeDate: "2026-11-12T12:00:00.000Z" });
    assert.deepEqual(out.data.plan, { interval: "year", priceCents: 5000, legacy: false });
    assert.equal(out.data.emailMasked, "k•••@gmail.com");
    assert.equal(out.data.reference, "cks_1234…90");
    const paid = await resolveActivation(viewer, {}, { dodo: false, now: NOW }, deps(row({ trialOfferedAt: null })).d);
    assert.equal(paid.data.trial.chargeDate, null);
    const none = await resolveActivation(viewer, {}, { dodo: false, now: NOW }, deps(null).d);
    assert.deepEqual([none.data.state, none.data.waitedMs, none.data.plan], ["pending", 0, null]);
  });
});

describe("maskEmail / shortReference", () => {
  it("masks to the first character and the domain; shortens ids to 8 + … + 2", () => {
    assert.equal(maskEmail("knight@gmail.com"), "k•••@gmail.com");
    assert.equal(maskEmail("nope"), null);
    assert.equal(maskEmail(null), null);
    assert.equal(shortReference("sub_8F2KXQ9PQ1"), "sub_8F2K…Q1");
    assert.equal(shortReference("sub_short"), "sub_short");
    assert.equal(shortReference(undefined), null);
  });
});
