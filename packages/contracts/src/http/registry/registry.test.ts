import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BURST_MAX_WINDOW_SEC, endpointProblems, PRIVATE_CACHE_TIERS, rateLimitsOf } from "../endpoint";
import { getEndpoint, HTTP_ENDPOINTS, REGISTRY_AREAS } from "./index";

const dir = fileURLToPath(new URL(".", import.meta.url));

describe("endpoint registry", () => {
  it("has unique ids", () => {
    const ids = HTTP_ENDPOINTS.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(", ")}`);
  });

  it("has unique method + path", () => {
    const keys = HTTP_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("gives every public-* entry auth public, and every non-public entry a private tier", () => {
    for (const e of HTTP_ENDPOINTS) {
      const tier = e.cache ?? "no-store";
      if (tier.startsWith("public-")) assert.equal(e.auth, "public", e.id);
      else assert.ok((PRIVATE_CACHE_TIERS as readonly string[]).includes(tier), e.id);
    }
  });

  it("gives public-static entries publicStatic", () => {
    for (const e of HTTP_ENDPOINTS) {
      if (e.cache === "public-static") assert.ok("publicStatic" in e && e.publicStatic, e.id);
    }
  });

  it("allows sideEffects only on GETs", () => {
    for (const e of HTTP_ENDPOINTS) {
      if ("sideEffects" in e && e.sideEffects?.length) assert.equal(e.method, "GET", e.id);
    }
  });

  it("keeps burst limits at or under 300 s", () => {
    for (const e of HTTP_ENDPOINTS) {
      for (const rl of rateLimitsOf(e)) {
        if ((rl.store ?? "burst") === "burst") assert.ok(rl.windowSec <= BURST_MAX_WINDOW_SEC, `${e.id} ${rl.bucket}`);
      }
    }
  });

  it("has no invariant problems", () => {
    for (const e of HTTP_ENDPOINTS) assert.deepEqual(endpointProblems(e), [], e.id);
  });

  it("uses each rate-limit bucket name with one limit only", () => {
    const seen = new Map<string, string>();
    for (const e of HTTP_ENDPOINTS) {
      for (const rl of rateLimitsOf(e)) {
        const sig = `${rl.limit}/${rl.windowSec}/${rl.by}/${rl.store ?? "burst"}`;
        const prev = seen.get(rl.bucket);
        assert.ok(prev === undefined || prev === sig, `bucket ${rl.bucket} declared as ${prev} and ${sig}`);
        seen.set(rl.bucket, sig);
      }
    }
  });

  it("imports every area file in this directory into index.ts", () => {
    const areaFiles = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    assert.deepEqual(Object.keys(REGISTRY_AREAS).sort(), areaFiles);
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    for (const f of areaFiles) assert.match(index, new RegExp(`from "\\./${f}"`), f);
  });

  it("declares the P1 endpoints of plan §7.3/§7.4 and the P2 games endpoints (phase-02 §7.1)", () => {
    assert.deepEqual(HTTP_ENDPOINTS.map((e) => e.id).sort(), [
      "billing.refresh", "catalog.openings.index", "cron.daily",
      "games.checkpoint", "games.complete", "games.create", "games.detail", "games.pgn",
      "health.get", "healthcheck.get",
      "me.get", "session.clear", "socket-token.get", "subscription.get", "webhook.clerk", "webhook.dodo",
    ]);
    const me = getEndpoint("me.get");
    assert.equal(me.path, "/api/me");
    assert.equal(me.cache, "private-etag");
    assert.deepEqual(me.sideEffects, ["provision_user"]);
    const openings = getEndpoint("catalog.openings.index");
    assert.equal(openings.auth, "public");
    assert.deepEqual(openings.publicStatic, { sMaxAge: 86_400, swr: 604_800, tags: ["openings"] });
    assert.deepEqual(getEndpoint("billing.refresh").rateLimit, { bucket: "billing-refresh", limit: 10, windowSec: 60, by: "user" });
    assert.deepEqual(getEndpoint("health.get").rateLimit, { bucket: "health-deep", limit: 6, windowSec: 60, by: "ip" });
    assert.equal(getEndpoint("session.clear").status, 204);
    assert.throws(() => getEndpoint("nope" as never), /Unknown endpoint/);
  });

  it("declares the P2 games endpoints as phase-02 §7.1 says", () => {
    const create = getEndpoint("games.create");
    assert.equal(create.auth, "member");
    assert.equal(create.status, 201);
    assert.equal(create.maxBodyBytes, 4_096);
    assert.deepEqual(create.rateLimit, { bucket: "create-game", limit: 20, windowSec: 600, by: "user", store: "durable" });
    const detail = getEndpoint("games.detail");
    assert.equal(detail.path, "/api/games/{ref}");
    assert.equal(detail.cache, "private-etag");
    const checkpoint = getEndpoint("games.checkpoint");
    assert.equal(checkpoint.auth, "user");
    assert.equal(checkpoint.status, 204);
    assert.equal(checkpoint.maxBodyBytes, 8_192);
    assert.deepEqual(checkpoint.rateLimit, { bucket: "bot-checkpoint", limit: 60, windowSec: 60, by: "user" });
    assert.equal(getEndpoint("games.complete").maxBodyBytes, 16_384);
    const pgn = getEndpoint("games.pgn");
    assert.equal(pgn.cache, "no-store");
    assert.equal(pgn.responseFormat, "text");
    for (const e of [create, detail, checkpoint, getEndpoint("games.complete"), pgn]) {
      assert.ok(!(e.cache ?? "no-store").startsWith("public-"), e.id);
    }
  });

  it("every response, query, params and body is a zod schema", () => {
    for (const e of HTTP_ENDPOINTS) {
      for (const key of ["params", "query", "body", "response"] as const) {
        const s = (e as Record<string, unknown>)[key];
        if (s !== undefined) assert.ok(s instanceof z.ZodType, `${e.id}.${key}`);
      }
    }
  });
});
