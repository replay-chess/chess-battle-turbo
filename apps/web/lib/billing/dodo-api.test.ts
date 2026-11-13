// getDodoApi (phase-04 plan D4-19): with the test-build override the SDK talks to DODO_API_BASE_URL (the upstream mock)
// and is built without `environment` (the SDK throws "Ambiguous URL" when both are given: every e2e checkout answered
// 500, INTEGRATE-2); without the override the environment picks Dodo's host.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { getDodoApi, setDodoApi } from "./dodo-api";

describe("getDodoApi", () => {
  it("talks to DODO_API_BASE_URL in a test build (no Ambiguous URL)", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ session_id: "cks_1", checkout_url: "http://127.0.0.1/pay/cks_1" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const restore = setDodoApi(undefined as never);
    try {
      const port = (server.address() as AddressInfo).port;
      const api = await getDodoApi({
        DODO_PAYMENTS_API_KEY: "test_key",
        DODO_PAYMENTS_ENVIRONMENT: "test_mode",
        APP_ENV: "test",
        DODO_API_BASE_URL: `http://127.0.0.1:${port}/dodo`,
      });
      assert.ok(api);
      const session = await api.createCheckoutSession({
        productId: "pdt_1",
        customer: { email: "a@example.test" },
        metadata: { clerkUserId: "user_1" },
        trialDays: 7,
        returnUrl: "http://localhost:3000/onboarding/activating",
        theme: "system",
      });
      assert.deepEqual(session, { sessionId: "cks_1", checkoutUrl: "http://127.0.0.1/pay/cks_1" });
      assert.deepEqual(seen, ["POST /dodo/checkouts"]);
    } finally {
      restore();
      server.close();
    }
  });

  it("builds the client for the configured environment without an override", async () => {
    const restore = setDodoApi(undefined as never);
    try {
      const api = await getDodoApi({ DODO_PAYMENTS_API_KEY: "test_key", DODO_PAYMENTS_ENVIRONMENT: "test_mode", NEXT_PUBLIC_APP_ENV: "dev" });
      assert.ok(api);
      assert.equal(await getDodoApi({}), null, "no key, no client");
    } finally {
      restore();
    }
  });
});
