// Route classes (plan phase-01 §7.6, §12.1 route-classes row). The concrete paths come from REPO/docs/route-map.md §3,
// so the doc and the classifier can't drift apart; the middleware matcher is checked with Next's own compiler.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SCANNER, classify, compilePattern, createClassifier, type RouteClass, type RouteClassSet } from "./index";
import * as p01 from "./p01";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");
const ROUTE_MAP = path.resolve(HERE, "../../../../../docs/route-map.md");

const CLASSES = ["public", "member", "signed_in", "api_no_clerk", "scanner"] as const satisfies readonly RouteClass[];

function listFor(doc: string, cls: string): string[] {
  const at = doc.indexOf(`<!-- route-classes:p01:${cls} -->`);
  assert.ok(at >= 0, `route-map.md has no ${cls} list`);
  const body = /```text\n([\s\S]*?)```/.exec(doc.slice(at))?.[1] ?? "";
  const paths = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  assert.ok(paths.length > 0, `${cls} list is empty`);
  return paths;
}

describe("route-map.md §3 ↔ classify()", () => {
  const doc = readFileSync(ROUTE_MAP, "utf8");
  for (const cls of CLASSES) {
    it(`every ${cls} path in the doc is classified ${cls}`, () => {
      for (const p of listFor(doc, cls)) assert.equal(classify(p), cls, p);
    });
  }

  it("the doc lists each path once", () => {
    const all = CLASSES.flatMap((c) => listFor(doc, c));
    assert.equal(new Set(all).size, all.length);
  });
});

describe("classify() boundaries (plan §12.1)", () => {
  const rows: [string, RouteClass][] = [
    ["/playlist", "signed_in"],
    ["/play/", "member"],
    ["/play/bots/x", "member"],
    ["/join/abc", "member"],
    ["/join-tournament/x", "member"],
    ["/joinx", "signed_in"],
    ["/tournaments", "member"],
    ["/tournament/x", "member"],
    ["/game/x", "member"],
    ["/onboarding", "signed_in"],
    ["/admin", "signed_in"],
    ["/admin/tournaments/create", "signed_in"],
    ["/profile", "signed_in"],
    ["/profile/x", "public"],
    ["/legends", "public"],
    ["/legendsx", "signed_in"],
    ["/sitemap.xml", "public"],
    ["/sitemap/0.xml", "public"],
    ["/blog/rss.xml", "public"],
    ["/unknown-page", "signed_in"],
    ["/api/me", "api"],
    ["/api/billing/refresh", "api"],
    ["/api/session/clear", "api"],
    ["/api/socket-token", "api"],
    ["/api/scraper/positions/import", "api"],
    ["/api/openings", "api_no_clerk"],
    ["/api/openings/x", "api"],
    ["/api/health", "api_no_clerk"],
    ["/api/healthz", "api"],
    ["/api/webhook/dodo-payments", "api_no_clerk"],
    ["/api/webhook/clerk", "api_no_clerk"],
    ["/api/cron/daily", "api_no_clerk"],
    ["/apix", "signed_in"],
    ["/trpc/x", "api"],
    ["/wp-login.php", "scanner"],
    ["/wp-admin/setup-config.php", "scanner"],
    ["/x/.env", "scanner"],
    ["/.env", "scanner"],
    ["/.git/config", "scanner"],
    ["/index.php", "scanner"],
    ["/legends/x.php", "scanner"],
    ["/api/x.php", "scanner"],
    ["/cgi-bin/luci", "scanner"],
    ["/phpMyAdmin/", "scanner"],
    ["/backup.sql", "scanner"],
    ["/default.aspx", "scanner"],
  ];
  for (const [p, expected] of rows) it(`${p} → ${expected}`, () => assert.equal(classify(p), expected));

  it("no real P1 page path is a scanner path", () => {
    for (const list of [p01.publicPages, p01.memberPages, p01.signedInPages, p01.noClerkApi]) {
      for (const pattern of list) assert.equal(SCANNER.test(pattern.replace(/\(\.\*\)$/, "")), false, pattern);
    }
  });
});

