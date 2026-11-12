// The bundle budget gate (scripts/check-bundle-budgets.mjs) on a synthetic `next build` output.
// regression: p3-budgets-report-only (FIX-2, review round 2): the P3 route rows were `report: true`, so /review at
// 455 kB against its 300 kB budget passed the build.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-bundle-budgets.mjs");
const ROUTES = [
  "/(app)/game/[ref]/page",
  "/(app)/review/[ref]/page",
  "/(app)/review/[ref]/complete/page",
  "/(app)/review/[ref]/share/page",
  "/(app)/review/[ref]/legend/page",
  "/(app)/games/page",
  "/(app)/practice/page",
  "/r/[code]/page",
  "/how-we-grade/page",
];

/**
 * A dist dir where every route loads one shared 50 kB chunk plus its own chunk of `own[route]` kB (incompressible).
 * `handlers` lists routes served by a route handler instead (no page entry; server/app-paths-manifest.json).
 */
function dist(own: Record<string, number>, handlers: string[] = []): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  mkdirSync(path.join(dir, "static", "chunks"), { recursive: true });
  const chunk = (name: string, kb: number) => {
    // Random bytes do not compress: gzip adds about 1 %, so this lands on `kb` gzipped.
    writeFileSync(path.join(dir, "static", "chunks", name), randomBytes(Math.round((kb * 1000) / 1.01)).toString("latin1"));
    return `static/chunks/${name}`;
  };
  const shared = chunk("shared.js", 50);
  const pages: Record<string, string[]> = {};
  ROUTES.forEach((r, i) => {
    if (!handlers.includes(r)) pages[r] = [shared, chunk(`own-${i}.js`, own[r] ?? 10)];
  });
  writeFileSync(path.join(dir, "app-build-manifest.json"), JSON.stringify({ pages }));
  mkdirSync(path.join(dir, "server"), { recursive: true });
  const appPaths = Object.fromEntries(handlers.map((r) => [r.replace(/\/page$/, "/route"), "app/route.js"]));
  writeFileSync(path.join(dir, "server", "app-paths-manifest.json"), JSON.stringify(appPaths));
  writeFileSync(path.join(dir, "build-manifest.json"), JSON.stringify({ rootMainFiles: [shared] }));
  return dir;
}

const run = (dir: string) => spawnSync(process.execPath, [SCRIPT, "--dist", dir], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });

describe("check-bundle-budgets", () => {
  it("passes when every route is under its budget", () => {
    const out = run(dist({}));
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /\*\*OK\*\*/);
  });

  it("fails the build for a P3 route over its budget (/review ≤ 300, /games ≤ 230, /r ≤ 120, /how-we-grade ≤ 180)", () => {
    for (const [route, label, kb] of [
      ["/(app)/review/[ref]/page", "/review/[ref]", 260],
      ["/(app)/games/page", "/games", 190],
      ["/r/[code]/page", "/r/[code]", 80],
      ["/how-we-grade/page", "/how-we-grade", 140],
    ] as const) {
      const out = run(dist({ [route]: kb }));
      assert.equal(out.status, 1, `${label}: ${out.stdout}`);
      assert.ok(out.stdout.includes(`${label} First Load JS`) && out.stdout.includes("is over its budget"), out.stdout);
      assert.doesNotMatch(out.stdout, /not blocking|reported/);
    }
  });

  it("/r/[code] as a route handler has no client JS; missing altogether it fails", () => {
    const ok = run(dist({}, ["/r/[code]/page"]));
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /\/r\/\[code\] First Load JS \| 0\.0 kB \(budget 120 kB, route handler, no client JS/);
    const dir = dist({}, ["/r/[code]/page"]);
    writeFileSync(path.join(dir, "server", "app-paths-manifest.json"), "{}");
    const gone = run(dir);
    assert.equal(gone.status, 1);
    assert.match(gone.stdout, /route \/r\/\[code\] \(\/r\/\[code\]\/page\) is not in app-build-manifest\.json/);
  });
});
