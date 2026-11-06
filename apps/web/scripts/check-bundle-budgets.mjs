#!/usr/bin/env node
/* global process */
// Bundle budget, blocking from P1 (phase-01 plan §9.5, §12.8, §13.4; CA AP-12).
//
// Reads a finished `next build` (app router) and fails when:
//   1. shared First Load JS (gzip) grew more than BUDGET_KB over the recorded baseline;
//   2. any client chunk contains zod (the literal class name `ZodError`) — zod response schemas must stay
//      dev/test-only (lib/api/schema.ts). Chunks loaded only by /dev/** routes are exempt: those pages are
//      404 in production builds and never load on a user route;
//   3. any client chunk contains the TanStack Query devtools (dev-only, plan §9.5);
//   4. a route in ROUTE_BUDGETS is over its First Load JS (gzip, the page entry as `next build` prints it), or loads
//      engine code it must not (phase-02 plan 12.8 / DoD: `/game/[ref]` ≤ 600 kB gz, owner-approved 2026-11-06, and
//      no engine chunk on the PvP path; the bot screen and the engine stay lazy chunks).
//
//   node apps/web/scripts/check-bundle-budgets.mjs [--dist <dir>] [--markdown <file>] [--json <file>]
//   node apps/web/scripts/check-bundle-budgets.mjs --record-baseline     prints a BASELINE literal for this file
//
// --dist defaults to $NEXT_DIST_DIR, else .next (relative to apps/web). --markdown defaults to
// $GITHUB_STEP_SUMMARY when set, so CI attaches the report to the run.
// Exit 0 = within budget, 1 = over budget, 2 = no build or unreadable manifests.
//
// "Shared First Load JS" is measured the way `next build` prints "First Load JS shared by all": the gzip size
// (level 9, kB = 1000 bytes) of the JS files every app route loads. The baseline comes from this script run on
// the same kind of build (ci.yml's test-mode build), so the two numbers compare like for like.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * Recorded with --record-baseline from a ci.yml-equivalent build of the stage-A commit 9f2e480
 * (NEXT_PUBLIC_APP_ENV=test, ALLOW_TEST_HOOKS=1, blank telemetry keys). `next build` printed 333 kB, the same
 * as the plan's 0848b76 reference (§9.5, AC §10.1). Raise it only with the owner's OK in the PR.
 */
const BASELINE = {
  commit: "9f2e480",
  sharedGzipBytes: 333_101,
  sharedFiles: 6,
};
const BUDGET_KB = 25;

// zod itself: v4 core names its error class "$ZodError"; v3 has "ZodError" next to issue codes such as
// "invalid_type". The bare word alone is not enough: @sentry/nextjs's lazy zodErrors integration compares
// `error.name === "ZodError"` without shipping zod.
const isZod = (text) => text.includes("$ZodError") || (/ZodError(?![A-Za-z0-9_$])/.test(text) && text.includes("invalid_type"));
const DEVTOOLS_MARKER = /ReactQueryDevtools|TanstackQueryDevtools/;
const DEV_ONLY_ROUTE = /^\/dev(\/|$)/;
// Engine glue (features/engine): the shim path, the Stockfish build and the UCI handshake. Only lazy chunks may hold it.
const ENGINE_MARKER = /engine-shim|stockfish|sf18-|uciok/i;
/** Per-route First Load budgets (app-build-manifest page entries). regression: REGRESSION-2 (the P2 row was missing). */
const ROUTE_BUDGETS = [{ route: "/(app)/game/[ref]/page", label: "/game/[ref]", maxKB: 600, noEngine: true }];

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const distDir = path.resolve(web, opt("--dist") ?? process.env.NEXT_DIST_DIR ?? ".next");
const markdownOut = opt("--markdown") ?? process.env.GITHUB_STEP_SUMMARY;
const jsonOut = opt("--json");
const recordBaseline = args.includes("--record-baseline");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(path.join(distDir, file), "utf8"));
  } catch (err) {
    console.error(`check-bundle-budgets: cannot read ${path.join(distDir, file)} (${err.message}). Run \`next build\` first.`);
    process.exit(2);
  }
}

const gzipCache = new Map();
function gzipBytes(rel) {
  if (!gzipCache.has(rel)) gzipCache.set(rel, gzipSync(readFileSync(path.join(distDir, rel)), { level: 9 }).length);
  return gzipCache.get(rel);
}
const kB = (bytes) => (bytes / 1000).toFixed(1);

const appManifest = readJson("app-build-manifest.json");
const buildManifest = readJson("build-manifest.json");
const routes = Object.keys(appManifest.pages ?? {});
if (routes.length === 0) {
  console.error("check-bundle-budgets: app-build-manifest.json lists no app routes");
  process.exit(2);
}

// 1. Shared First Load JS: JS files present in every app route's list.
const routesOfFile = new Map();
for (const route of routes) {
  for (const file of new Set(appManifest.pages[route])) {
    if (!file.endsWith(".js")) continue;
    if (!routesOfFile.has(file)) routesOfFile.set(file, new Set());
    routesOfFile.get(file).add(route);
  }
}
const sharedFiles = [...routesOfFile].filter(([, r]) => r.size === routes.length).map(([f]) => f).sort();
const sharedBytes = sharedFiles.reduce((n, f) => n + gzipBytes(f), 0);
const rootMain = (buildManifest.rootMainFiles ?? []).filter((f) => f.endsWith(".js"));
const rootMainBytes = rootMain.reduce((n, f) => n + gzipBytes(f), 0);