describe("compilePattern()", () => {
  it("exact, subtree-with-self and subtree-only", () => {
    assert.ok(compilePattern("/pricing").test("/pricing"));
    assert.ok(!compilePattern("/pricing").test("/pricing/x"));
    assert.ok(compilePattern("/blog(.*)").test("/blog"));
    assert.ok(compilePattern("/blog(.*)").test("/blog/a/b"));
    assert.ok(!compilePattern("/blog(.*)").test("/blogs"));
    assert.ok(compilePattern("/profile/(.*)").test("/profile/x"));
    assert.ok(!compilePattern("/profile/(.*)").test("/profile"));
    assert.ok(compilePattern("/sitemap-legends.xml").test("/sitemap-legends.xml"));
    assert.ok(!compilePattern("/sitemap-legends.xml").test("/sitemap-legendsAxml"), "dots are literal");
    assert.ok(compilePattern("/").test("/"));
  });

  it("rejects anything else", () => {
    assert.throws(() => compilePattern("play"));
    assert.throws(() => compilePattern("/play(.+)"));
    assert.throws(() => compilePattern("/(a|b)"));
  });

  it("every p01 pattern compiles", () => {
    for (const list of [p01.publicPages, p01.memberPages, p01.signedInPages, p01.noClerkApi]) {
      for (const pattern of list) assert.doesNotThrow(() => compilePattern(pattern), pattern);
    }
  });
});

describe("phase files (later phases add data, never edit middleware)", () => {
  const empty: RouteClassSet = { publicPages: [], memberPages: [], signedInPages: [], noClerkApi: [] };

  it("the newest phase that lists a path decides its class", () => {
    const later: RouteClassSet = { ...empty, publicPages: ["/tournaments"] };
    const c = createClassifier([p01, later]);
    assert.equal(c("/tournaments"), "public");
    assert.equal(c("/tournaments/x"), "member", "p01 still owns the subtree");
    assert.equal(c("/play"), "member");
  });

  it("a later phase can add member pages and no-Clerk APIs", () => {
    const later: RouteClassSet = { ...empty, memberPages: ["/train(.*)"], noClerkApi: ["/api/billing/activation"] };
    const c = createClassifier([p01, later]);
    assert.equal(c("/train/bank"), "member");
    assert.equal(c("/api/billing/activation"), "api_no_clerk");
    assert.equal(c("/api/openings"), "api_no_clerk", "earlier phases still count");
  });

  it("within one phase the stricter class wins an overlap", () => {
    const c = createClassifier([{ ...empty, publicPages: ["/x(.*)"], memberPages: ["/x/y"] }]);
    assert.equal(c("/x/y"), "member");
    assert.equal(c("/x/z"), "public");
  });
});

describe("middleware.ts matcher (compiled by Next)", () => {
  const require = createRequire(import.meta.url);
  const { getMiddlewareMatchers } = require(path.join(WEB, "node_modules/next/dist/build/analysis/get-page-static-info.js")) as {
    getMiddlewareMatchers: (m: string[], cfg: Record<string, unknown>) => { regexp: string }[];
  };
  const src = readFileSync(path.join(WEB, "middleware.ts"), "utf8");
  const block = src.slice(src.indexOf("matcher: ["));
  const sources = [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\\\/g, "\\"));
  const matchers = getMiddlewareMatchers(sources, {}).map((m) => new RegExp(m.regexp));
  const runs = (p: string) => matchers.some((re) => re.test(p));

  it("has the two matcher entries", () => assert.equal(sources.length, 2));

  it("runs for pages, scanner probes and Clerk-backed APIs", () => {
    for (const p of [
      "/",
      "/play",
      "/onboarding",
      "/legends/x",
      "/wp-login.php",
      "/x/.env",
      "/.git/config",
      "/manifest.json",
      "/robots.txt",
      "/sitemap.xml",
      "/api/me",
      "/api/billing/refresh",
      "/api/openings/x",
      "/api/scraper/positions/import",
      "/api/foo.png",
      "/ogre",
    ]) {
      assert.equal(runs(p), true, p);
    }
  });

  it("skips no-Clerk APIs, internals and static files (OPT §4.2)", () => {
    for (const p of [
      "/api/openings",
      "/api/health",
      "/api/healthcheck",
      "/api/webhook/clerk",
      "/api/webhook/dodo-payments",
      "/api/cron/daily",
      "/og",
      "/og/x",
      "/monitoring",
      "/ingest/e",
      "/workers/stockfish.js",
      "/_next/static/chunks/a.js",
      "/sw.js",
      "/logo.png",
    ]) {
      assert.equal(runs(p), false, p);
    }
  });
});
