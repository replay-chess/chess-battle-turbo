// check-sw-precache.mjs: the precache list of a built sw.js must hold only files that exist, never a source map.
// regression: 2026-11, a custom workboxOptions.exclude dropped next-pwa's default excludes; 148 deleted .js.map files
// in the list made every install fail, so the service worker never activated.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPrecache, fileFor, PRECACHE_BUDGET_BYTES, readPrecache } from "./check-sw-precache.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = { next: "/b/.next", public: "/b/public" };

/** A minimal sw.js in next-pwa's output shape. */
const swSource = (list: unknown[]) =>
  `define(["./workbox-x"],function(e){"use strict";importScripts(),self.skipWaiting(),e.clientsClaim(),` +
  `e.precacheAndRoute(${JSON.stringify(list)},{ignoreURLParametersMatching:[/^utm_/]}),e.cleanupOutdatedCaches(),` +
  `e.registerRoute(()=>!1,new e.NetworkOnly,"GET")});`;

test("readPrecache returns the list a built sw.js precaches", () => {
  const { entries, calls } = readPrecache(swSource([{ url: "/_next/static/chunks/a-1.js", revision: null }, "/x.png"]));
  assert.equal(calls, 1);
  assert.deepEqual(entries, [
    { url: "/_next/static/chunks/a-1.js", revision: null },
    { url: "/x.png", revision: null },
  ]);
});

test("fileFor maps /_next/* to the dist dir and the rest to public/, decoding the URL", () => {
  assert.equal(fileFor("/_next/static/chunks/app/(app)/game/%5Bref%5D/page-1.js", dirs), "/b/.next/static/chunks/app/(app)/game/[ref]/page-1.js");
  assert.equal(fileFor("/icons/a%20b.png", dirs), "/b/public/icons/a b.png");
});

test("a source map fails the check even when the file exists", () => {
  const { problems } = checkPrecache([{ url: "/_next/static/chunks/main-1.js.map" }], dirs, { exists: () => true, size: () => 1 });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /source map/);
});

test("an entry missing from the build output fails the check", () => {
  const { problems } = checkPrecache([{ url: "/_next/static/chunks/gone-1.js" }], dirs, { exists: () => false });
  assert.match(problems[0]!, /not in the build output/);
});

test("wasm, build manifests and server files fail; present assets pass and count toward the budget", () => {
  const bad = ["/workers/sf18-0123456789ab/stockfish.wasm", "/_next/app-build-manifest.json", "/_next/server/app/page.js"];
  assert.equal(checkPrecache(bad.map((url) => ({ url })), dirs, { exists: () => true, size: () => 1 }).problems.length, 3);
  const ok = checkPrecache([{ url: "/_next/static/css/a.css" }, { url: "/icons/i.png" }], dirs, { exists: () => true, size: () => 10 });
  assert.deepEqual(ok, { problems: [], bytes: 20 });
  const over = checkPrecache([{ url: "/a.js" }], dirs, { exists: () => true, size: () => PRECACHE_BUDGET_BYTES + 1 });
  assert.match(over.problems[0]!, /over the/);
});

// The real build, when one is present (CI runs the script itself after `pnpm --filter web build`).
const builtSw = path.join(WEB_DIR, "public/sw.js");
const builtNext = path.join(WEB_DIR, process.env.NEXT_DIST_DIR || ".next");
test("the built sw.js precaches only files that exist, and no source map", { skip: !existsSync(builtSw) || !existsSync(builtNext) }, () => {
  const { entries } = readPrecache(readFileSync(builtSw, "utf8"));
  const { problems } = checkPrecache(entries, { next: builtNext, public: path.join(WEB_DIR, "public") });
  assert.deepEqual(problems, []);
});
