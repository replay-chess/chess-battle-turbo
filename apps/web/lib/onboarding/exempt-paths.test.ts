// The exempt list is shared by the middleware rule and the legacy client redirect (INTEGRATE-2: UserSync bounced a
// not-yet-onboarded user from /settings/connected to /onboarding because its own list lacked the P4 pages).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ONBOARDING_EXEMPT_PATHS } from "./guard";
import { ONBOARDING_EXEMPT_PREFIXES, isOnboardingExemptPathname } from "./exempt-paths";

describe("onboarding exempt paths", () => {
  it("the middleware list is built from the shared prefixes", () => {
    assert.deepEqual([...ONBOARDING_EXEMPT_PATHS], ONBOARDING_EXEMPT_PREFIXES.map((p) => (p === "/onboarding" ? "/onboarding(.*)" : p)));
  });

  it("matches the P4 pages and their sub-paths, nothing else", () => {
    for (const p of ["/onboarding", "/onboarding/link", "/checkout/activating", "/settings/connected", "/settings/account", "/settings/membership"]) {
      assert.ok(isOnboardingExemptPathname(p), p);
    }
    for (const p of ["/games", "/settings", "/settings/connectedx", "/checkout", "/play", null, ""]) {
      assert.equal(isOnboardingExemptPathname(p), false, String(p));
    }
  });
});
