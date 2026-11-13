// The onboarding rule of middleware (phase-04 plan §8.1, D4-16, D4-29, §11.1, §11.2 open redirect).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { signClaimCookie } from "./claim-cookie";
import { NEXT_COOKIE, nextCookieHeader, onboardingGate, readNextCookie, safeNextPath, type GateInput } from "./guard";

const SECRET = "k".repeat(64);
const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const USER = "user_2gate";
const NOT_ONBOARDED = { v: 1, onboarded: false, entitled: false, lapsed: false, trialUsed: false, role: "USER" };
const ONBOARDED_MEMBER = { ...NOT_ONBOARDED, onboarded: true, entitled: true };
const LAPSED = { ...NOT_ONBOARDED, onboarded: true, lapsed: true, trialUsed: true };

function input(over: Partial<GateInput> & { cookies?: Record<string, string> } = {}): GateInput {
  const cookies = over.cookies ?? {};
  return {
    md: NOT_ONBOARDED,
    clerkUserId: USER,
    pathname: "/games",
    search: "",
    cookie: (n) => cookies[n],
    nowMs: NOW,
    env: { SIGNED_COOKIE_SECRET: SECRET },
    secure: true,
    ...over,
  };
}

describe("safeNextPath (open redirect)", () => {
  it("keeps same-site paths with query and hash", () => {
    assert.equal(safeNextPath("/games"), "/games");
    assert.equal(safeNextPath("/review/abc?tab=moves#m12"), "/review/abc?tab=moves#m12");
    assert.equal(safeNextPath("  /play  "), "/play");
  });

  it("rejects other origins and their disguises", () => {
    for (const bad of [
      "https://evil.example/x",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/%2F/evil.example",
      "/%2f%2fevil.example",
      "/%5Cevil.example",
      "javascript:alert(1)",
      "games",
      "/x\u0000y",
      "/x\ny",
      "",
      `/${"a".repeat(600)}`,
    ]) {
      assert.equal(safeNextPath(bad), null, bad);
    }
    assert.equal(safeNextPath(null), null);
    assert.equal(safeNextPath(undefined), null);
  });

  it("regression: onb-next-dot-segments (FIX-1): dot segments that normalise to a protocol-relative path are refused", () => {
    for (const bad of ["/.//evil.com", "/games/..//evil.com", "/%2e//evil.com", "/%2E%2E//evil.com", "/a/./..//evil.com", "/games//x"]) {
      const out = safeNextPath(bad);
      assert.equal(out, null, bad);
    }
    // Whatever it returns, it never resolves to another origin.
    for (const p of ["/./games", "/games/../play", "/review/a/../b"]) {
      const out = safeNextPath(p);
      assert.ok(out === null || new URL(out, "https://site.example").origin === "https://site.example", p);
    }
    assert.equal(safeNextPath("/games/../play"), "/play");
  });

  it("rejects destinations that loop or make no sense after onboarding", () => {
    for (const p of ["/onboarding", "/onboarding/plan", "/sign-in", "/sign-up/verify", "/api/me", "/checkout/activating"]) {
      assert.equal(safeNextPath(p), null, p);
    }
  });

  it("rc_onb_next round trip", () => {
    const header = nextCookieHeader("/review/a b?x=1", { secure: true });
    assert.equal(
      header,
      `${NEXT_COOKIE}=%2Freview%2Fa%20b%3Fx%3D1; Path=/onboarding; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`,
    );
    const value = header.split(";")[0]!.split("=")[1]!;
    assert.equal(readNextCookie(value), "/review/a%20b?x=1");
    assert.equal(readNextCookie(encodeURIComponent("//evil.example")), null);
    assert.equal(readNextCookie("%E0%A4%A"), null);
    assert.equal(readNextCookie(undefined), null);
  });
});

