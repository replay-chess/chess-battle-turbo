/**
 * Phase-04 BIL-1 / BIL-2 / WH-1 contract (plan 7.5, 8.4, 8.5, 12.3) against a real Postgres after `prisma migrate
 * deploy`, through the route handlers with route()'s seams and recording fakes for Dodo, the socket emit and PostHog:
 *
 * - checkout: 200 CheckoutData with the trial for an eligible user; none for a ledger hit on the email or on a
 *   verified handle; still offered for an unverified-handle hit; pendingCheckout* / trialOfferedAt recorded;
 *   onboardingStep advanced (monotonically) only for `source: onboarding`; the return URL per source; the
 *   Idempotency-Key replays (`Idempotent-Replayed: true`, one Dodo session) and is required; entitled → 409;
 *   a Dodo failure → 502 with nothing recorded and the key released for a retry;
 * - activation: entitled → active + `rc_act` (verifies for this user only); a recorded failure → failed; the Dodo
 *   self-heal → active, the row written through the CAS and the fan-out queued in after(); a foreign subscription →
 *   pending with nothing written; GET purity (a pending poll writes nothing);
 * - webhook: `payment.failed` records the failure (newest only) and emits `entitlement:changed {paymentFailed}`; the
 *   duplicate-trial guard cancels the second trial at Dodo, keeps the first subscription and writes the audit row.
 *
 * Skipped unless TEST_DATABASE_URL is set (a throwaway local Postgres; never Neon).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { ActivationData, CheckoutData } from "@repo/contracts/http/billing";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { EntitlementChangedEvent } from "@repo/contracts/socket/user";
import {
  billingWorld,
  dodoSubscription,
  installFakes,
  makeFakes,
  primeEnv,
  signedDodo,
  TEST_URL,
  type Handlers,
} from "../helpers/billing-world";
import { jsonOf } from "../helpers/route-harness";

primeEnv();

describe("P4 billing routes: contract (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = billingWorld();
  const fakes = makeFakes();
  let restore: () => void = () => {};
  let CHECKOUT!: Handlers;
  let ACTIVATION!: Handlers;
  let WEBHOOK!: Handlers;
  let ledger!: typeof import("@/lib/billing/trial-ledger");
  let claim!: typeof import("@/lib/onboarding/claim-cookie");

  before(async () => {
    restore = await installFakes(fakes);
    CHECKOUT = (await import("@/app/api/checkout/route")) as Handlers;
    ACTIVATION = (await import("@/app/api/billing/activation/route")) as Handlers;
    WEBHOOK = (await import("@/app/api/webhook/dodo-payments/route")) as Handlers;
    ledger = await import("@/lib/billing/trial-ledger");
    claim = await import("@/lib/onboarding/claim-cookie");
  });
  beforeEach(() => fakes.reset());
  after(async () => {
    restore();
    await w.teardown();
  });

  const checkout = (viewer: ReturnType<typeof w.viewerOf>, body: unknown, key: string | null = randomUUID()) =>
    w.call(CHECKOUT.POST!, viewer, { method: "POST", path: "/api/checkout", body, headers: key ? { "idempotency-key": key } : {} });

  async function userRow(id: bigint) {
    const rows = await w.db.$queryRawUnsafe<
      {
        pendingCheckoutSessionId: string | null;
        pendingCheckoutPlan: string | null;
        pendingCheckoutAt: Date | null;
        lastCheckoutSource: string | null;
        trialOfferedAt: Date | null;
        onboardingStep: string;
        subscriptionStatus: string | null;
        subscriptionId: string | null;
        lastPaymentFailedAt: Date | null;
        lastPaymentFailureReason: string | null;
        updatedAt: Date;
      }[]
    >(
      `SELECT "pendingCheckoutSessionId", "pendingCheckoutPlan", "pendingCheckoutAt", "lastCheckoutSource", "trialOfferedAt",
              "onboardingStep"::text AS "onboardingStep", "subscriptionStatus", "subscriptionId", "lastPaymentFailedAt",
              "lastPaymentFailureReason", "updatedAt"
         FROM users WHERE id = $1`,
      id,
    );
    return rows[0]!;
  }

  async function errorOf(res: Response, status: number, code: string) {
    assert.equal(res.status, status, await res.clone().text());
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const body = ErrorEnvelope.parse(await jsonOf(res));
    assert.equal(body.error.code, code);
    return body.error;
  }

  describe("POST /api/checkout", () => {
    it("an eligible user: 200 CheckoutData with the trial; the row records the pending checkout; pricing leaves the step alone", async () => {
      const u = await w.makeUser();
      const { res } = await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing", returnPath: "/review/cabc" });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      const data = ok(CheckoutData).parse(await res.json()).data;
      assert.equal(data.trial, true);
      assert.equal(data.priceCents, 499);
      assert.equal(data.interval, "month");
      assert.ok(data.chargeDate);
      const s = fakes.sessions[0]!;
      assert.deepEqual(s.customer, { email: u.email, name: u.name }, "the email and name come from the users row");
      assert.equal(s.trialDays, 7);
      const ret = new URL(s.returnUrl);
      assert.equal(ret.pathname, "/checkout/activating");
      assert.equal(ret.searchParams.get("redirect_url"), "/review/cabc");
      const r = await userRow(u.id);
      assert.equal(r.pendingCheckoutSessionId, data.sessionId);
      assert.equal(r.pendingCheckoutPlan, "monthly");
      assert.equal(r.lastCheckoutSource, "pricing");
      assert.ok(r.pendingCheckoutAt && r.trialOfferedAt);
      assert.equal(r.trialOfferedAt!.getTime(), r.pendingCheckoutAt!.getTime());
      assert.equal(r.onboardingStep, "WELCOME");
    });

    it("source onboarding moves the step to ACTIVATING (monotonic: DONE stays DONE) and returns to /onboarding/activating", async () => {
      const atPlan = await w.makeUser({ onboardingStep: "PLAN" });
      const { res } = await checkout(w.viewerOf(atPlan), { plan: "yearly", source: "onboarding" });
      assert.equal(res.status, 200);
      assert.equal((await userRow(atPlan.id)).onboardingStep, "ACTIVATING");
      assert.equal(new URL(fakes.sessions[0]!.returnUrl).pathname, "/onboarding/activating");
      const done = await w.makeUser({ onboardingStep: "DONE" });
      assert.equal((await checkout(w.viewerOf(done), { plan: "monthly", source: "onboarding" })).res.status, 200);
      assert.equal((await userRow(done.id)).onboardingStep, "DONE");
    });

    it("a ledger hit on the normalised email: no trial, the fraud signal is sent after the response", async () => {
      const tag = randomUUID().slice(0, 6);
      const u = await w.makeUser({ email: `kas.parov.${tag}@gmail.com` });
      // The first trial was taken as kasparov<tag>+old@googlemail.com: the same person after normalisation.
      await w.db.$executeRawUnsafe(`INSERT INTO trial_ledger ("emailHash") VALUES ($1)`, ledger.trialLedgerEmailHash(`kasparov${tag}+old@googlemail.com`));
      const { res, recorded } = await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing" });
      const data = ok(CheckoutData).parse(await res.json()).data;
      assert.deepEqual([data.trial, data.chargeDate], [false, null]);
      assert.equal(fakes.sessions[0]!.trialDays, null);
      assert.equal((await userRow(u.id)).trialOfferedAt, null);
      await w.runAfter(recorded);
      assert.deepEqual(fakes.events.map((e) => [e.event, e.props.kind, e.who]), [["trial_ledger_hit", "email", u.ref]]);
    });

    it("a verified handle in the ledger denies the trial; an unverified one does not (D4-10)", async () => {
      const handle = `owl${randomUUID().slice(0, 6)}`;
      await w.db.$executeRawUnsafe(
        `INSERT INTO trial_ledger ("emailHash", "handleHashes") VALUES ($1, $2::text[])`,
        ledger.trialLedgerEmailHash(`someone-else-${handle}@example.test`),
        [ledger.handleHash("lichess", handle, true), ledger.handleHash("chesscom", handle, false)],
      );
      const verified = await w.makeUser();
      await w.linkAccount(verified.id, "LICHESS", handle, true);
      assert.equal(ok(CheckoutData).parse(await (await checkout(w.viewerOf(verified), { plan: "monthly", source: "pricing" })).res.json()).data.trial, false);
      const unverified = await w.makeUser();
      await w.linkAccount(unverified.id, "CHESSCOM", handle, false);
      assert.equal(ok(CheckoutData).parse(await (await checkout(w.viewerOf(unverified), { plan: "monthly", source: "pricing" })).res.json()).data.trial, true);
    });

    it("the Idempotency-Key replays the same session (one Dodo call) and is required", async () => {
      const u = await w.makeUser();
      const key = randomUUID();
      const first = await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing" }, key);
      const again = await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing" }, key);
      assert.equal(again.res.status, 200);
      assert.equal(again.res.headers.get("idempotent-replayed"), "true");
      assert.deepEqual(ok(CheckoutData).parse(await again.res.json()).data, ok(CheckoutData).parse(await first.res.json()).data);
      assert.equal(fakes.sessions.length, 1);
      await errorOf((await checkout(w.viewerOf(u), { plan: "yearly", source: "pricing" }, key)).res, 422, "idempotency_key_reused");
      await errorOf((await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing" }, null)).res, 400, "validation_failed");
    });

    it("an entitled viewer → 409 already_subscribed; a Dodo failure → 502 with nothing recorded and the key free to retry", async () => {
      const member = await w.makeUser();
      await errorOf((await checkout(w.viewerOf(member, true), { plan: "monthly", source: "pricing" })).res, 409, "already_subscribed");
      const u = await w.makeUser();
      const key = randomUUID();
      fakes.createError = Object.assign(new Error("socket hang up"), { name: "APIConnectionError" });
      const failed = await errorOf((await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing" }, key)).res, 502, "upstream_unavailable");
      assert.deepEqual(failed.details, { provider: "dodo", kind: "error" });
      assert.ok(!JSON.stringify(failed).includes("hang up"), "never the raw Dodo message");
      assert.equal((await userRow(u.id)).pendingCheckoutSessionId, null);
      fakes.createError = null;
      assert.equal((await checkout(w.viewerOf(u), { plan: "monthly", source: "pricing" }, key)).res.status, 200, "a 5xx releases the key");
    });
  });

  describe("GET /api/billing/activation", () => {
    // The real clock: the pending checkouts below are written with the database's now().
    const activation = (viewer: ReturnType<typeof w.viewerOf>, query = "") =>
      w.call(ACTIVATION.GET!, viewer, { path: `/api/billing/activation${query}`, now: Date.now() });

    it("entitled → active and the 120 s rc_act cookie, valid for this Clerk user only", async () => {
      const u = await w.makeUser();
      const { res, recorded } = await activation(w.viewerOf(u, true));
      assert.equal(res.status, 200);
      assert.equal(ok(ActivationData).parse(await res.json()).data.state, "active");
      const cookie = res.headers.get("set-cookie") ?? "";
      assert.match(cookie, /^rc_act=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=120; HttpOnly; SameSite=Lax/);
      const value = cookie.split(";")[0]!.slice("rc_act=".length);
      const secret = claim.claimCookieSecret(process.env);
      assert.equal(await claim.verifyClaimCookie("act", value, u.googleId, Date.now(), secret), true);
      assert.equal(await claim.verifyClaimCookie("act", value, "user_someone_else", Date.now(), secret), false);
      assert.equal(await claim.verifyClaimCookie("onb", value, u.googleId, Date.now(), secret), false);
      assert.equal(await claim.verifyClaimCookie("act", value, u.googleId, Date.now() + 121_000, secret), false, "120 s only");
      await w.runAfter(recorded);
      assert.deepEqual(recorded.claimsSyncs, [u.id], "an active answer syncs the claims (FIX-1)");
    });

    it("a recorded failure after the checkout → failed {declined}; no cookie", async () => {
      const u = await w.makeUser();
      await w.db.$executeRawUnsafe(
        `UPDATE users SET "pendingCheckoutSessionId" = 'cks_x', "pendingCheckoutPlan" = 'monthly', "pendingCheckoutAt" = (now() AT TIME ZONE 'UTC') - interval '20 seconds',
                          "lastPaymentFailedAt" = (now() AT TIME ZONE 'UTC') - interval '5 seconds' WHERE id = $1`,
        u.id,
      );
      const { res, recorded } = await activation(w.viewerOf(u));
      const data = ok(ActivationData).parse(await res.json()).data;
      assert.deepEqual([data.state, data.reason], ["failed", "declined"]);
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal(recorded.afterTasks.length, 0, "no claims sync for a failure");
    });

    it("GET purity: a pending poll (before the 6 s Dodo window) writes nothing", async () => {
      const u = await w.makeUser();
      await w.db.$executeRawUnsafe(
        `UPDATE users SET "pendingCheckoutSessionId" = 'cks_y', "pendingCheckoutPlan" = 'monthly', "pendingCheckoutAt" = (now() AT TIME ZONE 'UTC') WHERE id = $1`,
        u.id,
      );
      const before = await userRow(u.id);
      const { res, recorded } = await activation(w.viewerOf(u), "?subscription_id=sub_unknown");
      assert.equal(ok(ActivationData).parse(await res.json()).data.state, "pending");
      assert.deepEqual(await userRow(u.id), before);
      assert.equal(fakes.retrieves.length, 0);
      assert.equal(recorded.afterTasks.length, 0);
    });

    it("self-heal: the viewer's subscription is applied through the CAS → active + rc_act, and the fan-out is queued", async () => {
      const u = await w.makeUser();
      await w.db.$executeRawUnsafe(
        `UPDATE users SET "pendingCheckoutSessionId" = 'cks_z', "pendingCheckoutPlan" = 'monthly', "pendingCheckoutAt" = (now() AT TIME ZONE 'UTC') - interval '10 seconds',
                          "trialOfferedAt" = (now() AT TIME ZONE 'UTC') - interval '10 seconds' WHERE id = $1`,
        u.id,
      );
      const sub = dodoSubscription({ email: u.email, clerkUserId: u.googleId });
      fakes.subscriptions.set(sub.subscription_id, sub);
      const { res, recorded } = await activation(w.viewerOf(u), `?subscription_id=${sub.subscription_id}&status=active`);
      const data = ok(ActivationData).parse(await res.json()).data;
      assert.equal(data.state, "active");
      assert.equal(data.entitlement.entitled, true);
      assert.equal(data.entitlement.trial.active, true);
      assert.ok(res.headers.get("set-cookie")?.startsWith("rc_act="));
      const r = await userRow(u.id);
      assert.deepEqual([r.subscriptionId, r.subscriptionStatus], [sub.subscription_id, "active"]);
      // The CAS's post-apply hook queued the fan-out: running it emits entitlement:changed and clears the pending checkout.
      await w.runAfter(recorded);
      const emit = fakes.emits.find((e) => e.event === "entitlement:changed");
      assert.ok(emit, "entitlement:changed emitted");
      assert.deepEqual(emit.targets, [{ userRef: u.ref }]);
      assert.ok(EntitlementChangedEvent.safeParse(emit.data).success);
      assert.equal((await userRow(u.id)).pendingCheckoutSessionId, null);
      // regression: activation-claims-sync (FIX-1): the self-heal syncs the Clerk claims like /api/billing/refresh, so
      // a late or lost webhook cannot leave md.entitled=false behind it.
      assert.deepEqual(recorded.claimsSyncs, [u.id]);
    });

    it("a foreign subscription id (another clerkUserId) stays pending and writes nothing", async () => {
      const u = await w.makeUser();
      await w.db.$executeRawUnsafe(
        `UPDATE users SET "pendingCheckoutSessionId" = 'cks_f', "pendingCheckoutPlan" = 'monthly', "pendingCheckoutAt" = (now() AT TIME ZONE 'UTC') - interval '10 seconds' WHERE id = $1`,
        u.id,
      );
      const foreign = dodoSubscription({ email: "stranger@example.test", clerkUserId: "user_stranger" });
      fakes.subscriptions.set(foreign.subscription_id, foreign);
      const before = await userRow(u.id);
      const { res, recorded } = await activation(w.viewerOf(u), `?subscription_id=${foreign.subscription_id}&force=1`);
      assert.equal(ok(ActivationData).parse(await res.json()).data.state, "pending");
      assert.deepEqual(await userRow(u.id), before);
      assert.equal(recorded.afterTasks.length, 0);
    });
  });

  describe("POST /api/webhook/dodo-payments (phase-4 additions)", () => {
    const deliver = (type: string, data: unknown, opts: { id?: string; at?: Date } = {}) => {
      const signed = signedDodo(type, data, opts);
      return w.call(WEBHOOK.POST!, null, { method: "POST", path: "/api/webhook/dodo-payments", headers: signed.headers, body: signed.body });
    };

    it("payment.failed: the newest failure is recorded by clerkUserId and entitlement:changed {paymentFailed} is emitted", async () => {
      const u = await w.makeUser();
      const at = new Date(Date.now() - 1_000);
      const { res, recorded } = await deliver(
        "payment.failed",
        { payment_id: "pay_1", customer: { customer_id: "cus_nobody", email: u.email }, metadata: { clerkUserId: u.googleId }, error_code: "CARD_DECLINED", total_amount: 499 },
        { at },
      );
      assert.equal(res.status, 200, await res.clone().text());
      const r = await userRow(u.id);
      assert.equal(r.lastPaymentFailedAt?.toISOString(), at.toISOString(), "the event time, not the receipt time");
      assert.equal(r.lastPaymentFailureReason, "card_declined");
      await w.runAfter(recorded);
      const emit = fakes.emits.find((e) => e.event === "entitlement:changed");
      assert.ok(emit);
      assert.equal(emit.data.paymentFailed, true);
      // An older failure delivered late does not move the stored time.
      await deliver("payment.failed", { customer: { email: u.email }, metadata: { clerkUserId: u.googleId } }, { at: new Date(at.getTime() - 60_000) });
      assert.equal((await userRow(u.id)).lastPaymentFailedAt?.getTime(), r.lastPaymentFailedAt?.getTime());
    });

    it("duplicate trial: a second live trial is cancelled at Dodo, the first subscription kept, the audit row written", async () => {
      const u = await w.makeUser();
      const first = dodoSubscription({ email: u.email, clerkUserId: u.googleId });
      assert.equal((await deliver("subscription.active", first)).res.status, 200);
      const second = dodoSubscription({ email: u.email, clerkUserId: u.googleId, customer: { customer_id: first.customer.customer_id, email: u.email } });
      const { res } = await deliver("subscription.active", second);
      assert.equal(res.status, 200);
      assert.deepEqual(fakes.cancels, [second.subscription_id]);
      assert.equal((await userRow(u.id)).subscriptionId, first.subscription_id);
      const audit = await w.db.$queryRawUnsafe<{ action: string; targetId: string }[]>(
        `SELECT action, "targetId" FROM audit_logs WHERE "actorUserId" = $1 AND action = 'billing.duplicate_trial_cancelled'`,
        u.id,
      );
      assert.deepEqual(audit.map((a) => a.targetId), [second.subscription_id]);
      // The same delivery again is a webhook_events duplicate; a later event of the flagged duplicate makes no call.
      await deliver("subscription.updated", { ...second, cancel_at_next_billing_date: true });
      assert.deepEqual(fakes.cancels, [second.subscription_id]);
    });
  });
});
