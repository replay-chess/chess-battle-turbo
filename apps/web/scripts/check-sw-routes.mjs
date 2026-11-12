#!/usr/bin/env node
/* global process */
// Service-worker route check, blocking from P1 (phase-01 plan §9.3 "Service worker" row, H8).
//
// Loads the built public/sw.js in a sandbox with a fake Workbox, records every registerRoute() in order,
// and asks Workbox's first-match rule which handler each request below would get. Fails when a request
// that can carry per-user content (a document, a fetch/XHR, /api/*, RSC, Clerk's /v1/client JSON, a share
// page or its generated image) matches any route at all (the worker must leave it to the browser, so it is
// neither stored nor answered by the worker), or when a static asset is no longer cached (a sign the rules broke).
//
//   node apps/web/scripts/check-sw-routes.mjs [--sw <path>]        (default apps/web/public/sw.js)
//
// Exit 0 = ok, 1 = a request gets the wrong handler, 2 = no sw.js (run `pnpm --filter web build` first).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argIdx = process.argv.indexOf("--sw");
const SW = argIdx > 0 ? path.resolve(process.argv[argIdx + 1]) : path.join(WEB_DIR, "public/sw.js");
const ORIGIN = "https://app.example";

/** Records the routes a built sw.js registers, in order. Exported for the unit test. */
export function loadRoutes(source) {
  const routes = [];
  const strategy = (name) =>
    class {
      constructor(opts = {}) {
        this.name = name;
        this.cacheName = opts.cacheName ?? null;
      }
    };
  const workbox = new Proxy(
    {
      registerRoute: (capture, handler, method = "GET") => routes.push({ capture, handler, method }),
      NetworkOnly: strategy("NetworkOnly"),
      NetworkFirst: strategy("NetworkFirst"),
      CacheFirst: strategy("CacheFirst"),
      CacheOnly: strategy("CacheOnly"),
      StaleWhileRevalidate: strategy("StaleWhileRevalidate"),
    },
    {
      // precacheAndRoute, cleanupOutdatedCaches, clientsClaim, ExpirationPlugin, RangeRequestsPlugin, …
      get: (target, key) => (key in target ? target[key] : function noop() {}),
    },
  );
  const sandbox = {
    location: new URL(`${ORIGIN}/sw.js`),
    skipWaiting() {},
    addEventListener() {},
    importScripts() {},
    clients: { claim() {} },
    URL,
  };
  sandbox.self = sandbox;
  sandbox.define = (_deps, factory) => factory(workbox);
  vm.runInNewContext(source, sandbox, { filename: "sw.js" });
  return routes;
}

/** Workbox's first-match rule (workbox-routing Router.findMatchingRoute + RegExpRoute semantics). */
export function handlerFor(routes, req) {
  const url = new URL(req.url);
  const sameOrigin = url.origin === ORIGIN;
  const request = {
    url: req.url,
    method: "GET",
    mode: req.mode ?? "cors",
    destination: req.destination ?? "",
    headers: new Headers(req.headers ?? {}),
  };
  for (const r of routes) {
    if (r.method !== "GET") continue;
    let hit = false;
    if (typeof r.capture === "string") {
      hit = new URL(r.capture, `${ORIGIN}/`).href === url.href;
    } else if (r.capture instanceof RegExp || Object.prototype.toString.call(r.capture) === "[object RegExp]") {
      const m = r.capture.exec(url.href);
      hit = Boolean(m) && (sameOrigin || m.index === 0);
    } else if (typeof r.capture === "function") {
      hit = Boolean(r.capture({ url, request, sameOrigin, event: {} }));
    }
    if (hit) return r.handler;
  }
  return null; // no route: the browser handles it, nothing is cached by the SW
}

