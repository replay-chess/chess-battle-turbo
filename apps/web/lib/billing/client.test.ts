import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIVATION_POLL_ATTEMPTS,
  ACTIVATION_POLL_MS,
  SUBSCRIPTION_REQUIRED_CODE,
  checkoutReturnPath,
  isEntitledClient,
  isSubscriptionRequiredResponse,
  needsPaymentUpdate,
  paywallUrl,
  stripCheckoutParams,
  waitForEntitlement,
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
  it("routes the return through /pricing with the gated path as redirect_url", () => {
    assert.equal(checkoutReturnPath("/play"), "/pricing?redirect_url=%2Fplay");
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

describe("waitForEntitlement", () => {
  const noWait = async () => {};

  it("exports the activation schedule shared by every checkout return", () => {
    assert.equal(ACTIVATION_POLL_MS, 2000);
    assert.equal(ACTIVATION_POLL_ATTEMPTS, 6);
  });

  it("resolves true as soon as a refresh shows entitlement", async () => {
    let refreshes = 0;
    const entitled = await waitForEntitlement({
      refresh: async () => {
        refreshes += 1;
      },
      isEntitled: () => refreshes >= 3,
      wait: noWait,
    });
    assert.equal(entitled, true);
    assert.equal(refreshes, 3);
  });

  it("gives up after the configured attempts when entitlement never appears", async () => {
    let refreshes = 0;
    const waits: number[] = [];
    const entitled = await waitForEntitlement({
      refresh: async () => {
        refreshes += 1;
      },
      isEntitled: () => false,
      attempts: 3,
      intervalMs: 50,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    assert.equal(entitled, false);
    assert.equal(refreshes, 4);
    assert.deepEqual(waits, [50, 50, 50]);
  });

  it("stops polling once cancelled and reports false", async () => {
    let refreshes = 0;
    let cancelled = false;
    const entitled = await waitForEntitlement({
      refresh: async () => {
        refreshes += 1;
      },
      isEntitled: () => true,
      isCancelled: () => cancelled,
      wait: async () => {
        cancelled = true;
      },
    });
    // Entitled after the first refresh, so it never needed to wait.
    assert.equal(entitled, true);
    assert.equal(refreshes, 1);

    refreshes = 0;
    cancelled = false;
    const abandoned = await waitForEntitlement({
      refresh: async () => {
        refreshes += 1;
      },
      isEntitled: () => false,
      isCancelled: () => cancelled,
      wait: async () => {
        cancelled = true;
      },
    });
    assert.equal(abandoned, false);
    assert.equal(refreshes, 1);
  });

  it("does not swallow a refresh that rejects", async () => {
    await assert.rejects(
      waitForEntitlement({
        refresh: async () => {
          throw new Error("network");
        },
        isEntitled: () => false,
        wait: noWait,
      }),
      /network/,
    );
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

  it("leaves the body readable for the caller", async () => {
    const res = json({ error: "x", code: SUBSCRIPTION_REQUIRED_CODE }, 403);
    assert.equal(await isSubscriptionRequiredResponse(res), true);
    assert.equal(res.bodyUsed, false);
    const body = await res.json();
    assert.equal(body.code, SUBSCRIPTION_REQUIRED_CODE);
  });
});
