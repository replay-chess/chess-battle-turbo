// Plan §12.1 `WEB/lib/accounts/__tests__/pkce.test.ts`: the RFC 7636 appendix B vector; verifier alphabet and length.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PKCE_VERIFIER_RE, newOAuthState, newPkceVerifier, pkceChallenge, timingSafeEqualText } from "./pkce";

describe("PKCE S256", () => {
  it("RFC 7636 appendix B", async () => {
    assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifiers are 64 chars of the unreserved alphabet and differ every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const v = newPkceVerifier();
      assert.equal(v.length, 64);
      assert.match(v, PKCE_VERIFIER_RE);
      assert.match(v, /^[A-Za-z0-9_-]+$/);
      seen.add(v);
    }
    assert.equal(seen.size, 50);
  });

  it("state is 32 base64url chars (the callback query accepts 16–128)", () => {
    const s = newOAuthState();
    assert.equal(s.length, 32);
    assert.match(s, /^[A-Za-z0-9_-]+$/);
  });

  it("refuses a non-verifier", async () => {
    await assert.rejects(pkceChallenge("short"), RangeError);
    await assert.rejects(pkceChallenge("x".repeat(43) + " "), RangeError);
  });

  it("timingSafeEqualText", () => {
    assert.equal(timingSafeEqualText("abc", "abc"), true);
    assert.equal(timingSafeEqualText("abc", "abd"), false);
    assert.equal(timingSafeEqualText("abc", "abcd"), false);
    assert.equal(timingSafeEqualText("", ""), true);
  });
});
