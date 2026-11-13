// rc_onb / rc_act signed claim cookies (phase-04 plan D4-16, §8.14).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAIM_COOKIE_MAX_AGE_SEC,
  claimCookieSecret,
  claimSetCookie,
  cookieSecureFor,
  signClaimCookie,
  verifyClaimCookie,
} from "./claim-cookie";

const SECRET = "s".repeat(64);
const OTHER = "t".repeat(64);
const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const USER = "user_2abcDEF";

describe("signClaimCookie / verifyClaimCookie", () => {
  it("a fresh cookie verifies for its kind and user", async () => {
    const v = await signClaimCookie("onb", USER, NOW, SECRET);
    assert.match(v, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    assert.equal(await verifyClaimCookie("onb", v, USER, NOW, SECRET), true);
    assert.equal(await verifyClaimCookie("onb", v, USER, NOW + 119_000, SECRET), true);
  });

  it("expired after 120 s", async () => {
    const v = await signClaimCookie("act", USER, NOW, SECRET);
    assert.equal(CLAIM_COOKIE_MAX_AGE_SEC, 120);
    assert.equal(await verifyClaimCookie("act", v, USER, NOW + 120_000, SECRET), false);
  });

  it("another user's cookie does not verify", async () => {
    const v = await signClaimCookie("onb", USER, NOW, SECRET);
    assert.equal(await verifyClaimCookie("onb", v, "user_other", NOW, SECRET), false);
  });

  it("an rc_act value does not pass as rc_onb (kind bound in payload and signature)", async () => {
    const v = await signClaimCookie("act", USER, NOW, SECRET);
    assert.equal(await verifyClaimCookie("onb", v, USER, NOW, SECRET), false);
  });

  it("a tampered payload does not verify", async () => {
    const v = await signClaimCookie("onb", USER, NOW, SECRET);
    const [, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, k: "onb", u: USER, exp: Math.floor(NOW / 1000) + 99_999 })).toString("base64url");
    assert.equal(await verifyClaimCookie("onb", `${forged}.${sig}`, USER, NOW, SECRET), false);
  });

  it("a tampered signature does not verify", async () => {
    const v = await signClaimCookie("onb", USER, NOW, SECRET);
    const [body, sig] = v.split(".");
    const flipped = (sig![0] === "A" ? "B" : "A") + sig!.slice(1);
    assert.equal(await verifyClaimCookie("onb", `${body}.${flipped}`, USER, NOW, SECRET), false);
  });

  it("another secret does not verify; no secret never verifies", async () => {
    const v = await signClaimCookie("onb", USER, NOW, SECRET);
    assert.equal(await verifyClaimCookie("onb", v, USER, NOW, OTHER), false);
    assert.equal(await verifyClaimCookie("onb", v, USER, NOW, null), false);
  });

  it("garbage is rejected without throwing", async () => {
    for (const junk of [undefined, null, "", ".", "a.b.c", "abc", "!!!.###", `${"a".repeat(600)}.b`]) {
      assert.equal(await verifyClaimCookie("onb", junk, USER, NOW, SECRET), false);
    }
  });
});

describe("helpers", () => {
  it("claimCookieSecret needs 32+ characters", () => {
    assert.equal(claimCookieSecret({}), null);
    assert.equal(claimCookieSecret({ SIGNED_COOKIE_SECRET: "short" }), null);
    assert.equal(claimCookieSecret({ SIGNED_COOKIE_SECRET: SECRET }), SECRET);
  });

  it("Set-Cookie attributes", () => {
    assert.equal(claimSetCookie("onb", "v.s", { secure: true }), "rc_onb=v.s; Path=/; Max-Age=120; HttpOnly; SameSite=Lax; Secure");
    assert.equal(claimSetCookie("act", "v.s", { secure: false }), "rc_act=v.s; Path=/; Max-Age=120; HttpOnly; SameSite=Lax");
  });

  it("Secure on https and on any Vercel deployment", () => {
    assert.equal(cookieSecureFor("https://x.example/a", {}), true);
    assert.equal(cookieSecureFor("http://localhost:3000/a", {}), false);
    assert.equal(cookieSecureFor("http://internal/a", { VERCEL_ENV: "preview" }), true);
  });
});
