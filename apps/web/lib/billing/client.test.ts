import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUBSCRIPTION_REQUIRED_CODE,
  isEntitledClient,
  isSubscriptionRequiredResponse,
  paywallUrl,
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
