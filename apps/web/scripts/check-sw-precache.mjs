#!/usr/bin/env node
/* global process */
// Service-worker precache check (phase-01 plan 9.3 H8; optimization plan 4.8; the P11 precache budget).
//
// Workbox installs a worker only if every precache entry downloads. In 2026-11 a custom `workboxOptions.exclude`
// replaced next-pwa's default excludes, 148 `.js.map` files went into the list, Sentry deleted them after its upload,
// they answered 404 and no install ever succeeded. This reads the built public/sw.js and fails when an entry
//   - is a source map, a .wasm, a build manifest or a server file;
//   - does not exist in the build output (.next/ for /_next/*, public/ for the rest);
//   - or when the list is over the budget (P11: 600 KB for the offline shell).
//
//   node apps/web/scripts/check-sw-precache.mjs [--sw <path>] [--next <dir>] [--public <dir>] [--budget <bytes>]
//
// Exit 0 = ok, 1 = a bad entry or over budget, 2 = no sw.js (run `pnpm --filter web build` first).
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PRECACHE_BUDGET_BYTES = 600 * 1024;

/** The precache manifest a built sw.js passes to precacheAndRoute() (none when the list is empty). */
export function readPrecache(source) {
  const entries = [];
  let calls = 0;
  const workbox = new Proxy(
    {
      precacheAndRoute: (list) => {
        calls++;
        // Plain objects of this realm (the list was built inside the sandbox).
        for (const e of list) entries.push(typeof e === "string" ? { url: e, revision: null } : { url: String(e.url), revision: e.revision ?? null });
      },
    },
    { get: (target, key) => (key in target ? target[key] : function noop() {}) },
  );
  const sandbox = {
    location: new URL("https://app.example/sw.js"),
    skipWaiting() {},
    addEventListener() {},
    importScripts() {},
    clients: { claim() {} },
    URL,
  };
  sandbox.self = sandbox;
  sandbox.define = (_deps, factory) => factory(workbox);
  vm.runInNewContext(source, sandbox, { filename: "sw.js" });
  return { entries, calls };
}

/** Where an entry's file lives in the build output, or null for a URL that is not ours. */
export function fileFor(url, dirs) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "https://app.example/").pathname);
  } catch {
    return null;
  }
  if (pathname.startsWith("/_next/")) return path.join(dirs.next, pathname.slice("/_next/".length));
  return path.join(dirs.public, pathname);
}

const FORBIDDEN = [
  [/\.map$/i, "a source map (deleted after the Sentry upload)"],
  [/\.wasm$/i, "a .wasm (the engine is runtime-cached)"],
  [/(?:^|\/)(?:app-)?build-manifest\.json$|react-loadable-manifest\.json$|\/manifest[^/]*\.js$/i, "a build manifest"],
  [/^\/_next\/server\//, "a server file"],
];

/** Every problem with a precache list; `exists`/`size` are injectable for the unit test. */
export function checkPrecache(entries, dirs, { exists = existsSync, size = (f) => statSync(f).size, budget = PRECACHE_BUDGET_BYTES } = {}) {
  const problems = [];
  let bytes = 0;
  const seen = new Set();
  for (const { url } of entries) {
    const pathname = new URL(url, "https://app.example/").pathname;
    if (seen.has(url)) problems.push(`${url}: listed twice`);
    seen.add(url);
    const bad = FORBIDDEN.find(([re]) => re.test(pathname));
    if (bad) {
      problems.push(`${url}: ${bad[1]}`);
      continue;
    }
    const file = fileFor(url, dirs);
    if (!file || !exists(file)) {
      problems.push(`${url}: not in the build output (it would 404 and fail the install)`);
      continue;
    }
    bytes += size(file);
  }
  if (bytes > budget) problems.push(`precache is ${bytes} bytes, over the ${budget}-byte budget`);
  return { problems, bytes };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function main() {
  const sw = path.resolve(arg("--sw", path.join(WEB_DIR, "public/sw.js")));
  const dirs = {
    next: path.resolve(arg("--next", path.join(WEB_DIR, process.env.NEXT_DIST_DIR || ".next"))),
    public: path.resolve(arg("--public", path.join(WEB_DIR, "public"))),
  };
  if (!existsSync(sw)) {
    console.error(`check-sw-precache: ${path.relative(process.cwd(), sw)} not found; run \`pnpm --filter web build\` first.`);
    process.exit(2);
  }
  const { entries, calls } = readPrecache(readFileSync(sw, "utf8"));
  // Workbox leaves precacheAndRoute() out of sw.js when the list is empty (next.config.js PRECACHE_KEEP, until P11).
  if (calls > 1) {
    console.error(`check-sw-precache: expected at most one precacheAndRoute() call in sw.js, found ${calls}`);
    process.exit(1);
  }
  const { problems, bytes } = checkPrecache(entries, dirs, { budget: Number(arg("--budget", PRECACHE_BUDGET_BYTES)) });
  if (problems.length) {
    console.error(`check-sw-precache: ${problems.length} problem(s):\n- ${problems.slice(0, 40).join("\n- ")}`);
    process.exit(1);
  }
  console.log(`check-sw-precache: ${entries.length} entries, ${bytes} bytes, all present.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
