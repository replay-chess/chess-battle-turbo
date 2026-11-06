// API contract tests (plan §12.2, API §2.14). Imports HTTP_ENDPOINTS and every route() handler under app/api, then
// runs the matrix with the injected auth seam (lib/api/context.ts):
//   signed out → 401 (user/member/owner/admin) · non-member → 402 + details.reason · non-admin → 403 ·
//   malformed JSON → 400 invalid_json, oversize → 413 (endpoints with a body) · 429 Retry-After = retryAfterSec ·
//   response parses with spec.response (ROUTE_VALIDATE_RESPONSES=1) · every error body parses with ErrorEnvelope ·
//   every route() spec equals its registry entry · every GET is called once in strict mode (GET purity is enforced by
//   the wrapper; the DB-backed check is test/integration/query-budget.int.test.ts).
// Registry entries whose route file is not route() yet (legacy subscription.get; cron.daily until it moves) are
// reported as skipped here and covered by the authz walker.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { SUBSCRIPTION_REASONS } from "@repo/contracts/http/codes";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { type EndpointDef, rateLimitsOf } from "@repo/contracts/http/endpoint";
import { HTTP_ENDPOINTS } from "@repo/contracts/http/registry";
import type { RouteHandler } from "@/lib/api/route";
import { route } from "@/lib/api/route";
import { setBillingProvider } from "@/lib/billing/refresh";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../helpers/route-harness";
import { listRouteFiles, loadRouteHandlers, toRegistryPath } from "../helpers/route-modules";

// The route modules import lib/prisma; give them a fake client (lib/prisma reuses globalThis.prismaRc outside
// production) so nothing here opens a database connection.
const OPENINGS = [
  { referenceId: "caaaaaaaaaaaaaaaaaaaaaaaa", eco: "A00", name: "Amar Opening" },
  { referenceId: "cbbbbbbbbbbbbbbbbbbbbbbbb", eco: "C50", name: "Italian Game" },
];
(globalThis as { prismaRc?: unknown }).prismaRc = {
  opening: { findMany: async () => OPENINGS },
  user: { findUnique: async () => null },
  $queryRaw: async () => [{ "?column?": 1 }],
  $queryRawUnsafe: async () => [{ count: 1, resetAt: new Date(Date.now() + 60_000) }],
  $executeRawUnsafe: async () => 1,
};
process.env.INTERNAL_API_SECRET ||= "contract-test-internal-secret";
// POST /api/billing/refresh (1B·F4a) reads Dodo through this seam: a reachable provider with no subscriptions.
setBillingProvider({ findCustomerIdByEmail: async () => null, listSubscriptions: async () => [] });

// Webhook signing secrets for this process only (1B·F4b): the happy path signs an event the handlers ignore.
const WEBHOOK_SECRET = `whsec_${randomBytes(32).toString("base64")}`;
process.env.DODO_PAYMENTS_WEBHOOK_KEY = WEBHOOK_SECRET;
process.env.CLERK_WEBHOOK_SIGNING_SECRET = WEBHOOK_SECRET;

/** A signed body + headers for a webhook entry: Standard Webhooks (Dodo) or Svix header names (Clerk). */
function signedWebhook(def: EndpointDef): { headers: Record<string, string>; body: string } {
  const id = `msg_contract_${randomBytes(4).toString("hex")}`;
  const at = new Date();
  const body = JSON.stringify({ type: "contract.ignored", timestamp: at.toISOString(), data: { id: "x" } });
  const signature = new Webhook(WEBHOOK_SECRET).sign(id, at, body);
  const prefix = def.id === "webhook.clerk" ? "svix" : "webhook";
  return {
    body,
    headers: {
      "content-type": "application/json",
      [`${prefix}-id`]: id,
      [`${prefix}-timestamp`]: String(Math.floor(at.getTime() / 1000)),
      [`${prefix}-signature`]: signature,
    },
  };
}

const ENV = { ROUTE_VALIDATE_RESPONSES: "1", CRON_SECRET: "contract-cron-secret", INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET };

/**
 * Endpoints whose happy path needs database rows: their success status and body contract are asserted in the named
 * file (an in-memory client per SQL statement). Every other matrix row here (401/402/400/413/429) still runs for them.
 */
