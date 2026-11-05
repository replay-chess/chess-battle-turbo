// Middleware decisions (plan phase-01 §7.6 steps 2, 4, 6, 7).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DOC_LIMIT,
  PATHNAME_HEADER,
  clientIpOf,
  createDocLimiter,
  crossSiteBlocked,
  docLimitEnabled,
  hasClerkSessionCookie,
  isDocLimitedPath,
  isDocumentRequest,
  memberGateEnabled,
  memberGateTarget,
  noindexFor,
  returnPathOf,
  tooManyRequestsPath,
  type CrossSiteInput,
} from "./rules";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("env switches", () => {
  it("member gate: on only with MIDDLEWARE_MEMBER_GATE=on and the paywall not off", () => {
    assert.equal(memberGateEnabled({}), false, "default off");
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: "off" }), false);
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: "1" }), false);
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: "on" }), true);
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: " ON " }), true);
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: "on", BILLING_PAYWALL: "off" }), false);
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: "on", BILLING_PAYWALL: "OFF" }), false);
    assert.equal(memberGateEnabled({ MIDDLEWARE_MEMBER_GATE: "on", BILLING_PAYWALL: "on" }), true);
  });

  it("doc limiter: on only with EDGE_DOC_LIMIT=on", () => {
    assert.equal(docLimitEnabled({}), false);
    assert.equal(docLimitEnabled({ EDGE_DOC_LIMIT: "off" }), false);
    assert.equal(docLimitEnabled({ EDGE_DOC_LIMIT: "on" }), true);
  });

  it("noindex everywhere except production", () => {
    assert.equal(noindexFor({}), true, "local next dev");
    assert.equal(noindexFor({ NEXT_PUBLIC_APP_ENV: "dev", VERCEL_ENV: "production" }), true, "dev project's production branch");
    assert.equal(noindexFor({ NEXT_PUBLIC_APP_ENV: "test" }), true);
    assert.equal(noindexFor({ NEXT_PUBLIC_APP_ENV: "production" }), false);
    assert.equal(noindexFor({ VERCEL_ENV: "production" }), false, "a prod deploy missing the variable is never de-indexed");
    assert.equal(noindexFor({ VERCEL_ENV: "preview" }), true);
  });
});

describe("cross-site cookie mutations (step 4, CF SEC-9)", () => {
  const base: CrossSiteInput = {
    method: "POST",
    hasSessionCookie: true,
    secFetchSite: null,
    origin: null,
    requestOrigin: "http://localhost:3000",
    siteUrl: "https://replay-chess-dev.example.app/",
  };
  const blocked = (o: Partial<CrossSiteInput>) => crossSiteBlocked({ ...base, ...o });

  it("refuses another site, a same-site subdomain and an unknown Origin", () => {
    assert.equal(blocked({ secFetchSite: "cross-site", origin: "https://evil.example" }), true);
    assert.equal(blocked({ secFetchSite: "cross-site" }), true);
    assert.equal(blocked({ secFetchSite: "same-site" }), true, "a same-site subdomain is not trusted");
    assert.equal(blocked({ secFetchSite: "none" }), true);
    assert.equal(blocked({ origin: "https://evil.example" }), true, "Origin alone (old browsers)");
    assert.equal(blocked({ origin: "null" }), true);
    assert.equal(blocked({ secFetchSite: "same-origin", origin: "https://evil.example" }), true);
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "post"]) {
      assert.equal(blocked({ method, origin: "https://evil.example" }), true, method);
    }
  });

  it("allows same-origin, the configured site origin, safe methods and cookieless calls", () => {
    assert.equal(blocked({ secFetchSite: "same-origin", origin: "http://localhost:3000" }), false);
    assert.equal(blocked({ secFetchSite: "same-origin" }), false, "sendBeacon");
    assert.equal(blocked({}), false, "no Sec-Fetch-Site, no Origin (server-to-server with a cookie jar)");
    assert.equal(blocked({ origin: "https://replay-chess-dev.example.app" }), false, "NEXT_PUBLIC_SITE_URL origin");
    assert.equal(blocked({ method: "GET", secFetchSite: "cross-site", origin: "https://evil.example" }), false);
    assert.equal(blocked({ method: "HEAD", secFetchSite: "cross-site" }), false);
    assert.equal(blocked({ hasSessionCookie: false, secFetchSite: "cross-site", origin: "https://evil.example" }), false);
    assert.equal(blocked({ siteUrl: "not a url", origin: "http://localhost:3000" }), false);
  });

  it("recognises Clerk's session cookie", () => {
    assert.equal(hasClerkSessionCookie(["__session"]), true);
    assert.equal(hasClerkSessionCookie(["a", "__session_Abc123"]), true);
    assert.equal(hasClerkSessionCookie(["__client_uat", "__clerk_db_jwt", "ph_x"]), false);
    assert.equal(hasClerkSessionCookie([]), false);
  });
});

