// Cache-tier lint (plan §7.2.1 invariants, §12.2; CA §5, AP-03/AP-04/AP-22): walks the whole endpoint registry.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CACHE_TIERS, PRIVATE_CACHE_TIERS, cacheTierOf, type EndpointDef } from "@repo/contracts/http/endpoint";
import { HTTP_ENDPOINTS } from "@repo/contracts/http/registry";
import { isPublicTier, lifetimeViolation, lifetimesIn, tierHeaders } from "@/lib/api/cache";

const endpoints = HTTP_ENDPOINTS as readonly EndpointDef[];

describe("cache tiers over the registry", () => {
  it("every entry uses one of the six tiers", () => {
    for (const e of endpoints) assert.ok((CACHE_TIERS as readonly string[]).includes(cacheTierOf(e)), e.id);
  });

  it("a public-* tier only with auth public", () => {
    for (const e of endpoints) {
      if (isPublicTier(cacheTierOf(e))) assert.equal(e.auth, "public", `${e.id} is ${cacheTierOf(e)} but auth ${e.auth}`);
    }
  });

  it("a non-public endpoint uses only private-etag, no-store or sse", () => {
    for (const e of endpoints) {
      if (e.auth !== "public") {
        assert.ok((PRIVATE_CACHE_TIERS as readonly string[]).includes(cacheTierOf(e)), `${e.id}: ${cacheTierOf(e)}`);
      }
    }
  });

  it("public-static entries carry a CDN lifetime and at least one purge tag", () => {
    for (const e of endpoints) {
      if (cacheTierOf(e) !== "public-static") continue;
      assert.ok(e.publicStatic, e.id);
      assert.ok(e.publicStatic.sMaxAge > 0 && e.publicStatic.swr >= 0, e.id);
      assert.ok(e.publicStatic.tags.length > 0, `${e.id} needs a Vercel-Cache-Tag for purges`);
    }
  });

  it("public-immutable entries name their version param", () => {
    for (const e of endpoints) if (cacheTierOf(e) === "public-immutable") assert.ok(e.versionParam, e.id);
  });

  it("no non-public response the wrapper builds carries max-age > 0, s-maxage or public", () => {
    for (const e of endpoints) {
      const tier = cacheTierOf(e);
      const headers = new Headers(tierHeaders(e));
      assert.equal(lifetimeViolation(tier, headers), null, e.id);
      if (!isPublicTier(tier)) {
        const { maxAge, sMaxAge } = lifetimesIn(headers.get("cache-control"));
        assert.ok((maxAge ?? 0) === 0 && sMaxAge === null, e.id);
      }
    }
  });

  it("only GET endpoints use a cacheable tier", () => {
    for (const e of endpoints) {
      const tier = cacheTierOf(e);
      if (tier !== "no-store" && tier !== "sse") assert.equal(e.method, "GET", `${e.id}: ${tier} on ${e.method}`);
    }
  });

  it("P1 reference rows: openings is public-static (tag openings), health no-store, me private-etag", () => {
    const byId = new Map(endpoints.map((e) => [e.id, e]));
    const openings = byId.get("catalog.openings.index")!;
    assert.equal(cacheTierOf(openings), "public-static");
    assert.deepEqual(openings.publicStatic, { sMaxAge: 86_400, swr: 604_800, tags: ["openings"] });
    assert.equal(cacheTierOf(byId.get("health.get")!), "no-store");
    assert.equal(cacheTierOf(byId.get("me.get")!), "private-etag");
  });
});