const NEVER_CACHED = [
  { what: "member document /play", url: `${ORIGIN}/play`, mode: "navigate", destination: "document" },
  { what: "home document /", url: `${ORIGIN}/`, mode: "navigate", destination: "document" },
  { what: "profile document", url: `${ORIGIN}/profile/abc`, mode: "navigate", destination: "document" },
  { what: "GET /api/me", url: `${ORIGIN}/api/me` },
  { what: "RSC request", url: `${ORIGIN}/play?_rsc=abc`, headers: { RSC: "1" } },
  { what: "RSC prefetch", url: `${ORIGIN}/legends`, headers: { RSC: "1", "Next-Router-Prefetch": "1" } },
  { what: "same-origin fetch of a page", url: `${ORIGIN}/play` },
  { what: "Clerk /v1/client JSON", url: "https://clerk.example.com/v1/client?__clerk_api_version=1" },
  { what: "cross-origin fetch", url: "https://api.example.org/data.json" },
  { what: "share page document", url: `${ORIGIN}/r/abc123`, mode: "navigate", destination: "document" },
  { what: "PGN download", url: `${ORIGIN}/api/games/abc/pgn`, mode: "navigate", destination: "document" },
  { what: "pricing (paywall) document", url: `${ORIGIN}/pricing?reason=required`, mode: "navigate", destination: "document" },
  { what: "generated OG image", url: `${ORIGIN}/og/share/abc.png`, destination: "image" },
  { what: "image from /api", url: `${ORIGIN}/api/avatar/abc.png`, destination: "image" },
  { what: "same-origin JSON fetch", url: `${ORIGIN}/manifest.json` },
  { what: "socket.io polling", url: "https://ws.example.com/socket.io/?EIO=4&transport=polling" },
  { what: "iframe document", url: `${ORIGIN}/embed`, mode: "navigate", destination: "iframe" },
];
const STILL_CACHED = [
  { what: "same-origin image", url: `${ORIGIN}/board_icons/brilliant.png`, destination: "image" },
  { what: "Next static chunk", url: `${ORIGIN}/_next/static/chunks/main.js`, destination: "script" },
  { what: "Google font", url: "https://fonts.gstatic.com/s/x.woff2", destination: "font" },
  { what: "Next stylesheet", url: `${ORIGIN}/_next/static/css/a1b2.css`, destination: "style" },
  { what: "Next font", url: `${ORIGIN}/_next/static/media/a1b2-s.p.woff2`, destination: "font" },
  { what: "next/image", url: `${ORIGIN}/_next/image?url=%2Fimages%2Fa.png&w=64&q=75`, destination: "image" },
  { what: "engine wasm (worker fetch)", url: `${ORIGIN}/workers/sf18-1a3515d5bd9d/stockfish-18-lite-single.wasm` },
];

function main() {
  if (!existsSync(SW)) {
    console.error(`check-sw-routes: ${path.relative(process.cwd(), SW)} not found; run \`pnpm --filter web build\` first.`);
    process.exit(2);
  }
  const routes = loadRoutes(readFileSync(SW, "utf8"));
  const problems = [];
  for (const req of NEVER_CACHED) {
    const h = handlerFor(routes, req);
    const ok = h === null;
    console.log(`${ok ? "ok  " : "FAIL"} ${req.what}: ${h ? `${h.name}${h.cacheName ? ` (${h.cacheName})` : ""}` : "no route"}`);
    if (!ok) problems.push(`${req.what} → ${h.name}${h.cacheName ? ` "${h.cacheName}"` : ""} (must match no route)`);
  }
  for (const req of STILL_CACHED) {
    const h = handlerFor(routes, req);
    const ok = Boolean(h) && h.name !== "NetworkOnly";
    console.log(`${ok ? "ok  " : "FAIL"} ${req.what}: ${h ? `${h.name}${h.cacheName ? ` (${h.cacheName})` : ""}` : "no route"}`);
    if (!ok) problems.push(`${req.what} is no longer cached`);
  }
  if (problems.length) {
    console.error(`\ncheck-sw-routes: ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`\ncheck-sw-routes: ${routes.length} routes, per-user requests never cached.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
