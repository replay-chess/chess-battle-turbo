// Authz walker (plan §12.2, CT P1). Globs every app/api/**/route.ts:
// - each exported HTTP method is either a route() handler (its auth comes from the registry; contract.test.ts runs
//   the matrix) or has a row in legacy-routes.ts, so a new unwrapped route cannot land silently;
// - no stale rows (file gone, method gone, or already route());
// - with AUTHZ_BASE_URL (a running app: `next dev`, `next start` in CI's e2e job, or the dev URL), every legacy row
//   is called signed out and must answer its `anonymous` status, and every route() endpoint must answer what its
//   auth mode implies. Legacy handlers call Clerk's auth(), which only works inside a Next request, so the
//   signed-out call goes over HTTP rather than in-process.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EndpointDef } from "@repo/contracts/http/endpoint";
import { HTTP_ENDPOINTS } from "@repo/contracts/http/registry";
import { listRouteFiles, toRegistryPath } from "../helpers/route-modules";
import { LEGACY_ROUTES } from "./legacy-routes";

const files = listRouteFiles();
const BASE_URL = process.env.AUTHZ_BASE_URL?.replace(/\/$/, "");
const SAMPLE_ID = "cabcdefghijklmnopqrstuvwx";

describe("authz walker: every route file is accounted for", () => {
  it("found the route files", () => {
    assert.ok(files.length >= 40, `only ${files.length} route files found`);
  });

  it("each export is route() or has a legacy row", () => {
    const missing: string[] = [];
    for (const f of files) {
      if (f.usesRoute) continue;
      for (const method of f.methods) {
        if (!LEGACY_ROUTES.some((r) => r.file === f.file && r.method === method)) missing.push(`${method} ${f.file}`);
      }
    }
    assert.deepEqual(missing, [], `wrap these in route() or add a row to test/authz/legacy-routes.ts:\n${missing.join("\n")}`);
  });

  it("each route() file maps to registry entries (its path is declared)", () => {
    const paths = new Set((HTTP_ENDPOINTS as readonly EndpointDef[]).map((e) => e.path));
    for (const f of files.filter((x) => x.usesRoute)) {
      assert.ok(paths.has(toRegistryPath(f.urlPath)), `${f.file}: no registry entry for ${toRegistryPath(f.urlPath)}`);
    }
  });

  it("no stale legacy rows", () => {
    const stale: string[] = [];
    for (const row of LEGACY_ROUTES) {
      const f = files.find((x) => x.file === row.file);
      if (!f) stale.push(`${row.method} ${row.file}: file not found`);
      else if (f.usesRoute) stale.push(`${row.method} ${row.file}: now route(); delete the row`);
      else if (!f.methods.includes(row.method)) stale.push(`${row.method} ${row.file}: method not exported`);
    }
    assert.deepEqual(stale, []);
  });

  it("legacy rows are unique", () => {
    const keys = LEGACY_ROUTES.map((r) => `${r.method} ${r.file}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

/** What a signed-out caller gets from a route() endpoint, by auth mode. */
function expectedAnonymous(def: EndpointDef): number[] {
  switch (def.auth) {
    case "public":
    case "optional":
      return [def.status ?? (def.response || def.responseFormat === "text" ? 200 : 204)];
    case "webhook":
      return [401, 503];
    case "owner":
      return [401, 404];
    default:
      return [401];
  }
}

describe("authz walker: signed-out calls (AUTHZ_BASE_URL)", { skip: BASE_URL ? false : "set AUTHZ_BASE_URL to run" }, () => {
  it("every legacy row answers its anonymous status", async () => {
    const wrong: string[] = [];
    for (const row of LEGACY_ROUTES) {
      const urlPath = files.find((f) => f.file === row.file)!.urlPath.replace(/\[[^\]]+\]/g, SAMPLE_ID);
      const write = row.method !== "GET" && row.method !== "DELETE";
      const res = await fetch(`${BASE_URL}${urlPath}${row.query ?? ""}`, {
        method: row.method,
        redirect: "manual",
        headers: write ? { "content-type": "application/json" } : {},
        body: write ? "{}" : undefined,
      });
      await res.arrayBuffer();
      const allowed = [row.anonymous, ...(row.alsoAccept ?? []).map((a) => a.status)];
      if (!allowed.includes(res.status as never)) wrong.push(`${row.method} ${urlPath}: ${res.status} (expected ${allowed.join("|")})`);
    }
    assert.deepEqual(wrong, []);
  });

  it("every route() endpoint answers what its auth mode implies", async () => {
    const wrong: string[] = [];
    for (const f of files.filter((x) => x.usesRoute)) {
      for (const def of (HTTP_ENDPOINTS as readonly EndpointDef[]).filter((e) => e.path === toRegistryPath(f.urlPath))) {
        const urlPath = def.path.replace(/\{[^}]+\}/g, SAMPLE_ID);
        const res = await fetch(`${BASE_URL}${urlPath}`, { method: def.method, redirect: "manual" });
        await res.arrayBuffer();
        // A successful public-* response is replayed by the CDN, so it carries no per-request id (lib/api/README.md).
        const cdnShared = def.cache?.startsWith("public-") && (res.ok || res.status === 304);
        if (!cdnShared && !res.headers.get("x-request-id")) wrong.push(`${def.id}: no x-request-id`);
        if (cdnShared && res.headers.get("x-request-id")) wrong.push(`${def.id}: x-request-id on a CDN-shared response`);
        if (!expectedAnonymous(def).includes(res.status)) {
          wrong.push(`${def.method} ${urlPath} (${def.auth}): ${res.status}, expected ${expectedAnonymous(def).join("|")}`);
        }
      }
    }
    assert.deepEqual(wrong, []);
  });
});