const HAPPY_PATH_ELSEWHERE: Record<string, string> = {
  "games.create": "test/api/games-routes.test.ts",
  "games.detail": "test/api/games-routes.test.ts",
  "games.checkpoint": "test/api/games-routes.test.ts",
  "games.complete": "test/api/games-routes.test.ts",
  "games.pgn": "test/api/games-routes.test.ts",
};

/** Requests that make a route's rate limit apply (rateLimitWhen). */
const RATE_LIMIT_PROBE: Record<string, string> = { "health.get": "?deep=1" };

/** Sample path params per registry path. */
function samplePath(path: string): { url: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const url = path.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => {
    params[name] = "cabcdefghijklmnopqrstuvwx";
    return params[name];
  });
  return { url, params };
}

type Loaded = { def: EndpointDef; handler: RouteHandler; file: string };
const loaded = new Map<string, Loaded>();
const unwrapped: { id: string; reason: string }[] = [];

before(async () => {
  const files = listRouteFiles();
  for (const file of files.filter((f) => f.usesRoute)) {
    const handlers = await loadRouteHandlers(file);
    for (const handler of Object.values(handlers)) loaded.set(handler.spec.id, { def: handler.spec, handler, file: file.file });
  }
  for (const def of HTTP_ENDPOINTS as readonly EndpointDef[]) {
    if (loaded.has(def.id)) continue;
    const file = files.find((f) => toRegistryPath(f.urlPath) === def.path);
    unwrapped.push({ id: def.id, reason: file ? `${file.file} is not route() yet` : "route file not written yet" });
  }
});

after(() => {
  if (unwrapped.length) {
    console.log(`contract: ${unwrapped.length} registry entries without a route() handler (authz walker covers them):`);
    for (const u of unwrapped) console.log(`  - ${u.id}: ${u.reason}`);
  }
});

function call(entry: Loaded, init: { query?: string; method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const { url, params } = samplePath(entry.def.path);
  const req = request(`${url}${init.query ?? ""}`, { method: init.method ?? entry.def.method, headers: init.headers, body: init.body });
  return entry.handler(req, noParams(params));
}

async function assertErrorEnvelope(res: Response, status: number, code?: string) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = ErrorEnvelope.parse(await jsonOf(res));
  assert.equal(body.error.requestId, res.headers.get("x-request-id"));
  if (code) assert.equal(body.error.code, code);
  return body.error;
}

function authHeaders(def: EndpointDef): Record<string, string> {
  if (def.auth === "cron") return { authorization: `Bearer ${ENV.CRON_SECRET}` };
  if (def.auth === "internal") return { "x-internal-token": ENV.INTERNAL_API_SECRET! };
  return {};
}

describe("contract: registry ↔ route()", () => {
  it("found the P1 reference routes", () => {
    for (const id of ["health.get", "healthcheck.get", "catalog.openings.index", "socket-token.get", "session.clear", "me.get", "billing.refresh"]) {
      assert.ok(loaded.has(id), `${id} should be a route() handler`);
    }
  });

  it("every route() handler is a registry entry with the same method, path, auth, cache, limits and side effects", () => {
    const byId = new Map((HTTP_ENDPOINTS as readonly EndpointDef[]).map((e) => [e.id, e]));
    for (const { def, file } of loaded.values()) {
      const entry = byId.get(def.id);
      assert.ok(entry, `${file}: ${def.id} is not in the registry`);
      for (const key of ["method", "path", "auth", "cache", "class", "versionParam", "responseFormat", "status"] as const) {
        assert.deepEqual(def[key], entry[key], `${def.id}.${key}`);
      }
      assert.deepEqual(def.rateLimit, entry.rateLimit, `${def.id}.rateLimit`);
      assert.deepEqual(def.sideEffects, entry.sideEffects, `${def.id}.sideEffects`);
      assert.deepEqual(def.publicStatic, entry.publicStatic, `${def.id}.publicStatic`);
      assert.equal(toRegistryPath(`/${file.replace(/^app\//, "").replace(/\/route\.tsx?$/, "")}`), def.path, `${def.id}: file path`);
    }
  });
});

