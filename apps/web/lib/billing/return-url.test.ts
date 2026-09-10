import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReturnUrl, isAllowedReturnPath, resolveAppOrigin } from "./return-url";

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
