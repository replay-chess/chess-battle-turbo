// The maintenance gate (phase-04 plan §5.8, §7.10; api-design step 3; FIX-1): MAINTENANCE_AFFECTS=import answers every
// /api/accounts/* and /api/import/* route with 503 maintenance {affects: ["import"]} before auth or any read, and
// leaves the rest of the API (and webhooks) alone.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { HTTP_ENDPOINTS } from "@repo/contracts/http/registry";
import { affectedAreas, maintenanceAreaOf, maintenanceError, MAINTENANCE_DEFAULT_RETRY_SEC } from "@/lib/api/maintenance";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../helpers/route-harness";

(globalThis as { prismaRc?: unknown }).prismaRc = { user: { findUnique: async () => null } };

const { GET: accountsList } = await import("@/app/api/accounts/route");
const { GET: importStatus } = await import("@/app/api/import/status/route");
const { GET: getMe } = await import("@/app/api/me/route");

let restore: (() => void)[] = [];
afterEach(() => {
  for (const r of restore.reverse()) r();
  restore = [];
});

describe("maintenance gate (FIX-1)", () => {
  it("regression: maintenance-affects-import: the import area answers 503 maintenance {affects: [import]} with Retry-After", async () => {
    const t = installTestDeps({ env: { MAINTENANCE_AFFECTS: "import" }, userId: "user_1", viewer: viewerFixture() });
    restore.push(t.restore);
    for (const [handler, path] of [
      [accountsList, "/api/accounts"],
      [importStatus, "/api/import/status"],
    ] as const) {
      const res = await handler(request(path), noParams());
      assert.equal(res.status, 503, path);
      assert.equal(res.headers.get("retry-after"), String(MAINTENANCE_DEFAULT_RETRY_SEC));
      const err = (await jsonOf(res)).error as { code: string; details: { affects: string[] } };
      assert.equal(err.code, "maintenance");
      assert.deepEqual(err.details.affects, ["import"]);
    }
    assert.equal(t.recorded.authCalls, 0, "answered before auth");
    assert.equal(t.recorded.viewerCalls, 0, "and before any read");
    // The rest of the API is up.
    assert.equal((await getMe(request("/api/me"), noParams())).status, 200);
  });

  it("which routes are in the area, and MAINTENANCE_RETRY_AT", () => {
    const inArea: string[] = HTTP_ENDPOINTS.filter((e) => maintenanceAreaOf(e) === "import").map((e) => e.path);
    for (const p of inArea) assert.ok(p.startsWith("/api/accounts") || p.startsWith("/api/import"), p);
    for (const must of ["/api/accounts", "/api/accounts/chesscom/lookup", "/api/accounts/lichess/callback", "/api/import/status"]) {
      assert.ok(inArea.includes(must), must);
    }
    assert.equal(maintenanceAreaOf({ path: "/api/webhook/dodo-payments", auth: "webhook" }), null);
    assert.equal(maintenanceAreaOf({ path: "/api/me", auth: "user" }), null);
    assert.deepEqual([...affectedAreas({ MAINTENANCE_AFFECTS: " Import , nonsense " })], ["import"]);
    assert.deepEqual([...affectedAreas({})], []);
    const now = Date.parse("2026-11-13T10:00:00.000Z");
    const e = maintenanceError({ path: "/api/import/status", auth: "user" }, { MAINTENANCE_AFFECTS: "import", MAINTENANCE_RETRY_AT: "2026-11-13T10:20:00.000Z" }, now)!;
    assert.equal(e.retryAfterSec, 1200);
    assert.deepEqual(e.details, { affects: ["import"], retryAt: "2026-11-13T10:20:00.000Z" });
    assert.equal(maintenanceError({ path: "/api/import/status", auth: "user" }, {}, now), null);
  });
});