describe("contract: auth matrix", () => {
  it("signed out → 401 on user/member/owner/admin endpoints", async () => {
    for (const entry of loaded.values()) {
      if (!["user", "member", "owner", "admin"].includes(entry.def.auth)) continue;
      const t = installTestDeps({ env: ENV });
      try {
        await assertErrorEnvelope(await call(entry), 401, "unauthorized");
      } finally {
        t.restore();
      }
    }
  });

  it("internal and cron endpoints → 401 without their credential", async () => {
    for (const entry of loaded.values()) {
      if (entry.def.auth !== "internal" && entry.def.auth !== "cron") continue;
      const t = installTestDeps({ env: ENV });
      try {
        await assertErrorEnvelope(await call(entry), 401, "unauthorized");
      } finally {
        t.restore();
      }
    }
  });

  it("non-admin → 403 on admin endpoints", async () => {
    for (const entry of loaded.values()) {
      if (entry.def.auth !== "admin") continue;
      const t = installTestDeps({ env: ENV, userId: "user_1", viewer: viewerFixture() });
      try {
        await assertErrorEnvelope(await call(entry), 403, "forbidden");
      } finally {
        t.restore();
      }
    }
  });

  it("non-member → 402 with each details.reason (throwaway test.member endpoint; no P1 route is member)", async () => {
    const memberRoute = route({ id: "test.member", method: "GET", path: "/api/test/member", auth: "member" }, async () => ({ ok: true }));
    const entry: Loaded = { def: memberRoute.spec, handler: memberRoute, file: "(test)" };
    const viewers = {
      trial_available: viewerFixture({ entitlement: { member: false, state: "none", trial: { used: false, eligible: true } } }),
      trial_used: viewerFixture({ entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: true } }),
      expired: viewerFixture({ entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } }),
      payment_failed: viewerFixture({ entitlement: { member: false, state: "lapsed", paymentIssue: { state: "expired" } } }),
    } as const;
    for (const reason of SUBSCRIPTION_REASONS) {
      const t = installTestDeps({ env: ENV, userId: "user_1", viewer: viewers[reason] });
      try {
        const error = await assertErrorEnvelope(await call(entry), 402, "subscription_required");
        assert.equal(error.details?.reason, reason);
      } finally {
        t.restore();
      }
    }
  });
});

