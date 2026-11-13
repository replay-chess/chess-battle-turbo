import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  leaveActivation,
  SUBSCRIPTION_REQUIRED_CODE,
  SESSION_RELOAD_CAP_MS,
  checkoutReturnPath,
  isEntitledClient,
  isSubscriptionRequiredBody,
  isSubscriptionRequiredResponse,
  reloadClerkSession,
  needsPaymentUpdate,
  paywallUrl,
  stripCheckoutParams,
} from "./client";

describe("paywallUrl", () => {
  it("points at pricing with the required reason and an encoded return path", () => {
    assert.equal(
      paywallUrl("/play"),
      "/pricing?reason=required&redirect_url=%2Fplay",
    );
  });

  it("keeps the query string of the return path intact", () => {
    const url = paywallUrl("/queue?time=300&increment=5");
    const params = new URL(url, "https://example.test").searchParams;
    assert.equal(params.get("reason"), "required");
    assert.equal(params.get("redirect_url"), "/queue?time=300&increment=5");
  });
});

describe("checkoutReturnPath", () => {
  it("routes the return through /checkout/activating with the gated path as redirect_url", () => {
    assert.equal(checkoutReturnPath("/play"), "/checkout/activating?redirect_url=%2Fplay");
  });

  it("does not carry the paywall reason, so the return shows no paywall banner", () => {
    const params = new URL(checkoutReturnPath("/queue?legend=x"), "https://example.test")
      .searchParams;
    assert.equal(params.get("reason"), null);
    assert.equal(params.get("redirect_url"), "/queue?legend=x");
  });

  it("round-trips through the paywall URL without losing the gated query", () => {
    const gated = "/queue?legend=x&time=300";
    const paywall = new URL(paywallUrl(gated), "https://example.test").searchParams;
    const returned = new URL(
      checkoutReturnPath(paywall.get("redirect_url")!),
      "https://example.test",
    ).searchParams;
    assert.equal(returned.get("redirect_url"), gated);
  });
});

describe("stripCheckoutParams", () => {
  it("removes the checkout flag and everything Dodo appends", () => {
    assert.equal(
      stripCheckoutParams(
        "/play?checkout=success&status=active&subscription_id=sub_1&session_id=cs_1&email=a%40b.c",
      ),
      "/play",
    );
  });

  it("keeps the page's own query parameters", () => {
    assert.equal(
      stripCheckoutParams("/queue?legend=x&checkout=success&status=active&time=300"),
      "/queue?legend=x&time=300",
    );
  });

  it("leaves paths without checkout parameters alone", () => {
    assert.equal(stripCheckoutParams("/play"), "/play");
    assert.equal(stripCheckoutParams("/queue?legend=x"), "/queue?legend=x");
  });

  it("yields a paywall redirect_url free of checkout state", () => {
    const url = paywallUrl(stripCheckoutParams("/play?checkout=success&status=active"));
    assert.equal(url, "/pricing?reason=required&redirect_url=%2Fplay");
  });
});

describe("activation helpers (phase 4: the poll moved to /checkout/activating)", () => {
  it("no client poll is exported any more (lib/billing/useActivation.ts owns the schedule)", async () => {
    const mod = (await import("./client")) as Record<string, unknown>;
    for (const gone of ["waitForEntitlement", "ACTIVATION_POLL_MS", "ACTIVATION_POLL_ATTEMPTS"]) assert.equal(mod[gone], undefined, gone);
  });

  it("caps the Clerk session reload at 5 s", () => {
    assert.equal(SESSION_RELOAD_CAP_MS, 5000);
  });

  it("reloadClerkSession is a no-op without a browser", async () => {
    await reloadClerkSession();
  });
});

describe("leaveActivation", () => {
  it("leaves with a document navigation (a client push raced Clerk's refresh after the session reload)", () => {
    const assigned: string[] = [];
    leaveActivation("/onboarding/done", { location: { assign: (u: string | URL) => assigned.push(String(u)) } });
    assert.deepEqual(assigned, ["/onboarding/done"]);
    assert.doesNotThrow(() => leaveActivation("/onboarding/done", undefined));
  });
});