if (recordBaseline) {
  const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? "<commit>";
  console.log(`const BASELINE = {\n  commit: "${sha}",\n  sharedGzipBytes: ${sharedBytes},\n  sharedFiles: ${sharedFiles.length},\n};`);
  console.log(`(shared First Load JS ${kB(sharedBytes)} kB; rootMainFiles ${kB(rootMainBytes)} kB)`);
  process.exit(0);
}

// 2 + 3. Scan every client chunk.
const chunksDir = path.join(distDir, "static", "chunks");
const chunks = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".js")) chunks.push(path.relative(distDir, full).split(path.sep).join("/"));
  }
})(chunksDir);

const zodHits = [];
const zodExempt = [];
const devtoolsHits = [];
for (const chunk of chunks) {
  const text = readFileSync(path.join(distDir, chunk), "utf8");
  if (DEVTOOLS_MARKER.test(text)) devtoolsHits.push(chunk);
  if (!isZod(text)) continue;
  const users = [...(routesOfFile.get(chunk) ?? [])];
  if (users.length > 0 && users.every((r) => DEV_ONLY_ROUTE.test(r))) zodExempt.push({ chunk, routes: users });
  else zodHits.push({ chunk, routes: users });
}

const limitBytes = BASELINE.sharedGzipBytes + BUDGET_KB * 1000;
const deltaBytes = sharedBytes - BASELINE.sharedGzipBytes;
const failures = [];
if (sharedBytes > limitBytes) {
  failures.push(`shared First Load JS ${kB(sharedBytes)} kB is over the budget ${kB(limitBytes)} kB (baseline ${kB(BASELINE.sharedGzipBytes)} kB @ ${BASELINE.commit} + ${BUDGET_KB} kB)`);
}
for (const h of zodHits) {
  const where = h.routes.length ? `loaded by ${h.routes.length} route(s): ${h.routes.slice(0, 5).join(", ")}${h.routes.length > 5 ? ", …" : ""}` : "lazy chunk (dynamic import)";
  failures.push(`zod (ZodError) in client chunk ${h.chunk}, ${where}. Pass response schemas as \`process.env.NODE_ENV === "production" ? undefined : Schema\` (lib/api/schema.ts) and import contract values only there`);
}
for (const c of devtoolsHits) failures.push(`TanStack Query devtools in client chunk ${c} (must stay dev-only)`);

// 4. Route budgets.
const routeRows = [];
for (const b of ROUTE_BUDGETS) {
  const files = [...new Set(appManifest.pages[b.route] ?? [])].filter((f) => f.endsWith(".js"));
  if (files.length === 0) {
    failures.push(`route ${b.label} (${b.route}) is not in app-build-manifest.json`);
    continue;
  }
  const bytes = files.reduce((n, f) => n + gzipBytes(f), 0);
  const engine = b.noEngine ? files.filter((f) => ENGINE_MARKER.test(readFileSync(path.join(distDir, f), "utf8"))) : [];
  routeRows.push({ ...b, gzipBytes: bytes, files: files.length, engine });
  if (bytes > b.maxKB * 1000) failures.push(`${b.label} First Load JS ${kB(bytes)} kB is over its budget ${b.maxKB} kB`);
  for (const f of engine) failures.push(`${b.label} loads engine code in ${f} (the engine must stay a lazy chunk)`);
}

// Report
const sign = deltaBytes >= 0 ? "+" : "−";
const lines = [
  "### Bundle budget (phase-01 plan §9.5)",
  "",
  `| | gzip |`,
  `|---|---|`,
  `| Shared First Load JS | **${kB(sharedBytes)} kB** (${sharedFiles.length} files) |`,
  `| Baseline (${BASELINE.commit}) | ${kB(BASELINE.sharedGzipBytes)} kB |`,
  `| Delta | ${sign}${kB(Math.abs(deltaBytes))} kB (budget +${BUDGET_KB} kB) |`,
  `| Client chunks scanned | ${chunks.length} |`,
  `| zod in client chunks | ${zodHits.length ? `**${zodHits.length}**` : "0"}${zodExempt.length ? ` (+${zodExempt.length} on /dev/** only, exempt)` : ""} |`,
  `| Query devtools in client chunks | ${devtoolsHits.length} |`,
  ...routeRows.map(
    (r) => `| ${r.label} First Load JS | ${kB(r.gzipBytes)} kB (budget ${r.maxKB} kB${r.noEngine ? `, engine chunks ${r.engine.length}` : ""}) |`,
  ),
  "",
  "<details><summary>Shared files</summary>",
  "",
  ...sharedFiles.map((f) => `- \`${f}\` ${kB(gzipBytes(f))} kB`),
  "",
  "</details>",
  "",
  failures.length ? `**FAIL**\n\n${failures.map((f) => `- ${f}`).join("\n")}` : "**OK**",
  "",
];
const report = lines.join("\n");
console.log(report);
if (markdownOut) {
  try {
    appendFileSync(markdownOut, `${report}\n`);
  } catch (err) {
    console.error(`check-bundle-budgets: cannot write ${markdownOut}: ${err.message}`);
  }
}
if (jsonOut) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify(
      {
        baseline: BASELINE,
        budgetKB: BUDGET_KB,
        sharedGzipBytes: sharedBytes,
        deltaBytes,
        sharedFiles: sharedFiles.map((f) => ({ file: f, gzipBytes: gzipBytes(f) })),
        zod: zodHits,
        zodExemptDevOnly: zodExempt,
        devtools: devtoolsHits,
        routes: routeRows,
        ok: failures.length === 0,
      },
      null,
      2,
    )}\n`,
  );
}
if (!existsSync(chunksDir)) process.exit(2);
process.exit(failures.length ? 1 : 0);