describe("contract: body, rate limit, responses", () => {
  it("malformed JSON → 400 invalid_json and oversize → 413 on every endpoint with a body", async () => {
    for (const entry of loaded.values()) {
      if (!entry.def.body) continue;
      const t = installTestDeps({ env: ENV, userId: "user_1", viewer: viewerFixture({ role: "admin" }) });
      try {
        await assertErrorEnvelope(await call(entry, { headers: authHeaders(entry.def), body: "{nope" }), 400, "invalid_json");
        const limit = (entry.def as { maxBodyBytes?: number }).maxBodyBytes ?? 16_384;
        await assertErrorEnvelope(
          await call(entry, { headers: { ...authHeaders(entry.def), "content-length": String(limit + 1) }, body: "{}" }),
          413,
          "payload_too_large",
        );
      } finally {
        t.restore();
      }
    }
  });

  it("429 carries Retry-After equal to retryAfterSec on every rate-limited endpoint", async () => {
    for (const entry of loaded.values()) {
      if (!rateLimitsOf(entry.def).length) continue;
      const t = installTestDeps({
        env: ENV,
        userId: "user_1",
        viewer: viewerFixture({ role: "admin" }),
        rateLimit: { allowed: false, retryAfterSec: 23, bucket: rateLimitsOf(entry.def)[0]!.bucket },
      });
      try {
        const res = await call(entry, { query: RATE_LIMIT_PROBE[entry.def.id] ?? "", headers: authHeaders(entry.def) });
        const error = await assertErrorEnvelope(res, 429, "rate_limited");
        assert.equal(res.headers.get("retry-after"), String(error.retryAfterSec));
        assert.equal(error.retryAfterSec, 23);
      } finally {
        t.restore();
      }
    }
  });

  it("happy path: each route() endpoint answers its success status and its body parses with the contract", async () => {
    for (const entry of loaded.values()) {
      if (HAPPY_PATH_ELSEWHERE[entry.def.id]) continue;
      const t = installTestDeps({ env: ENV, userId: "user_1", viewer: viewerFixture({ role: "admin" }) });
      try {
        const res = await call(entry, entry.def.auth === "webhook" ? signedWebhook(entry.def) : { headers: authHeaders(entry.def) });
        const expected = entry.def.status ?? (entry.def.response || entry.def.responseFormat === "text" ? 200 : 204);
        assert.equal(res.status, expected, `${entry.def.id}: ${res.status} ${res.status >= 400 ? await res.clone().text() : ""}`);
        // A public-* success is replayed by the CDN to every client, so it carries no per-request id (FIX-B).
        if (entry.def.cache?.startsWith("public-")) assert.equal(res.headers.get("x-request-id"), null, entry.def.id);
        else assert.ok(res.headers.get("x-request-id"), entry.def.id);
        if (!entry.def.response || res.status === 204) continue;
        if (entry.def.responseFormat === "text") {
          entry.def.response.parse(await res.text());
        } else if (entry.def.responseFormat === "legacy") {
          entry.def.response.parse(await res.json());
        } else {
          ok(entry.def.response).parse(await res.json());
        }
      } finally {
        t.restore();
      }
    }
  });

  it("webhooks: unsigned or forged → 401; a missing secret → 503 not_configured (1B·F4b)", async () => {
    for (const entry of loaded.values()) {
      if (entry.def.auth !== "webhook") continue;
      const t = installTestDeps({ env: ENV });
      try {
        await assertErrorEnvelope(await call(entry, { body: "{}" }), 401, "unauthorized");
        const signed = signedWebhook(entry.def);
        await assertErrorEnvelope(await call(entry, { ...signed, body: signed.body.replace("ignored", "changed") }), 401, "unauthorized");
        const envKey = entry.def.id === "webhook.clerk" ? "CLERK_WEBHOOK_SIGNING_SECRET" : "DODO_PAYMENTS_WEBHOOK_KEY";
        delete process.env[envKey];
        try {
          await assertErrorEnvelope(await call(entry, signedWebhook(entry.def)), 503, "not_configured");
        } finally {
          process.env[envKey] = WEBHOOK_SECRET;
        }
      } finally {
        t.restore();
      }
    }
  });

  it("A1 deep=1 adds db; A5 keeps the legacy top-level mirror; A18 sends Clear-Site-Data cache", async () => {
    const t = installTestDeps({ env: ENV, userId: "user_1", viewer: viewerFixture() });
    try {
      const deep = (await jsonOf(await call(loaded.get("health.get")!, { query: "?deep=1" }))) as { data: { db?: { ok: boolean } } };
      assert.equal(deep.data.db?.ok, true);
      const token = (await jsonOf(await call(loaded.get("socket-token.get")!))) as {
        data: { token: string; expiresAt: number };
        token: string;
        expiresAt: number;
      };
      assert.equal(token.token, token.data.token);
      assert.equal(token.expiresAt, token.data.expiresAt);
      const clear = await call(loaded.get("session.clear")!);
      assert.equal(clear.headers.get("clear-site-data"), '"cache"');
      assert.equal(clear.headers.get("cache-control"), "private, no-store");
      const openings = await call(loaded.get("catalog.openings.index")!);
      assert.equal(openings.headers.get("set-cookie"), null);
      assert.equal(openings.headers.get("vercel-cache-tag"), "openings");
      const body = (await jsonOf(openings)) as { data: { openings: unknown[] } };
      assert.deepEqual(body.data.openings[0], { id: "caaaaaaaaaaaaaaaaaaaaaaaa", eco: "A00", name: "Amar Opening" });
    } finally {
      t.restore();
    }
  });

  it("public endpoints never call auth()", async () => {
    for (const entry of loaded.values()) {
      if (entry.def.auth !== "public") continue;
      const t = installTestDeps({ env: ENV, userId: "user_1" });
      try {
        await call(entry);
        assert.equal(t.recorded.authCalls, 0, entry.def.id);
      } finally {
        t.restore();
      }
    }
  });
});
