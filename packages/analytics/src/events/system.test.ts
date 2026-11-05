import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORBIDDEN_PROPERTY_NAMES } from "../pii";
import { systemEvents } from "./system";

const valid: { [K in keyof typeof systemEvents]: Record<string, unknown> } = {
  rate_limited_shown: { route_id: "openings.list", bucket: "openings:ip", retry_after_sec: 30, surface: "inline" },
  rate_limited_retry: { route_id: "openings.list", waited_sec: 31, result: "ok" },
  session_expired_shown: { source: "api_401", route_template: "/game/[gameId]" },
  session_expired_action: { action: "sign_in" },
  payment_banner_shown: { state: "banner" },
  payment_banner_cta: { state: "expired" },
  payment_banner_dismissed: {},
  payment_banner_undo: {},
  api_error_toast: { route_id: "billing.refresh", code: "internal", status: 500 },
  webhook_processed: { provider: "dodo", type: "subscription.active", outcome: "duplicate", changed: false, lag_ms: 812 },
  billing_refreshed: { result: "changed", source: "activation" },
};

describe("system events", () => {
  for (const [name, schema] of Object.entries(systemEvents)) {
    const sample = valid[name as keyof typeof systemEvents];
    it(`${name} accepts its documented shape`, () => {
      const result = schema.safeParse(sample);
      assert.equal(result.success, true, result.success ? "" : String(result.error));
    });
    it(`${name} rejects extra keys`, () => {
      assert.equal(schema.safeParse({ ...sample, extra: 1 }).success, false);
    });
    it(`${name} declares no forbidden property`, () => {
      for (const key of Object.keys(schema.shape)) {
        assert.ok(!(FORBIDDEN_PROPERTY_NAMES as readonly string[]).includes(key), `${name}.${key}`);
      }
    });
  }

  it("route_template is a template, not a URL with a query or an email", () => {
    const s = systemEvents.session_expired_shown;
    assert.equal(s.safeParse({ source: "clerk", route_template: "/play?q=morphy" }).success, false);
    assert.equal(s.safeParse({ source: "clerk", route_template: "/u/a@b.co" }).success, false);
  });

  it("status of api_error_toast is an HTTP error status", () => {
    const s = systemEvents.api_error_toast;
    assert.equal(s.safeParse({ ...valid.api_error_toast, status: 200 }).success, false);
  });
});
