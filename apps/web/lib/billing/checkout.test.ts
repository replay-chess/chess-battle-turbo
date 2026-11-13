// Phase-04 plan 7.5.1, 8.4, 12.3 ("Checkout: trial for an eligible user, none for a ledger hit (email), none for a
// verified-handle hit, still offered for an unverified-handle hit; onboardingStep advanced only for source:
// onboarding; return URL per source") at the logic level, with fake dependencies. The SQL runs on Postgres in
// test/api/billing.contract.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api/api-error";
import { viewerFixture } from "@/test/helpers/route-harness";
import { startCheckout, type CheckoutDeps, type CheckoutRecord, type CheckoutUser } from "./checkout";
import { DodoBaseUrlRefusedError } from "./dodo-env";
import type { CheckoutSessionInput, DodoApi } from "./dodo-api";
import { enforcedHashes, type LedgerHandle } from "./trial-ledger";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const PEPPER = "checkout-test-pepper-0123456789abcdef";
const nonMember = viewerFixture({
  entitlement: { member: false, entitled: false, state: "none", status: null, planKey: null, interval: null, priceCents: null, trial: { eligible: true } },
  billing: { dodoCustomerId: null, subscriptionId: null },
});

function user(over: Partial<CheckoutUser> = {}): CheckoutUser {
  return {
    email: "fresh@example.test",
    name: "Fresh Player",
    trialStartedAt: null,
    trialEndsAt: null,
    subscriptionId: null,
    subscriptionStatus: null,
    dodoCustomerId: null,
    handles: [],
    ...over,
  };
}

type Seen = {
  sessions: CheckoutSessionInput[];
  records: CheckoutRecord[];
  reuses: { userId: bigint; source: string; at: Date }[];
  lists: string[];
  hits: string[];
  warns: string[];
};

/** Ledger: a set of email hashes and handle hashes, probed exactly like LEDGER_PROBE_SQL (email OR verified handles). */
function deps(u: CheckoutUser | null, options: Partial<CheckoutDeps> & { ledger?: { emails?: string[]; handles?: string[] }; api?: Partial<DodoApi> | null } = {}) {
  const { ledger, api: apiOver, ...over } = options;
  const seen: Seen = { sessions: [], records: [], reuses: [], lists: [], hits: [], warns: [] };
  const api: DodoApi = {
    createCheckoutSession: async (input) => (seen.sessions.push(input), { sessionId: "cks_1", checkoutUrl: "https://test.checkout.dodopayments.com/cks_1" }),
    listSubscriptions: async (id) => (seen.lists.push(id), []),
    retrieveSubscription: async () => {
      throw new Error("unused");
    },
    retrieveCheckoutSession: async () => ({ paymentStatus: null }),
    cancelAtNextBillingDate: async () => {},
    ...apiOver,
  };
  const d: CheckoutDeps = {
    readUser: async () => u,
    dodo: async () => (apiOver === null ? null : api),
    productId: async (plan) => `pdt_${plan}`,
    checkLedger: async ({ email, handles }) => {
      const { emailHash, handleHashes } = enforcedHashes(email, handles, PEPPER);
      if (ledger?.emails?.includes(emailHash)) return { hit: true, kind: "email" };
      if (handleHashes.some((h) => ledger?.handles?.includes(h))) return { hit: true, kind: "handle" };
      return { hit: false, kind: null };
    },
    onboardingV3: async () => true,
    record: async (r) => void seen.records.push(r),
    recordReuse: async (r) => void seen.reuses.push(r),
    origin: () => "https://dev.example.test",
    ledgerHit: (kind) => void seen.hits.push(kind),
    warn: (m) => void seen.warns.push(m),
    ...over,
  };
  return { d, seen };
}

const body = (over: Partial<Parameters<typeof startCheckout>[1]> = {}) => ({ plan: "monthly" as const, source: "pricing" as const, ...over });

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: unknown) => err instanceof ApiError && err.code === code);
}

