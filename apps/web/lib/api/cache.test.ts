import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CacheHeaderError, cacheTagHeader, lifetimeViolation, lifetimesIn, tierHeaders } from "./cache";

describe("cache tiers", () => {
  it("exact headers per tier", () => {
    assert.deepEqual(tierHeaders({ cache: "public-immutable" }), { "Cache-Control": "public, max-age=31536000, immutable" });
    assert.deepEqual(tierHeaders({ cache: "public-static", publicStatic: { sMaxAge: 86_400, swr: 604_800, tags: ["openings"] } }), {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "Vercel-Cache-Tag": "openings",
    });
    assert.deepEqual(tierHeaders({ cache: "public-short", publicShort: { tags: ["a", "b", "a"] } }), {
      "Cache-Control": "public, max-age=0",
      "Vercel-CDN-Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
      "Vercel-Cache-Tag": "a,b",
    });
    assert.deepEqual(tierHeaders({ cache: "private-etag" }), { "Cache-Control": "private, no-cache" });
    assert.deepEqual(tierHeaders({}), { "Cache-Control": "private, no-store" });
    assert.deepEqual(tierHeaders({ cache: "sse" }), {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
  });
  it("public-static without its config throws", () => {
    assert.throws(() => tierHeaders({ cache: "public-static" }), CacheHeaderError);
  });
  it("cache tags reject unsafe characters", () => {
    assert.throws(() => cacheTagHeader(["bad tag"]), CacheHeaderError);
    assert.equal(cacheTagHeader(["openings", "catalog:v1"]), "openings,catalog:v1");
  });
  it("lifetimesIn reads max-age and s-maxage", () => {
    assert.deepEqual(lifetimesIn("public, max-age=60, s-maxage=10"), { maxAge: 60, sMaxAge: 10 });
    assert.deepEqual(lifetimesIn("private, no-store"), { maxAge: null, sMaxAge: null });
  });
  it("a non-public response may not carry a lifetime", () => {
    const h = (v: Record<string, string>) => new Headers(v);
    assert.match(lifetimeViolation("no-store", h({ "Cache-Control": "private, max-age=60" }))!, /max-age=60/);
    assert.match(lifetimeViolation("private-etag", h({ "Vercel-CDN-Cache-Control": "s-maxage=10" }))!, /s-maxage/);
    assert.match(lifetimeViolation("no-store", h({ "Cache-Control": "public, max-age=0" }))!, /public/);
    assert.equal(lifetimeViolation("no-store", h({ "Cache-Control": "private, max-age=0" })), null);
    assert.equal(lifetimeViolation("public-static", h({ "Cache-Control": "public, max-age=600" })), null);
  });
});
