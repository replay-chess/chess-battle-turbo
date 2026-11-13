// Plan §12.1 `WEB/lib/crypto/__tests__/signed-cookie.test.ts`: valid, tampered payload, tampered signature, expired,
// wrong user; plus the Set-Cookie serialiser and the reader.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearCookie,
  readCookie,
  serializeCookie,
  signCookieValue,
  signedCookieSecret,
  verifyCookieValue,
} from "./signed-cookie";

const SECRET = "s".repeat(64);
const NOW = Date.parse("2026-11-12T10:00:00.000Z");

describe("signed cookie values", () => {
  it("round trip: the payload comes back when signature, exp and subject match", async () => {
    const value = await signCookieValue({ v: 1, exp: NOW + 60_000, sub: "user_a", state: "abc" }, SECRET);
    assert.match(value, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const r = await verifyCookieValue(value, SECRET, { nowMs: NOW, sub: "user_a" });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.payload.state, "abc");
  });

  it("a tampered payload fails the signature", async () => {
    const value = await signCookieValue({ v: 1, exp: NOW + 60_000, sub: "user_a" }, SECRET);
    const [body, sig] = value.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ v: 1, exp: NOW + 60_000, sub: "user_b" })).toString("base64url");
    assert.deepEqual(await verifyCookieValue(`${forged}.${sig}`, SECRET, { nowMs: NOW }), { ok: false, reason: "bad_sig" });
    const flipped = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
    assert.equal((await verifyCookieValue(`${flipped}.${sig}`, SECRET, { nowMs: NOW })).ok, false);
  });

  it("a tampered signature or another secret fails", async () => {
    const value = await signCookieValue({ v: 1, exp: NOW + 60_000 }, SECRET);
    const [body, sig] = value.split(".") as [string, string];
    const bad = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    assert.deepEqual(await verifyCookieValue(`${body}.${bad}`, SECRET, { nowMs: NOW }), { ok: false, reason: "bad_sig" });
    assert.deepEqual(await verifyCookieValue(value, "t".repeat(64), { nowMs: NOW }), { ok: false, reason: "bad_sig" });
  });

  it("expired (exp ≤ now) and wrong subject", async () => {
    const value = await signCookieValue({ v: 1, exp: NOW, sub: "user_a" }, SECRET);
    assert.deepEqual(await verifyCookieValue(value, SECRET, { nowMs: NOW }), { ok: false, reason: "expired" });
    const live = await signCookieValue({ v: 1, exp: NOW + 1, sub: "user_a" }, SECRET);
    assert.deepEqual(await verifyCookieValue(live, SECRET, { nowMs: NOW, sub: "user_b" }), { ok: false, reason: "wrong_subject" });
  });

  it("malformed values never throw", async () => {
    for (const v of [null, undefined, "", "abc", "a.b.c", ".x", "a.!!", "x".repeat(4_000)]) {
      assert.equal((await verifyCookieValue(v, SECRET, { nowMs: NOW })).ok, false, String(v).slice(0, 10));
    }
  });

  it("refuses a payload without v: 1 and exp", async () => {
    await assert.rejects(signCookieValue({ v: 2, exp: 1 } as never, SECRET), TypeError);
    await assert.rejects(signCookieValue({ v: 1, exp: Number.NaN }, SECRET), TypeError);
  });

  it("signedCookieSecret needs ≥ 32 chars", () => {
    assert.equal(signedCookieSecret({}), null);
    assert.equal(signedCookieSecret({ SIGNED_COOKIE_SECRET: "short" }), null);
    assert.equal(signedCookieSecret({ SIGNED_COOKIE_SECRET: SECRET }), SECRET);
  });
});

describe("cookie headers", () => {
  it("serialises with HttpOnly, Secure, SameSite=Lax by default; clears with Max-Age=0", () => {
    assert.equal(
      serializeCookie("rc_lichess_pkce", "a.b", { maxAgeSec: 600, path: "/api/accounts/lichess" }),
      "rc_lichess_pkce=a.b; Path=/api/accounts/lichess; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
    );
    assert.equal(clearCookie("rc_x", { path: "/p" }), "rc_x=; Path=/p; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    assert.throws(() => serializeCookie("bad name", "v", { maxAgeSec: 1 }), TypeError);
    assert.throws(() => serializeCookie("ok", "v;x", { maxAgeSec: 1 }), TypeError);
  });

  it("reads one cookie from a Cookie header", () => {
    assert.equal(readCookie("a=1; rc_lichess_pkce=xx.yy; b=2", "rc_lichess_pkce"), "xx.yy");
    assert.equal(readCookie("a=1", "rc_lichess_pkce"), null);
    assert.equal(readCookie(null, "a"), null);
  });
});