describe("needsPaymentUpdate", () => {
  it("is true for a lapsed plan whose renewal is failing", () => {
    assert.equal(needsPaymentUpdate({ plan: "player", entitled: false, status: "on_hold" }), true);
    assert.equal(
      needsPaymentUpdate({
        plan: "player",
        entitled: false,
        subscription: {
          id: "sub_1",
          status: "past_due",
          productId: "prod_1",
          nextBillingDate: "2026-01-01T00:00:00Z",
        },
      }),
      true,
    );
  });

  it("is false while the plan still grants access, even in grace", () => {
    assert.equal(needsPaymentUpdate({ plan: "player", entitled: true, status: "on_hold" }), false);
  });

  it("is false with no plan, a cancelled plan, or nothing fetched yet", () => {
    assert.equal(needsPaymentUpdate(null), false);
    assert.equal(needsPaymentUpdate({ plan: null, entitled: false }), false);
    assert.equal(needsPaymentUpdate({ plan: null, entitled: false, status: "cancelled" }), false);
  });
});

describe("isEntitledClient", () => {
  it("is false before the subscription has been fetched", () => {
    assert.equal(isEntitledClient(null), false);
    assert.equal(isEntitledClient(undefined), false);
    assert.equal(isEntitledClient(null, "USER"), false);
  });

  it("is true when the server says the user is entitled", () => {
    assert.equal(isEntitledClient({ plan: "player", entitled: true }), true);
  });

  it("is false when the server says the user is not entitled", () => {
    assert.equal(isEntitledClient({ plan: null, entitled: false }), false);
    assert.equal(isEntitledClient({ plan: null }), false);
  });

  it("is true when the paywall is switched off, whatever the plan", () => {
    assert.equal(isEntitledClient({ plan: null, entitled: false, paywall: false }), true);
  });

  it("does not treat a paywall that is on as a bypass", () => {
    assert.equal(isEntitledClient({ plan: null, entitled: false, paywall: true }), false);
  });

  it("always lets admins through, even with no subscription", () => {
    assert.equal(isEntitledClient(null, "ADMIN"), true);
    assert.equal(isEntitledClient({ plan: null, entitled: false }, "ADMIN"), true);
    assert.equal(isEntitledClient({ plan: null, entitled: false }, "USER"), false);
  });
});

describe("isSubscriptionRequiredResponse", () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("recognises a 402 regardless of body", async () => {
    assert.equal(await isSubscriptionRequiredResponse(new Response(null, { status: 402 })), true);
  });

  it("recognises the code on other error statuses", async () => {
    const res = json({ error: "x", code: SUBSCRIPTION_REQUIRED_CODE }, 403);
    assert.equal(await isSubscriptionRequiredResponse(res), true);
  });

  it("ignores ordinary errors and successes", async () => {
    assert.equal(await isSubscriptionRequiredResponse(json({ error: "nope" }, 400)), false);
    assert.equal(await isSubscriptionRequiredResponse(json({ success: true }, 200)), false);
    assert.equal(await isSubscriptionRequiredResponse(new Response("boom", { status: 500 })), false);
  });

  it("recognises the envelope's error.code (route() bodies)", async () => {
    const res = json({ error: { code: SUBSCRIPTION_REQUIRED_CODE, message: "Members only" } }, 403);
    assert.equal(await isSubscriptionRequiredResponse(res), true);
  });

  it("isSubscriptionRequiredBody reads both shapes and nothing else", () => {
    assert.equal(isSubscriptionRequiredBody({ code: SUBSCRIPTION_REQUIRED_CODE }), true);
    assert.equal(isSubscriptionRequiredBody({ error: { code: SUBSCRIPTION_REQUIRED_CODE } }), true);
    assert.equal(isSubscriptionRequiredBody({ error: { code: "rate_limited" } }), false);
    assert.equal(isSubscriptionRequiredBody({ error: SUBSCRIPTION_REQUIRED_CODE }), false);
    assert.equal(isSubscriptionRequiredBody(null), false);
    assert.equal(isSubscriptionRequiredBody("subscription_required"), false);
  });

  it("leaves the body readable for the caller", async () => {
    const res = json({ error: "x", code: SUBSCRIPTION_REQUIRED_CODE }, 403);
    assert.equal(await isSubscriptionRequiredResponse(res), true);
    assert.equal(res.bodyUsed, false);
    const body = await res.json();
    assert.equal(body.code, SUBSCRIPTION_REQUIRED_CODE);
  });
});