describe("startCheckout", () => {
  it("an eligible user gets the 7-day trial, chargeDate = now + 7 d, a session with the users-row email and metadata", async () => {
    const { d, seen } = deps(user());
    const out = await startCheckout(nonMember, body(), NOW, d);
    assert.deepEqual(out, {
      checkoutUrl: "https://test.checkout.dodopayments.com/cks_1",
      sessionId: "cks_1",
      trial: true,
      chargeDate: "2026-11-12T12:00:00.000Z",
      priceCents: 499,
      currency: "USD",
      interval: "month",
    });
    const s = seen.sessions[0]!;
    assert.deepEqual(s.customer, { email: "fresh@example.test", name: "Fresh Player" });
    assert.equal(s.trialDays, 7);
    // regression: D5: Clerk's placeholder never reaches Dodo (it locks the checkout's Full Name to what we send).
    const anon = deps({ ...user(), name: "Anonymous User" });
    await startCheckout(nonMember, body(), NOW, anon.d);
    assert.deepEqual(anon.seen.sessions[0]!.customer, { email: "fresh@example.test", name: undefined });
    assert.equal(s.productId, "pdt_monthly");
    assert.deepEqual(s.metadata, { clerkUserId: "user_fixture", userRef: "cviewer00000000000000000000", plan: "monthly", trial: "yes", source: "pricing" });
    assert.deepEqual(seen.records, [
      { userId: 1n, sessionId: "cks_1", plan: "monthly", at: NOW, source: "pricing", trial: true, checkoutUrl: "https://test.checkout.dodopayments.com/cks_1" },
    ]);
    assert.deepEqual(seen.lists, [], "no Dodo customer: no live guard call");
  });

  it("a ledger hit on the email (a +tag does not dodge it): no trial, the fraud signal fires", async () => {
    const { emailHash } = enforcedHashes("fresh@example.test", [], PEPPER);
    const { d, seen } = deps(user({ email: "Fresh+again@Example.test" }), { ledger: { emails: [emailHash] } });
    const out = await startCheckout(nonMember, body(), NOW, d);
    assert.equal(out.trial, false);
    assert.equal(out.chargeDate, null);
    assert.equal(seen.sessions[0]!.trialDays, null);
    assert.equal(seen.sessions[0]!.metadata.trial, "no");
    assert.deepEqual(seen.hits, ["email"]);
  });

  it("a verified handle in the ledger denies the trial; an unverified one never does (D4-10)", async () => {
    const lichess: LedgerHandle = { provider: "lichess", usernameLower: "knightowl88", verified: true };
    const chesscom: LedgerHandle = { provider: "chesscom", usernameLower: "knightowl_88", verified: false };
    const ledgerHandles = [...enforcedHashes("x@y.z", [lichess], PEPPER).handleHashes];
    // The unverified handle's hash is in the ledger too (written by the trial ledger's record path), with the u: prefix.
    const { handleHash } = await import("./trial-ledger");
    ledgerHandles.push(handleHash("chesscom", "knightowl_88", false, PEPPER));
    const verified = deps(user({ handles: [lichess] }), { ledger: { handles: ledgerHandles } });
    assert.equal((await startCheckout(nonMember, body(), NOW, verified.d)).trial, false);
    assert.deepEqual(verified.seen.hits, ["handle"]);
    const unverified = deps(user({ handles: [chesscom] }), { ledger: { handles: ledgerHandles } });
    assert.equal((await startCheckout(nonMember, body(), NOW, unverified.d)).trial, true);
    assert.deepEqual(unverified.seen.hits, []);
  });

  it("a row that already trialled or subscribed: no trial and no ledger probe", async () => {
    let probes = 0;
    const { d } = deps(user({ trialStartedAt: new Date("2026-01-01T00:00:00Z") }), {
      checkLedger: async () => (probes++, { hit: false, kind: null }),
    });
    assert.equal((await startCheckout(nonMember, body(), NOW, d)).trial, false);
    assert.equal(probes, 0);
  });

  it("the return URL by source: onboarding (v3 on) → /onboarding/activating, else /checkout/activating", async () => {
    const onb = deps(user());
    await startCheckout(nonMember, body({ source: "onboarding" }), NOW, onb.d);
    assert.equal(new URL(onb.seen.sessions[0]!.returnUrl).pathname, "/onboarding/activating");
    const legacyOnb = deps(user(), { onboardingV3: async () => false });
    await startCheckout(nonMember, body({ source: "onboarding", returnPath: "/onboarding?plan=monthly" }), NOW, legacyOnb.d);
    const legacyUrl = new URL(legacyOnb.seen.sessions[0]!.returnUrl);
    assert.equal(legacyUrl.pathname, "/checkout/activating");
    assert.equal(legacyUrl.searchParams.get("redirect_url"), "/onboarding?plan=monthly");
    const paywall = deps(user());
    await startCheckout(nonMember, body({ source: "paywall", returnPath: "/review/cabc", plan: "yearly", theme: "dark" }), NOW, paywall.d);
    const url = new URL(paywall.seen.sessions[0]!.returnUrl);
    assert.equal(url.origin, "https://dev.example.test");
    assert.equal(url.pathname, "/checkout/activating");
    assert.equal(url.searchParams.get("redirect_url"), "/review/cabc");
    assert.equal(url.searchParams.get("plan"), "yearly");
    assert.equal(paywall.seen.sessions[0]!.theme, "dark");
    assert.equal(paywall.seen.records[0]!.source, "paywall");
  });

  it("an entitled viewer → 409 already_subscribed before any read", async () => {
    let reads = 0;
    const { d } = deps(user(), { readUser: async () => (reads++, user()) });
    await rejectsWith(startCheckout(viewerFixture(), body(), NOW, d), "already_subscribed");
    assert.equal(reads, 0);
  });

  it("the live guard runs only for a customer with a non-terminal status: active → 409, on_hold → 402", async () => {
    const lapsed = user({ dodoCustomerId: "cus_1", subscriptionId: "sub_old", subscriptionStatus: "expired", trialStartedAt: new Date(0) });
    const quiet = deps(lapsed, { api: { listSubscriptions: async () => [{ status: "active" } as never] } });
    await startCheckout(nonMember, body(), NOW, quiet.d);
    assert.deepEqual(quiet.seen.lists, [], "terminal status: no Dodo call");
    assert.deepEqual(quiet.seen.sessions[0]!.customer, { customerId: "cus_1" });

    const pending = user({ dodoCustomerId: "cus_1", subscriptionStatus: "on_hold", subscriptionId: "sub_1" });
    await rejectsWith(startCheckout(nonMember, body(), NOW, deps(pending, { api: { listSubscriptions: async () => [{ status: "active" } as never] } }).d), "already_subscribed");
    await rejectsWith(startCheckout(nonMember, body(), NOW, deps(pending, { api: { listSubscriptions: async () => [{ status: "on_hold" } as never] } }).d), "payment_update_required");
    const unreachable = deps(pending, {
      api: {
        listSubscriptions: async () => {
          throw new Error("down");
        },
      },
    });
    assert.equal((await startCheckout(nonMember, body(), NOW, unreachable.d)).sessionId, "cks_1", "a guard failure never blocks a checkout");
    assert.deepEqual(unreachable.seen.warns, ["billing.checkout_guard_unreachable"]);
  });

  it("regression: concurrent-paid-checkout (FIX-1): a checkout already paid in another tab blocks a second session; an open or failed one does not", async () => {
    const pending = { pendingCheckoutSessionId: "cks_first", pendingCheckoutAt: new Date(NOW.getTime() - 60_000) };
    const lapsed = user({ trialStartedAt: new Date("2026-01-01T00:00:00Z"), subscriptionId: "sub_old", subscriptionStatus: "expired", dodoCustomerId: "cus_1", ...pending });
    const asked: string[] = [];
    const paid = deps(lapsed, { api: { retrieveCheckoutSession: async (id) => (asked.push(id), { paymentStatus: "succeeded" }) } });
    await rejectsWith(startCheckout(nonMember, body(), NOW, paid.d), "already_subscribed");
    assert.deepEqual(asked, ["cks_first"]);
    assert.equal(paid.seen.sessions.length, 0, "no second Dodo session, so no second charge");
    for (const status of [null, "failed", "cancelled"]) {
      const open = deps(lapsed, { api: { retrieveCheckoutSession: async () => ({ paymentStatus: status }) } });
      await startCheckout(nonMember, body(), NOW, open.d);
      assert.equal(open.seen.sessions.length, 1, `retry after ${status}`);
    }
    // Older than the 30-minute pending window, or Dodo unreachable: not asked / not blocking.
    const old = deps(user({ pendingCheckoutSessionId: "cks_old", pendingCheckoutAt: new Date(NOW.getTime() - 31 * 60_000) }), {
      api: { retrieveCheckoutSession: async () => ({ paymentStatus: "succeeded" }) },
    });
    await startCheckout(nonMember, body(), NOW, old.d);
    assert.equal(old.seen.sessions.length, 1);
    const down = deps(user(pending), { api: { retrieveCheckoutSession: async () => Promise.reject(new Error("timeout")) } });
    await startCheckout(nonMember, body(), NOW, down.d);
    assert.deepEqual([down.seen.sessions.length, down.seen.warns], [1, ["billing.checkout_paid_guard_unreachable"]]);
  });

  // regression: two-tab-trial (FIX-2, billing review round 2): a second tab opened a second trial session for the same
  // plan (no reuse of the open session, plan §3 row 190 / BIL-1), and the activation self-heal then replaced the first
  // trial with the second while nothing cancelled the first.
  it("a second checkout for the same plan within 30 min reuses the open session: same page, same trial, no new session", async () => {
    const at = new Date(NOW.getTime() - 60_000);
    const tabA = {
      pendingCheckoutSessionId: "cks_A",
      pendingCheckoutPlan: "monthly",
      pendingCheckoutUrl: "https://test.checkout.dodopayments.com/session/cks_A",
      pendingCheckoutAt: at,
      trialOfferedAt: at,
    };
    for (const status of [null, "requires_payment_method", "processing"]) {
      const asked: string[] = [];
      const b = deps(user(tabA), { api: { retrieveCheckoutSession: async (id) => (asked.push(id), { paymentStatus: status }) } });
      const out = await startCheckout(nonMember, body({ source: "onboarding" }), NOW, b.d);
      assert.deepEqual(asked, ["cks_A"], "one Dodo read");
      assert.equal(b.seen.sessions.length, 0, `no second session (${status})`);
      assert.deepEqual(b.seen.records, [], "the session's own record is kept (the window never extends itself)");
      assert.deepEqual(b.seen.reuses, [{ userId: nonMember.id, source: "onboarding", at: NOW }]);
      assert.equal(out.sessionId, "cks_A");
      assert.equal(out.checkoutUrl, tabA.pendingCheckoutUrl);
      assert.equal(out.trial, true, "the trial tab A offered");
      assert.equal(out.chargeDate, new Date(at.getTime() + 7 * 86_400_000).toISOString(), "counted from tab A's session");
    }
    // Tab A offered no trial (a ledger hit): the reuse says so too.
    const paidA = deps(user({ ...tabA, trialOfferedAt: null }), { api: { retrieveCheckoutSession: async () => ({ paymentStatus: null }) } });
    const noTrial = await startCheckout(nonMember, body(), NOW, paidA.d);
    assert.deepEqual([noTrial.sessionId, noTrial.trial, noTrial.chargeDate], ["cks_A", false, null]);
  });

  it("a new session instead when the plan differs, the session failed or was cancelled, it is older than 30 min, or its page is unknown", async () => {
    const at = new Date(NOW.getTime() - 60_000);
    const tabA = { pendingCheckoutSessionId: "cks_A", pendingCheckoutPlan: "monthly", pendingCheckoutUrl: "https://x.test/cks_A", pendingCheckoutAt: at, trialOfferedAt: at };
    const cases: [string, Partial<CheckoutUser>, string | null, "monthly" | "yearly"][] = [
      ["the other plan", tabA, null, "yearly"],
      ["a failed session", tabA, "failed", "monthly"],
      ["a cancelled session", tabA, "cancelled", "monthly"],
      ["31 minutes old", { ...tabA, pendingCheckoutAt: new Date(NOW.getTime() - 31 * 60_000) }, null, "monthly"],
      ["no stored page (a row from before m4r)", { ...tabA, pendingCheckoutUrl: null }, null, "monthly"],
    ];
    for (const [name, over, status, plan] of cases) {
      const t = deps(user(over), { api: { retrieveCheckoutSession: async () => ({ paymentStatus: status }) } });
      const out = await startCheckout(nonMember, body({ plan }), NOW, t.d);
      assert.equal(t.seen.sessions.length, 1, name);
      assert.equal(out.sessionId, "cks_1", name);
      assert.equal(t.seen.records[0]!.checkoutUrl, "https://test.checkout.dodopayments.com/cks_1", `${name}: the new page is stored`);
      assert.deepEqual(t.seen.reuses, [], name);
    }
  });

  it("no API key, no product id or a refused DODO_API_BASE_URL → 503 not_configured", async () => {
    await rejectsWith(startCheckout(nonMember, body(), NOW, deps(user(), { api: null }).d), "not_configured");
    await rejectsWith(startCheckout(nonMember, body(), NOW, deps(user(), { productId: async () => null }).d), "not_configured");
    const refused = deps(user(), {
      dodo: async () => {
        throw new DodoBaseUrlRefusedError("test");
      },
    });
    await rejectsWith(startCheckout(nonMember, body(), NOW, refused.d), "not_configured");
    assert.deepEqual(refused.seen.records, []);
  });

  it("a Dodo failure on create → 502 upstream_unavailable {provider: dodo, kind}, never the raw message, nothing recorded", async () => {
    const timeout = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    const { d, seen } = deps(user(), {
      api: {
        createCheckoutSession: async () => {
          throw timeout;
        },
      },
    });
    await assert.rejects(startCheckout(nonMember, body(), NOW, d), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "upstream_unavailable");
      assert.deepEqual(err.details, { provider: "dodo", kind: "timeout" });
      assert.ok(!err.message.includes("timed out"));
      return true;
    });
    assert.deepEqual(seen.records, []);
  });
});