describe("onboardingGate: not onboarded", () => {
  it("a member page → /onboarding?redirect_url=… and rc_onb_next on the redirect", async () => {
    const d = await onboardingGate(input({ pathname: "/games", search: "?source=chesscom" }));
    assert.equal(d.redirect, "/onboarding?redirect_url=%2Fgames%3Fsource%3Dchesscom");
    assert.equal(d.setCookies.length, 1);
    assert.match(d.setCookies[0]!, /^rc_onb_next=%2Fgames%3Fsource%3Dchesscom; Path=\/onboarding;/);
    assert.equal(d.skipMemberGate, false);
  });

  it("the exempt pages pass", async () => {
    for (const p of ["/onboarding", "/onboarding/link", "/checkout/activating", "/settings/connected", "/settings/account", "/settings/membership"]) {
      const d = await onboardingGate(input({ pathname: p }));
      assert.equal(d.redirect, null, p);
    }
  });

  it("/settings/notifications is not exempt", async () => {
    const d = await onboardingGate(input({ pathname: "/settings/notifications" }));
    assert.equal(d.redirect, "/onboarding?redirect_url=%2Fsettings%2Fnotifications");
  });

  it("a valid rc_onb (claims still stale after completing) passes", async () => {
    const onb = await signClaimCookie("onb", USER, NOW, SECRET);
    const d = await onboardingGate(input({ cookies: { rc_onb: onb } }));
    assert.equal(d.redirect, null);
  });

  it("an rc_onb of another user, an expired one, or with no secret configured does not", async () => {
    const other = await signClaimCookie("onb", "user_other", NOW, SECRET);
    assert.notEqual((await onboardingGate(input({ cookies: { rc_onb: other } }))).redirect, null);
    const old = await signClaimCookie("onb", USER, NOW - 121_000, SECRET);
    assert.notEqual((await onboardingGate(input({ cookies: { rc_onb: old } }))).redirect, null);
    const ok = await signClaimCookie("onb", USER, NOW, SECRET);
    assert.notEqual((await onboardingGate(input({ cookies: { rc_onb: ok }, env: {} }))).redirect, null);
  });

  it("unknown claims (not synced yet) are not a no: no redirect", async () => {
    for (const md of [undefined, null, "x", []]) {
      const d = await onboardingGate(input({ md }));
      assert.equal(d.redirect, null);
    }
  });

  it("an onboarded member passes", async () => {
    const d = await onboardingGate(input({ md: ONBOARDED_MEMBER }));
    assert.deepEqual(d, { redirect: null, setCookies: [], skipMemberGate: false });
  });

  it("an unsafe current path redirects without a destination", async () => {
    const d = await onboardingGate(input({ pathname: "/checkout", search: "" }));
    assert.equal(d.redirect, "/onboarding");
    assert.deepEqual(d.setCookies, []);
  });
});

describe("onboardingGate: /onboarding itself", () => {
  it("a safe ?redirect_url= sets rc_onb_next on the pass-through", async () => {
    const d = await onboardingGate(input({ pathname: "/onboarding", search: "?redirect_url=%2Freview%2Fabc" }));
    assert.equal(d.redirect, null);
    assert.deepEqual(d.setCookies, [nextCookieHeader("/review/abc", { secure: true })]);
  });

  it("an unsafe one is ignored", async () => {
    const d = await onboardingGate(input({ pathname: "/onboarding", search: "?redirect_url=%2F%2Fevil.example" }));
    assert.deepEqual(d, { redirect: null, setCookies: [], skipMemberGate: false });
  });

  it("a lapsed member → /pricing?reason=ended (not with the paywall off, not an admin)", async () => {
    assert.equal((await onboardingGate(input({ pathname: "/onboarding/plan", md: LAPSED }))).redirect, "/pricing?reason=ended");
    assert.equal(
      (await onboardingGate(input({ pathname: "/onboarding", md: LAPSED, env: { SIGNED_COOKIE_SECRET: SECRET, BILLING_PAYWALL: "off" } }))).redirect,
      null,
    );
    assert.equal((await onboardingGate(input({ pathname: "/onboarding", md: { ...LAPSED, role: "ADMIN" } }))).redirect, null);
  });
});

describe("onboardingGate: rc_act", () => {
  it("a valid rc_act skips the member gate", async () => {
    const act = await signClaimCookie("act", USER, NOW, SECRET);
    const d = await onboardingGate(input({ md: { ...ONBOARDED_MEMBER, entitled: false }, pathname: "/play", cookies: { rc_act: act } }));
    assert.deepEqual(d, { redirect: null, setCookies: [], skipMemberGate: true });
  });

  it("an rc_onb value in rc_act does not", async () => {
    const onb = await signClaimCookie("onb", USER, NOW, SECRET);
    const d = await onboardingGate(input({ md: ONBOARDED_MEMBER, pathname: "/play", cookies: { rc_act: onb } }));
    assert.equal(d.skipMemberGate, false);
  });

  it("rc_act does not skip onboarding", async () => {
    const act = await signClaimCookie("act", USER, NOW, SECRET);
    const d = await onboardingGate(input({ pathname: "/play", cookies: { rc_act: act } }));
    assert.equal(d.redirect, "/onboarding?redirect_url=%2Fplay");
  });
});

describe("middleware wiring", () => {
  it("middleware.ts calls the gate in one block after the session check and before the member gate", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "../../middleware.ts"), "utf8");
    const start = src.indexOf("── P4 onboarding rule");
    const end = src.indexOf("── end P4 onboarding rule");
    assert.ok(start > 0 && end > start, "the block markers exist");
    assert.ok(src.indexOf("if (!userId) return redirectToSignIn") < start, "after the session check");
    assert.ok(src.indexOf('p.cls === "member" && memberGateEnabled') > end, "before the member gate");
    assert.equal(src.split("onboardingGate(").length - 1, 1, "called once");
  });
});