describe("member gate (step 6, B26 default)", () => {
  const md = (o: Record<string, unknown>) =>
    ({ v: 1, onboarded: true, entitled: true, lapsed: false, trialUsed: false, role: "USER", ...o }) as never;

  it("unknown is not no: a missing claim or a missing entitled passes", () => {
    assert.equal(memberGateTarget(undefined, "/play"), null);
    assert.equal(memberGateTarget(null, "/play"), null);
    assert.equal(memberGateTarget({} as never, "/play"), null);
    assert.equal(memberGateTarget("x" as never, "/play"), null);
    assert.equal(memberGateTarget(md({ entitled: undefined }), "/play"), null);
    assert.equal(memberGateTarget(md({ entitled: "false" }), "/play"), null, "only boolean false");
  });

  it("members and admins pass", () => {
    assert.equal(memberGateTarget(md({}), "/play"), null);
    assert.equal(memberGateTarget(md({ entitled: false, lapsed: true, role: "ADMIN" }), "/play"), null);
  });

  it("never paid → reason=required, lapsed → reason=ended, with redirect_url", () => {
    assert.equal(memberGateTarget(md({ entitled: false }), "/play"), "/pricing?reason=required&redirect_url=%2Fplay");
    assert.equal(
      memberGateTarget(md({ entitled: false, lapsed: true, trialUsed: true }), "/play"),
      "/pricing?reason=ended&redirect_url=%2Fplay",
    );
  });

  it("keeps the query but strips checkout-return params", () => {
    assert.equal(
      memberGateTarget(md({ entitled: false }), "/queue?tc=blitz&checkout=success&subscription_id=sub_1&status=active"),
      "/pricing?reason=required&redirect_url=%2Fqueue%3Ftc%3Dblitz",
    );
    assert.equal(returnPathOf("/game/x", "?checkout=success"), "/game/x");
    assert.equal(returnPathOf("/play", ""), "/play");
    assert.equal(returnPathOf("/queue", "?tc=blitz"), "/queue?tc=blitz");
  });

  it("the x-rc-pathname header name matches requireMemberPage()", () => {
    const src = readFileSync(path.resolve(HERE, "../require-member-page.ts"), "utf8");
    assert.match(src, new RegExp(`PATHNAME_HEADER = "${PATHNAME_HEADER}"`));
  });
});

describe("document limiter (step 7, EDGE_DOC_LIMIT)", () => {
  it("watches the catalogue pages only", () => {
    for (const p of ["/legends", "/legends/paul-morphy", "/openings", "/openings/italian-game"]) assert.ok(isDocLimitedPath(p), p);
    for (const p of ["/learn/legends", "/play", "/legendsx", "/"]) assert.ok(!isDocLimitedPath(p), p);
  });

  it("counts full document loads, not RSC navigations or prefetches", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    assert.equal(isDocumentRequest("GET", h({})), true, "curl");
    assert.equal(isDocumentRequest("GET", h({ "sec-fetch-dest": "document" })), true);
    assert.equal(isDocumentRequest("HEAD", h({})), true);
    assert.equal(isDocumentRequest("GET", h({ rsc: "1" })), false);
    assert.equal(isDocumentRequest("GET", h({ "next-router-prefetch": "1" })), false);
    assert.equal(isDocumentRequest("GET", h({ "sec-fetch-dest": "empty" })), false);
    assert.equal(isDocumentRequest("POST", h({})), false);
  });

  it("keys on the client IP", () => {
    assert.equal(clientIpOf(new Headers({ "x-real-ip": " 1.2.3.4 ", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
    assert.equal(clientIpOf(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
    assert.equal(clientIpOf(new Headers()), "unknown");
  });

  it("the 121st request in a minute is limited, with the seconds left in the window", () => {
    const lim = createDocLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < DOC_LIMIT; i++) assert.deepEqual(lim.hit("ip", t0 + i), { limited: false }, `request ${i + 1}`);
    assert.deepEqual(lim.hit("ip", t0 + 15_000), { limited: true, retryAfterSec: 45 });
    assert.deepEqual(lim.hit("ip", t0 + 59_999), { limited: true, retryAfterSec: 1 });
    assert.deepEqual(lim.hit("other", t0 + 15_000), { limited: false }, "per key");
    assert.deepEqual(lim.hit("ip", t0 + 60_000), { limited: false }, "a new window");
  });

  it("stays bounded", () => {
    const lim = createDocLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    for (const k of ["a", "b", "c", "d"]) lim.hit(k, 0);
    assert.equal(lim.size, 3);
    assert.deepEqual(lim.hit("d", 1), { limited: true, retryAfterSec: 1 }, "the newest key is kept");
    lim.hit("e", 2000);
    assert.equal(lim.size, 1, "expired windows are dropped when the map is full");
  });

  it("rewrites to /too-many-requests with retry and from", () => {
    assert.equal(tooManyRequestsPath(45, "/legends?q=a"), "/too-many-requests?retry=45&from=%2Flegends%3Fq%3Da");
  });
});
