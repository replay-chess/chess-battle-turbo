// The phase-04 route catalogue (plan §7.0; FIX-1): every route of the table is a route() handler with the plan's
// explicit `maxDuration` (seconds, Vercel's function limit). DEV-1 is the documented exception to "route()": a test hook
// must answer 404 to every request in a production build, which route() cannot do because it validates the body and
// authenticates before its handler (app/api/dev/import-fault/route.ts header). It still declares its maxDuration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { listRouteFiles, WEB } from "../helpers/route-modules";

/** §7.0: ID → route file (relative to apps/web) → maxDuration. */
const CATALOGUE: { id: string; file: string; maxDuration: number; routeHandler: boolean }[] = [
  { id: "ACC-1", file: "app/api/accounts/route.ts", maxDuration: 10, routeHandler: true },
  { id: "ACC-2", file: "app/api/accounts/chesscom/lookup/route.ts", maxDuration: 15, routeHandler: true },
  { id: "ACC-3", file: "app/api/accounts/chesscom/route.ts", maxDuration: 15, routeHandler: true },
  { id: "OAU-1", file: "app/api/accounts/lichess/start/route.ts", maxDuration: 10, routeHandler: true },
  { id: "OAU-2", file: "app/api/accounts/lichess/callback/route.ts", maxDuration: 15, routeHandler: true },
  { id: "ACC-4", file: "app/api/accounts/[provider]/sync/route.ts", maxDuration: 10, routeHandler: true },
  // ACC-5 (PATCH, 10) and ACC-6 (DELETE, 15) share one file; Vercel's limit is per file: the larger one.
  { id: "ACC-5/ACC-6", file: "app/api/accounts/[provider]/route.ts", maxDuration: 15, routeHandler: true },
  { id: "ACC-7", file: "app/api/import/status/route.ts", maxDuration: 10, routeHandler: true },
  { id: "ACC-8", file: "app/api/import/[ref]/retry/route.ts", maxDuration: 10, routeHandler: true },
  { id: "ME-4", file: "app/api/me/onboarding/route.ts", maxDuration: 10, routeHandler: true },
  { id: "ME-1", file: "app/api/me/route.ts", maxDuration: 10, routeHandler: true },
  { id: "BIL-1", file: "app/api/checkout/route.ts", maxDuration: 30, routeHandler: true },
  { id: "BIL-2", file: "app/api/billing/activation/route.ts", maxDuration: 15, routeHandler: true },
  { id: "WH-1", file: "app/api/webhook/dodo-payments/route.ts", maxDuration: 15, routeHandler: true },
  { id: "DEV-1", file: "app/api/dev/import-fault/route.ts", maxDuration: 10, routeHandler: false },
  // P1's cron (CHANGE in P4: task files only): not route() yet, as contract.test.ts records; out of P4's scope.
  { id: "CRON-1", file: "app/api/cron/daily/route.ts", maxDuration: 60, routeHandler: false },
];

const MAX_DURATION = /export\s+const\s+maxDuration\s*=\s*(\d+)\s*;/;

describe("phase-04 route catalogue (§7.0)", () => {
  it("regression: route-catalogue-max-duration (FIX-1): every catalogue route declares the plan's maxDuration", () => {
    for (const row of CATALOGUE) {
      const source = readFileSync(path.join(WEB, row.file), "utf8");
      const m = MAX_DURATION.exec(source);
      assert.ok(m, `${row.id} ${row.file}: no explicit maxDuration`);
      assert.equal(Number(m[1]), row.maxDuration, `${row.id} ${row.file}`);
    }
  });

  it("every catalogue route is a route() handler, DEV-1 (documented) and P1's CRON-1 excepted", () => {
    const files = new Map(listRouteFiles().map((f) => [f.file, f]));
    for (const row of CATALOGUE) {
      const f = files.get(row.file);
      assert.ok(f, `${row.id}: ${row.file} exists`);
      assert.equal(f.usesRoute, row.routeHandler, `${row.id} ${row.file}`);
    }
    assert.match(readFileSync(path.join(WEB, "app/api/dev/import-fault/route.ts"), "utf8"), /Not a route\(\) handler, on purpose/);
  });
});
