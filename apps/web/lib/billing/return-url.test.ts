import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activationDestination, buildActivationReturnUrl, buildReturnUrl, isAllowedReturnPath, resolveAppOrigin, safeActivationPath } from "./return-url";

const ORIGIN = "https://www.playchess.tech";

describe("buildReturnUrl", () => {
  it("defaults to /pricing when no path is given", () => {
    assert.equal(buildReturnUrl(undefined, ORIGIN), `${ORIGIN}/pricing?checkout=success`);
    assert.equal(buildReturnUrl("", ORIGIN), `${ORIGIN}/pricing?checkout=success`);
  });

  it("rejects protocol-relative and absolute URLs (no open redirect)", () => {
    assert.equal(buildReturnUrl("//evil.com", ORIGIN), `${ORIGIN}/pricing?checkout=success`);
    assert.equal(
      buildReturnUrl("https://evil.com/pricing", ORIGIN),
      `${ORIGIN}/pricing?checkout=success`,
    );
    assert.equal(
      buildReturnUrl("//evil.com/pricing", ORIGIN),
      `${ORIGIN}/pricing?checkout=success`,
    );
  });

  it("rejects paths that are not on the allowlist", () => {
    assert.equal(buildReturnUrl("/admin", ORIGIN), `${ORIGIN}/pricing?checkout=success`);
    assert.equal(buildReturnUrl("pricing", ORIGIN), `${ORIGIN}/pricing?checkout=success`);
    assert.equal(isAllowedReturnPath("/admin"), false);
    assert.equal(isAllowedReturnPath("/api/subscription"), false);
  });

  it("accepts allowlisted paths and preserves their query string", () => {
    const url = new URL(buildReturnUrl("/onboarding?plan=yearly", ORIGIN));
    assert.equal(url.origin, ORIGIN);
    assert.equal(url.pathname, "/onboarding");
    assert.equal(url.searchParams.get("plan"), "yearly");
    assert.equal(url.searchParams.get("checkout"), "success");
  });

  it("accepts nested allowlisted paths", () => {
    assert.equal(
      buildReturnUrl("/tournament/abc123", ORIGIN),
      `${ORIGIN}/tournament/abc123?checkout=success`,
    );
    assert.equal(isAllowedReturnPath("/profile/user_1"), true);
  });

  it("accepts game pages, where the rematch paywall sends buyers back", () => {
    assert.equal(isAllowedReturnPath("/game/abc123"), true);
    assert.equal(
      buildReturnUrl("/game/abc123", ORIGIN),
      `${ORIGIN}/game/abc123?checkout=success`,
    );
  });

  it("accepts the pricing hand-off that carries a gated redirect_url", () => {
    const url = new URL(buildReturnUrl("/pricing?redirect_url=%2Fgame%2Fabc123", ORIGIN));
    assert.equal(url.pathname, "/pricing");
    assert.equal(url.searchParams.get("redirect_url"), "/game/abc123");
    assert.equal(url.searchParams.get("checkout"), "success");
  });

  it("builds against the origin it is given", () => {
    assert.equal(
      buildReturnUrl("/play", "http://localhost:3000"),
      "http://localhost:3000/play?checkout=success",
    );
  });
});

describe("resolveAppOrigin", () => {
  it("uses the origin of DODO_PAYMENTS_RETURN_URL when set", () => {
    assert.equal(
      resolveAppOrigin(
        { DODO_PAYMENTS_RETURN_URL: "http://localhost:3000/pricing?checkout=success" },
        ORIGIN,
      ),
      "http://localhost:3000",
    );
  });

  it("falls back to the canonical site when unset or invalid", () => {
    assert.equal(resolveAppOrigin({}, ORIGIN), ORIGIN);
    assert.equal(resolveAppOrigin({ DODO_PAYMENTS_RETURN_URL: "" }, ORIGIN), ORIGIN);
    assert.equal(resolveAppOrigin({ DODO_PAYMENTS_RETURN_URL: "not a url" }, ORIGIN), ORIGIN);
  });
});

describe("Phase 3 return paths", () => {
  it("accepts the Phase 3 review, archive and practice pages (phase-03 plan §12.1)", () => {
    assert.equal(isAllowedReturnPath("/review/x"), true);
    assert.equal(isAllowedReturnPath("/review/x/complete"), true);
    assert.equal(isAllowedReturnPath("/games"), true);
    assert.equal(isAllowedReturnPath("/games?result=loss&tc=rapid"), true);
    assert.equal(isAllowedReturnPath("/practice?game=x&ply=12"), true);
    assert.equal(
      buildReturnUrl("/review/cabc?ply=12", ORIGIN),
      `${ORIGIN}/review/cabc?ply=12&checkout=success`,
    );
    assert.equal(isAllowedReturnPath("/r/8kq2xh4m"), false, "public share pages never need a checkout return");
  });
});

// ── Phase 4 (plan 7.5.1 step 6, 12.1 "buildActivationReturnUrl per source; open-redirect cases") ────────────────
describe("buildActivationReturnUrl", () => {
  const v3 = { onboardingV3: true, plan: "monthly" as const };
  const legacy = { onboardingV3: false, plan: "yearly" as const };

  it("onboarding with onboarding-v3 on returns to the onboarding activating step", () => {
    const url = new URL(buildActivationReturnUrl("onboarding", "/games", ORIGIN, v3));
    assert.equal(url.origin, ORIGIN);
    assert.equal(url.pathname, "/onboarding/activating");
    assert.equal(url.searchParams.get("checkout"), "success");
    assert.equal(url.searchParams.get("plan"), "monthly");
    assert.equal(url.searchParams.get("redirect_url"), null);
  });

  it("pricing, paywall and renew return to /checkout/activating with the checked destination", () => {
    for (const source of ["pricing", "paywall", "renew"] as const) {
      const url = new URL(buildActivationReturnUrl(source, "/review/cabc?tab=moves", ORIGIN, v3));
      assert.equal(url.pathname, "/checkout/activating");
      assert.equal(url.searchParams.get("source"), source);
      assert.equal(url.searchParams.get("plan"), "monthly");
      assert.equal(url.searchParams.get("redirect_url"), "/review/cabc?tab=moves");
    }
  });

  it("onboarding while the flag is off goes through /checkout/activating back to the legacy page", () => {
    const url = new URL(buildActivationReturnUrl("onboarding", "/onboarding?plan=yearly", ORIGIN, legacy));
    assert.equal(url.pathname, "/checkout/activating");
    assert.equal(url.searchParams.get("redirect_url"), "/onboarding?plan=yearly");
    const bare = new URL(buildActivationReturnUrl("onboarding", undefined, ORIGIN, legacy));
    assert.equal(bare.searchParams.get("redirect_url"), "/onboarding");
  });

  it("never nests an activation URL: a checkoutReturnPath() value is unwrapped to its destination", () => {
    const url = new URL(buildActivationReturnUrl("paywall", "/checkout/activating?redirect_url=%2Fplay%3Ftc%3Dblitz", ORIGIN, v3));
    assert.equal(url.pathname, "/checkout/activating");
    assert.equal(url.searchParams.get("redirect_url"), "/play?tc=blitz");
  });

  it("drops open-redirect attempts and unlisted paths (no redirect_url)", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com/play", "/%2F%2Fevil.com", "/playground", "/admin", "/play\u0000x", "play", ""]) {
      const url = new URL(buildActivationReturnUrl("pricing", bad, ORIGIN, v3));
      assert.equal(url.origin, ORIGIN, bad);
      assert.equal(url.searchParams.get("redirect_url"), null, bad);
    }
    assert.equal(
      new URL(buildActivationReturnUrl("paywall", "/checkout/activating?redirect_url=%2F%2Fevil.com", ORIGIN, v3)).searchParams.get("redirect_url"),
      null,
    );
  });
});

describe("safeActivationPath", () => {
  it("accepts allow-listed paths at a segment boundary, with the P4 prefixes", () => {
    for (const ok of ["/games", "/settings/connected", "/checkout/activating", "/home", "/train/x", "/learn", "/play?tc=blitz#x"]) {
      assert.equal(safeActivationPath(ok), ok, ok);
    }
    assert.equal(isAllowedReturnPath("/settings/connected"), true);
  });

  it("rejects everything else", () => {
    for (const bad of [null, undefined, "", "games", "//x", "/\\x", "/a/b", "/games%2F..%2Fadmin", "/pricingx", "/api/checkout"]) {
      assert.equal(safeActivationPath(bad), null, String(bad));
    }
  });
});

describe("activationDestination", () => {
  it("the checked redirect_url, never /checkout/*, /onboarding until set up, else /games", () => {
    assert.equal(activationDestination("/review/cabc", true), "/review/cabc");
    assert.equal(activationDestination("/checkout/activating?redirect_url=%2Fplay", true), "/games");
    assert.equal(activationDestination("//evil.com", true), "/games");
    assert.equal(activationDestination(undefined, true), "/games");
    assert.equal(activationDestination("/review/cabc", false), "/onboarding");
  });
});
