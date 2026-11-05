import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { z } from "zod";
import type { EndpointDef } from "@repo/contracts/http/endpoint";
import { ErrorEnvelope } from "@repo/contracts/http/envelope";
import {
  FIXED_NOW,
  installTestDeps,
  jsonOf,
  noParams,
  request,
  viewerFixture,
} from "../../test/helpers/route-harness";
import { ApiError } from "./api-error";
import { paged } from "./paged";
import { respondWith } from "./respond";
import { route, readBodyBounded, routeSpecProblems } from "./route";
import { recordQuery } from "./timing";

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function setup(options: Parameters<typeof installTestDeps>[0] = {}) {
  const t = installTestDeps(options);
  restore = t.restore;
  return t.recorded;
}

const base = { id: "test.get", method: "GET", path: "/api/test", auth: "public" } as const satisfies EndpointDef;
const HOOKS_ON = { NEXT_PUBLIC_APP_ENV: "test", ALLOW_TEST_HOOKS: "1", E2E_TEST_TOKEN: "tok-123456" };

async function errorOf(res: Response) {
  const body = await jsonOf(res);
  const parsed = ErrorEnvelope.parse(body);
  return parsed.error;
}

describe("route(): module load (step 0)", () => {
  const cases: [string, EndpointDef & Record<string, unknown>][] = [
    ["public-short on an optional route", { ...base, auth: "optional", cache: "public-short", publicShort: { tags: ["x"] } }],
    ["public-static on a user route", { ...base, auth: "user", cache: "public-static", publicStatic: { sMaxAge: 1, swr: 1, tags: ["x"] } }],
    ["public-static without publicStatic", { ...base, cache: "public-static" }],
    ["public-immutable without versionParam", { ...base, cache: "public-immutable" }],
    ["owner without owner()", { ...base, auth: "owner" }],
    ["burst window > 300 s", { ...base, rateLimit: { bucket: "b", limit: 1, windowSec: 301, by: "ip" } }],
    ["sideEffects on a POST", { ...base, method: "POST", sideEffects: ["cron"] }],
    ["non-GET under /api/cron", { ...base, method: "POST", path: "/api/cron/x" }],
    ["rawBody without auth webhook", { ...base, method: "POST", rawBody: true }],
  ];
  for (const [name, spec] of cases) {
    it(`throws: ${name}`, () => {
      assert.ok(routeSpecProblems(spec).length > 0);
      assert.throws(() => route(spec as EndpointDef, async () => undefined), /route\(/);
    });
  }
  it("accepts a valid spec and exposes it for the contract tests", () => {
    const handler = route(base, async () => ({ ok: true }));
    assert.equal(handler.spec.id, "test.get");
  });
});

describe("route(): request id and headers (step 1)", () => {
  it("echoes a well-formed x-request-id and tags Sentry with it", async () => {
    const rec = setup();
    const GET = route(base, async () => ({ ok: true }));
    const res = await GET(request("/api/test", { headers: { "x-request-id": "req-12345678" } }), noParams());
    assert.equal(res.headers.get("x-request-id"), "req-12345678");
    assert.equal(rec.tags.request_id, "req-12345678");
  });
  it("generates one when absent or malformed", async () => {
    setup();
    const GET = route(base, async () => ({ ok: true }));
    const res = await GET(request("/api/test", { headers: { "x-request-id": "bad id\n" } }), noParams());
    assert.match(res.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  });
  it("logs mwLagMs from x-mw-start and one structured line", async () => {
    const rec = setup();
    const GET = route(base, async () => ({ ok: true }));
    await GET(request("/api/test", { headers: { "x-mw-start": String(FIXED_NOW - 42) } }), noParams());
    const line = rec.logs.find((l) => l.message === "api");
    assert.ok(line);
    assert.equal(line.context.mwLagMs, 42);
    assert.equal(line.context.route, "test.get");
    assert.equal(line.context.status, 200);
    assert.equal(line.context.env, "test");
  });
  it("adds Server-Timing outside production only", async () => {
    setup();
    const GET = route(base, async () => ({ ok: true }));
    const res = await GET(request("/api/test"), noParams());
    assert.match(res.headers.get("server-timing") ?? "", /app;dur=.*db;dur=.*total;dur=/);
    restore?.();
    setup({ env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "production" } });
    const prod = await GET(request("/api/test"), noParams());
    assert.equal(prod.headers.get("server-timing"), null);
  });
});

describe("route(): test hooks (step 2)", () => {
  const GET = route(base, async () => ({ ok: true }));
  it("ignores x-rc-fault with hooks off: byte-identical response", async () => {
    setup();
    const plain = await GET(request("/api/test", { headers: { "x-request-id": "same-id-0001" } }), noParams());
    const faulted = await GET(
      request("/api/test", { headers: { "x-request-id": "same-id-0001", "x-rc-fault": "500" } }),
      noParams(),
    );
    assert.equal(faulted.status, plain.status);
    assert.equal(await faulted.text(), await plain.text());
  });
  it("honours x-rc-fault 401/402/429/500/503 with hooks on", async () => {
    const rec = setup({ env: HOOKS_ON });
    const statuses: Record<string, number> = { "401": 401, "402": 402, "429": 429, "500": 500, "503": 503 };
    for (const [fault, status] of Object.entries(statuses)) {
      const res = await GET(request("/api/test", { headers: { "x-rc-fault": fault } }), noParams());
      assert.equal(res.status, status, fault);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      await errorOf(res);
    }
    assert.equal(rec.exceptions.length, 0, "injected faults are not exceptions");
  });
  it("429 fault uses x-rc-fault-retry (default 30) for Retry-After and retryAfterSec", async () => {
    setup({ env: HOOKS_ON });
    const res = await GET(request("/api/test", { headers: { "x-rc-fault": "429", "x-rc-fault-retry": "5" } }), noParams());
    assert.equal(res.headers.get("retry-after"), "5");
    assert.equal((await errorOf(res)).retryAfterSec, 5);
    const dflt = await GET(request("/api/test", { headers: { "x-rc-fault": "429" } }), noParams());
    assert.equal(dflt.headers.get("retry-after"), "30");
  });
  it("402 fault carries x-rc-fault-reason (default trial_used) and the legacy mirror", async () => {
    setup({ env: HOOKS_ON });
    const res = await GET(request("/api/test", { headers: { "x-rc-fault": "402", "x-rc-fault-reason": "expired" } }), noParams());
    const body = await jsonOf(res);
    const error = ErrorEnvelope.parse(body).error;
    assert.equal(error.details?.reason, "expired");
    assert.equal(body.code, "subscription_required");
    const dflt = await GET(request("/api/test", { headers: { "x-rc-fault": "402", "x-rc-fault-reason": "nope" } }), noParams());
    assert.equal((await errorOf(dflt)).details?.reason, "trial_used");
  });
  it("x-rc-now sets ctx.now only with hooks on AND the matching x-e2e-token", async () => {
    let seen: Date | null = null;
    const NOW_GET = route(base, async (ctx) => {
      seen = ctx.now;
      return { ok: true };
    });
    const at = "1893456000000"; // 2030-01-01
    setup({ env: HOOKS_ON });
    await NOW_GET(request("/api/test", { headers: { "x-rc-now": at, "x-e2e-token": "tok-123456" } }), noParams());
    assert.equal(seen!.getTime(), 1893456000000);
    await NOW_GET(request("/api/test", { headers: { "x-rc-now": at, "x-e2e-token": "wrong-token" } }), noParams());
    assert.equal(seen!.getTime(), FIXED_NOW);
    await NOW_GET(request("/api/test", { headers: { "x-rc-now": at } }), noParams());
    assert.equal(seen!.getTime(), FIXED_NOW);
    restore?.();
    setup({ env: { ...HOOKS_ON, NEXT_PUBLIC_APP_ENV: "production" } });
    await NOW_GET(request("/api/test", { headers: { "x-rc-now": at, "x-e2e-token": "tok-123456" } }), noParams());
    assert.equal(seen!.getTime(), FIXED_NOW);
  });
});

describe("route(): auth (step 3)", () => {
  const member = viewerFixture();
  it("public never calls auth() or the viewer read", async () => {
    const rec = setup({ userId: "user_1", viewer: member });
    const GET = route(base, async (ctx) => ({ viewer: ctx.viewer, clerk: ctx.clerkUserId }));
    const body = await jsonOf(await GET(request("/api/test"), noParams()));
    assert.deepEqual(body.data, { viewer: null, clerk: null });
    assert.equal(rec.authCalls, 0);
    assert.equal(rec.viewerCalls, 0);
  });
  it("optional: signed out → viewer null; signed in → viewer loaded", async () => {
    const GET = route({ ...base, auth: "optional" }, async (ctx) => ({ ref: ctx.viewer?.ref ?? null }));
    let rec = setup();
    assert.deepEqual((await jsonOf(await GET(request("/api/test"), noParams()))).data, { ref: null });
    assert.equal(rec.viewerCalls, 0);
    restore?.();
    rec = setup({ userId: "user_1", viewer: member });
    assert.deepEqual((await jsonOf(await GET(request("/api/test"), noParams()))).data, { ref: member.ref });
    assert.equal(rec.viewerCalls, 1);
  });
  it("user: signed out → 401; unknown/inactive viewer → 401; viewer → 200", async () => {
    const GET = route({ ...base, auth: "user" }, async () => ({ ok: true }));
    setup();
    assert.equal((await GET(request("/api/test"), noParams())).status, 401);
    restore?.();
    setup({ userId: "user_1", viewer: null });
    assert.equal((await GET(request("/api/test"), noParams())).status, 401);
    restore?.();
    setup({ userId: "user_1", viewer: member });
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
  });
  it("member: non-member → 402 with details.reason and upgradeUrl; member → 200", async () => {
    const GET = route({ ...base, auth: "member" }, async () => ({ ok: true }));
    const reasons = [
      [viewerFixture({ entitlement: { member: false, state: "none", trial: { used: false, eligible: true } } }), "trial_available", "/pricing?reason=required"],
      [viewerFixture({ entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: true } }), "trial_used", "/pricing?reason=ended"],
      [viewerFixture({ entitlement: { member: false, state: "lapsed", paymentIssue: { state: "expired" } } }), "payment_failed", "/pricing?reason=ended"],
      [viewerFixture({ entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } }), "expired", "/pricing?reason=ended"],
    ] as const;
    for (const [viewer, reason, url] of reasons) {
      restore?.();
      setup({ userId: "user_1", viewer });
      const res = await GET(request("/api/test"), noParams());
      assert.equal(res.status, 402);
      const body = await jsonOf(res);
      const error = ErrorEnvelope.parse(body).error;
      assert.equal(error.code, "subscription_required");
      assert.equal(error.details?.reason, reason);
      assert.equal(error.details?.upgradeUrl, url);
      assert.equal(body.code, "subscription_required", "legacy mirror on by default");
    }
    restore?.();
    setup({ userId: "user_1", viewer: member });
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
  });
  it("member: LEGACY_402_MIRROR=off drops the top-level mirror", async () => {
    const GET = route({ ...base, auth: "member" }, async () => ({ ok: true }));
    setup({ env: { LEGACY_402_MIRROR: "off" }, userId: "u", viewer: viewerFixture({ entitlement: { member: false, state: "none" } }) });
    const body = await jsonOf(await GET(request("/api/test"), noParams()));
    assert.equal(body.code, undefined);
  });
  it("owner: callback false → 404; true → 200", async () => {
    let allow = false;
    const GET = route({ ...base, auth: "owner", owner: async () => allow }, async () => ({ ok: true }));
    setup({ userId: "u", viewer: member });
    assert.equal((await GET(request("/api/test"), noParams())).status, 404);
    allow = true;
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
  });
  it("admin: signed out 401, user 403, admin 200", async () => {
    const GET = route({ ...base, auth: "admin" }, async () => ({ ok: true }));
    setup();
    assert.equal((await GET(request("/api/test"), noParams())).status, 401);
    restore?.();
    setup({ userId: "u", viewer: member });
    const denied = await GET(request("/api/test"), noParams());
    assert.equal(denied.status, 403);
    assert.equal((await errorOf(denied)).code, "forbidden");
    restore?.();
    setup({ userId: "u", viewer: viewerFixture({ role: "admin" }) });
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
  });
  it("internal: token on an id in INTERNAL_ROUTE_IDS → 200; wrong token or other id → 401", async () => {
    const env = { INTERNAL_API_SECRET: "internal-secret-1" };
    const allowed = route({ ...base, id: "chess.game-state", method: "POST", auth: "internal" }, async () => ({ ok: true }));
    const other = route({ ...base, id: "test.internal", method: "POST", auth: "internal" }, async () => ({ ok: true }));
    const rec = setup({ env });
    const good = { "x-internal-token": "internal-secret-1" };
    assert.equal((await allowed(request("/api/test", { method: "POST", headers: good }), noParams())).status, 200);
    assert.equal(
      (await allowed(request("/api/test", { method: "POST", headers: { "x-internal-token": "nope" } }), noParams())).status,
      401,
    );
    assert.equal((await other(request("/api/test", { method: "POST", headers: good }), noParams())).status, 401);
    assert.equal(rec.authCalls, 0);
  });
  it("cron: Bearer CRON_SECRET → 200; missing/wrong → 401; secret unset → 401", async () => {
    const GET = route({ ...base, path: "/api/cron/test", auth: "cron" }, async () => ({ ok: true }));
    setup({ env: { CRON_SECRET: "cron-secret-1" } });
    assert.equal((await GET(request("/api/cron/test", { headers: { authorization: "Bearer cron-secret-1" } }), noParams())).status, 200);
    assert.equal((await GET(request("/api/cron/test", { headers: { authorization: "Bearer x" } }), noParams())).status, 401);
    assert.equal((await GET(request("/api/cron/test"), noParams())).status, 401);
    restore?.();
    setup();
    assert.equal((await GET(request("/api/cron/test", { headers: { authorization: "Bearer " } }), noParams())).status, 401);
  });
  it("webhook: no Clerk; the handler gets the raw body", async () => {
    const POST = route(
      { ...base, method: "POST", auth: "webhook", rawBody: true, maxBodyBytes: 262_144 },
      async (ctx) => ({ raw: ctx.rawBody }),
    );
    const rec = setup();
    const res = await POST(request("/api/test", { method: "POST", body: '{"a":1} ' }), noParams());
    assert.deepEqual((await jsonOf(res)).data, { raw: '{"a":1} ' });
    assert.equal(rec.authCalls, 0);
  });
});

describe("route(): rate limit (step 4)", () => {
  const limited = {
    ...base,
    auth: "optional",
    rateLimit: { bucket: "t-bucket", limit: 1, windowSec: 60, by: "user+ip" },
  } as const satisfies EndpointDef;
  it("denied → 429 rate_limited with Retry-After equal to retryAfterSec and details.bucket", async () => {
    setup({ rateLimit: { allowed: false, retryAfterSec: 17, bucket: "t-bucket" } });
    const GET = route(limited, async () => ({ ok: true }));
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.status, 429);
    const error = await errorOf(res);
    assert.equal(res.headers.get("retry-after"), "17");
    assert.equal(error.retryAfterSec, 17);
    assert.equal(error.details?.bucket, "t-bucket");
  });
  it("keys on the JWT user id and the client IP", async () => {
    const rec = setup({ userId: "user_9", viewer: viewerFixture() });
    const GET = route(limited, async () => ({ ok: true }));
    await GET(request("/api/test", { headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" } }), noParams());
    assert.deepEqual(rec.rateLimitCalls[0]?.subject, { clerkUserId: "user_9", ip: "198.51.100.4" });
  });
  it("rateLimitWhen false skips the limiter", async () => {
    const rec = setup({ rateLimit: { allowed: false, retryAfterSec: 5 } });
    const GET = route({ ...limited, rateLimitWhen: (c) => c.rawQuery.deep === "1" }, async () => ({ ok: true }));
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
    assert.equal(rec.rateLimitCalls.length, 0);
    assert.equal((await GET(request("/api/test?deep=1"), noParams())).status, 429);
  });
  it("auth errors win over rate limiting", async () => {
    setup({ rateLimit: { allowed: false, retryAfterSec: 5 } });
    const GET = route({ ...limited, auth: "user" }, async () => ({ ok: true }));
    assert.equal((await GET(request("/api/test"), noParams())).status, 401);
  });
});

describe("route(): body (step 5) and validation (step 6)", () => {
  const post = {
    ...base,
    id: "test.post",
    method: "POST",
    body: z.object({ name: z.string().min(2), age: z.number().int() }),
    response: z.object({ name: z.string() }),
  } as const satisfies EndpointDef;
  const POST = route({ ...post, maxBodyBytes: 64 }, async (ctx) => ({ name: ctx.body.name }));

  it("413 by Content-Length before reading", async () => {
    setup();
    const res = await POST(
      request("/api/test", { method: "POST", headers: { "content-length": "65" }, body: "{}" }),
      noParams(),
    );
    assert.equal(res.status, 413);
    assert.equal((await errorOf(res)).details?.limitBytes, 64);
  });
  it("413 by streamed size, reading no more than maxBodyBytes + one chunk", async () => {
    setup();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 16;
        controller.enqueue(new Uint8Array(16).fill(32));
        if (pulled > 10_000) controller.close();
      },
    });
    const res = await POST(request("/api/test", { method: "POST", body: stream }), noParams());
    assert.equal(res.status, 413);
    assert.ok(pulled <= 64 + 16 * 2, `pulled ${pulled} bytes`);
  });
  it("readBodyBounded returns null past the limit and the text within it", async () => {
    assert.equal(await readBodyBounded(new Request("http://x", { method: "POST", body: "x".repeat(11) }), 10), null);
    assert.equal(await readBodyBounded(new Request("http://x", { method: "POST", body: "x".repeat(10) }), 10), "x".repeat(10));
  });
  it("invalid JSON → 400 invalid_json", async () => {
    setup();
    const res = await POST(request("/api/test", { method: "POST", body: "{nope" }), noParams());
    assert.equal(res.status, 400);
    assert.equal((await errorOf(res)).code, "invalid_json");
  });
  it("schema failure → 400 validation_failed with fields and details.issues", async () => {
    setup();
    const res = await POST(request("/api/test", { method: "POST", body: JSON.stringify({ name: "x", age: 1.5 }) }), noParams());
    assert.equal(res.status, 400);
    const error = await errorOf(res);
    assert.equal(error.code, "validation_failed");
    assert.ok(error.fields?.name);
    assert.ok(error.fields?.age);
    const issues = error.details?.issues as { path: string[] }[];
    assert.deepEqual(issues.map((i) => i.path.join(".")).sort(), ["age", "name"]);
  });
  it("valid body reaches the handler parsed", async () => {
    setup();
    const res = await POST(request("/api/test", { method: "POST", body: JSON.stringify({ name: "Ann", age: 3 }) }), noParams());
    assert.deepEqual((await jsonOf(res)).data, { name: "Ann" });
  });
  it("query: __rc* keys are stripped before validation", async () => {
    setup();
    const GET = route({ ...base, query: z.object({ q: z.string() }).strict() }, async (ctx) => ctx.query);
    const res = await GET(request("/api/test?q=a&__rcfault=abc123"), noParams());
    assert.equal(res.status, 200);
    assert.deepEqual((await jsonOf(res)).data, { q: "a" });
  });
  it("params: awaited and validated", async () => {
    setup();
    const GET = route(
      { ...base, path: "/api/test/{ref}", params: z.object({ ref: z.string().regex(/^c[a-z0-9]{20,31}$/) }) },
      async (ctx) => ({ ref: ctx.params.ref }),
    );
    assert.equal((await GET(request("/api/test/x"), noParams({ ref: "bad" }))).status, 400);
    const ok = await GET(request("/api/test/x"), noParams({ ref: "cabcdefghijklmnopqrstu" }));
    assert.deepEqual((await jsonOf(ok)).data, { ref: "cabcdefghijklmnopqrstu" });
  });
  it("public-immutable without the version param → 400", async () => {
    setup();
    const GET = route({ ...base, cache: "public-immutable", versionParam: "v" }, async () => ({ ok: true }));
    assert.equal((await GET(request("/api/test"), noParams())).status, 400);
    const ok = await GET(request("/api/test?v=3"), noParams());
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.match(ok.headers.get("etag") ?? "", /^"[0-9a-f]{16}"$/);
  });
});

describe("route(): response (step 9)", () => {
  it("wraps plain data as { data }", async () => {
    setup();
    const GET = route(base, async () => ({ a: 1 }));
    assert.deepEqual(await jsonOf(await GET(request("/api/test"), noParams())), { data: { a: 1 } });
  });
  it("paged(): meta.nextCursor always, total only on the first page", async () => {
    setup();
    const GET = route(base, async () => paged([1, 2], "next1", 40));
    const first = await jsonOf(await GET(request("/api/test"), noParams()));
    assert.deepEqual(first, { data: [1, 2], meta: { nextCursor: "next1", total: 40 } });
    const later = await jsonOf(await GET(request("/api/test?cursor=abc"), noParams()));
    assert.deepEqual(later, { data: [1, 2], meta: { nextCursor: "next1" } });
    const countOnly = await jsonOf(await GET(request("/api/test?cursor=abc&limit=0"), noParams()));
    assert.equal((countOnly.meta as { total?: number }).total, 40);
  });
  it("BigInt in the response → 500 in test (strict), string in production", async () => {
    const rec = setup();
    const GET = route(base, async () => ({ id: 5n }));
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.status, 500);
    assert.equal(rec.exceptions.length, 1);
    restore?.();
    const prodRec = setup({ env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "production" } });
    const prod = await GET(request("/api/test"), noParams());
    assert.deepEqual(await jsonOf(prod), { data: { id: "5" } });
    assert.equal(prodRec.messages[0]?.message, "serialize_coerced");
  });
  it("Date → ISO, undefined dropped, null kept", async () => {
    setup();
    const GET = route(base, async () => ({ at: new Date(FIXED_NOW), gone: undefined, none: null }));
    assert.deepEqual(await jsonOf(await GET(request("/api/test"), noParams())), {
      data: { at: "2026-11-05T12:00:00.000Z", none: null },
    });
  });
  it("respondWith: legacy top-level mirror, extra headers, Location for 201", async () => {
    setup();
    const GET = route(base, async () => respondWith({ token: "t" }, { legacyMirror: { token: "t" }, headers: { "x-extra": "1" } }));
    const res = await GET(request("/api/test"), noParams());
    assert.deepEqual(await jsonOf(res), { token: "t", data: { token: "t" } });
    assert.equal(res.headers.get("x-extra"), "1");
    const POST = route({ ...base, method: "POST", status: 201 }, async () => respondWith({ ref: "r" }, { status: 201, location: "/api/x/r" }));
    const made = await POST(request("/api/test", { method: "POST" }), noParams());
    assert.equal(made.status, 201);
    assert.equal(made.headers.get("location"), "/api/x/r");
  });
  it("204 has no body and keeps handler headers", async () => {
    setup();
    const POST = route({ ...base, method: "POST", status: 204 }, async () =>
      respondWith(undefined, { headers: { "Clear-Site-Data": '"cache"' } }),
    );
    const res = await POST(request("/api/test", { method: "POST" }), noParams());
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("clear-site-data"), '"cache"');
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });
  it("ROUTE_VALIDATE_RESPONSES=1: a response off-contract is a 500 in tests", async () => {
    setup({ env: { ROUTE_VALIDATE_RESPONSES: "1" } });
    const GET = route({ ...base, response: z.object({ n: z.number() }) }, async () => ({ n: "x" }) as never);
    assert.equal((await GET(request("/api/test"), noParams())).status, 500);
  });
  it("text format answers text/plain", async () => {
    setup();
    const GET = route({ ...base, responseFormat: "text", response: z.literal("ok") }, async () => "ok" as const);
    const res = await GET(request("/api/test"), noParams());
    assert.equal(await res.text(), "ok");
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  });
});

describe("route(): cache tiers (§7.2.1)", () => {
  it("public-static: exact headers, strong ETag, 304 on If-None-Match, no Set-Cookie", async () => {
    setup();
    const GET = route(
      { ...base, cache: "public-static", publicStatic: { sMaxAge: 86_400, swr: 604_800, tags: ["openings"] } },
      async () => ({ rows: [1] }),
    );
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(res.headers.get("vercel-cdn-cache-control"), "public, s-maxage=86400, stale-while-revalidate=604800");
    assert.equal(res.headers.get("vercel-cache-tag"), "openings");
    const etag = res.headers.get("etag")!;
    assert.match(etag, /^"[0-9a-f]{16}"$/);
    const again = await GET(request("/api/test", { headers: { "if-none-match": etag } }), noParams());
    assert.equal(again.status, 304);
    assert.equal(await again.text(), "");
    const cookie = route(
      { ...base, cache: "public-static", publicStatic: { sMaxAge: 1, swr: 1, tags: ["t"] } },
      async () => respondWith({ a: 1 }, { headers: { "Set-Cookie": "a=1" } }),
    );
    assert.equal((await cookie(request("/api/test"), noParams())).status, 500);
  });
  it("public-short: CDN 15 s + swr 60 s", async () => {
    setup();
    const GET = route({ ...base, cache: "public-short", publicShort: { tags: ["t1"] } }, async () => ({ a: 1 }));
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.headers.get("cache-control"), "public, max-age=0");
    assert.equal(res.headers.get("vercel-cdn-cache-control"), "public, s-maxage=15, stale-while-revalidate=60");
    assert.equal(res.headers.get("vercel-cache-tag"), "t1");
  });
  it("private-etag: private, no-cache + ETag; equal If-None-Match → 304; precomputed etag honoured", async () => {
    setup({ userId: "u", viewer: viewerFixture() });
    const GET = route({ ...base, auth: "user", cache: "private-etag" }, async () => ({ me: 1 }));
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.headers.get("cache-control"), "private, no-cache");
    const etag = res.headers.get("etag")!;
    assert.equal((await GET(request("/api/test", { headers: { "if-none-match": `W/${etag}` } }), noParams())).status, 304);
    const pre = route({ ...base, auth: "user", cache: "private-etag" }, async () => respondWith({ me: 1 }, { etag: "v42" }));
    assert.equal((await pre(request("/api/test"), noParams())).headers.get("etag"), '"v42"');
  });
  it("no-store default; sse headers", async () => {
    setup();
    const GET = route(base, async () => ({ a: 1 }));
    assert.equal((await GET(request("/api/test"), noParams())).headers.get("cache-control"), "private, no-store");
    const SSE = route({ ...base, cache: "sse" }, async () => new Response("data: 1\n\n"));
    const res = await SSE(request("/api/test"), noParams());
    assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(res.headers.get("x-accel-buffering"), "no");
  });
  it("errors are always private, no-store (even on a public-static route)", async () => {
    setup();
    const GET = route(
      { ...base, cache: "public-static", publicStatic: { sMaxAge: 1, swr: 1, tags: ["t"] } },
      async () => {
        throw new ApiError("not_found");
      },
    );
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("vercel-cdn-cache-control"), null);
  });
  it("a hand-set max-age on a non-public route throws in test", async () => {
    setup({ userId: "u", viewer: viewerFixture() });
    const GET = route({ ...base, auth: "user" }, async () =>
      new Response("{}", { headers: { "Cache-Control": "private, max-age=60" } }),
    );
    assert.equal((await GET(request("/api/test"), noParams())).status, 500);
    const viaOptions = route({ ...base, auth: "user" }, async () => respondWith({}, { headers: { "Cache-Control": "max-age=60" } }));
    assert.equal((await viaOptions(request("/api/test"), noParams())).status, 500);
  });
});

describe("route(): GET purity (step 8)", () => {
  it("a GET that writes → 500 get_wrote unless it declares the side effect", async () => {
    const rec = setup();
    const writes = async () => {
      recordQuery(1, true, "user.update");
      return { ok: true };
    };
    const GET = route(base, writes);
    assert.equal((await GET(request("/api/test"), noParams())).status, 500);
    assert.match(String((rec.exceptions[0]?.err as Error).message), /get_wrote/);
    const declared = route({ ...base, sideEffects: ["provision_user"] }, writes);
    assert.equal((await declared(request("/api/test"), noParams())).status, 200);
    const POST = route({ ...base, method: "POST" }, async () => {
      recordQuery(1, true, "user.update");
      return { ok: true };
    });
    assert.equal((await POST(request("/api/test", { method: "POST" }), noParams())).status, 200);
  });
  it("production logs the write instead of failing", async () => {
    const rec = setup({ env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "production" } });
    const GET = route(base, async () => {
      recordQuery(1, true, "user.update");
      return { ok: true };
    });
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
    assert.ok(rec.logs.some((l) => l.message === "get_wrote"));
  });
  it("db time and statement count reach the log line", async () => {
    const rec = setup();
    const GET = route(base, async () => {
      recordQuery(3, false, "user.findUnique");
      recordQuery(2, false, "user.findMany");
      return { ok: true };
    });
    await GET(request("/api/test"), noParams());
    const line = rec.logs.find((l) => l.message === "api")!;
    assert.equal(line.context.dbStatements, 2);
    assert.equal(line.context.dbMs, 5);
  });
});

describe("route(): errors (steps 7 and 10)", () => {
  it("ApiError → its envelope and status; 4xx is a breadcrumb, not an exception", async () => {
    const rec = setup();
    const GET = route(base, async () => {
      throw new ApiError("conflict", { details: { reason: "x" } });
    });
    const res = await GET(request("/api/test"), noParams());
    assert.equal(res.status, 409);
    assert.deepEqual((await errorOf(res)).details, { reason: "x" });
    assert.equal(rec.exceptions.length, 0);
    assert.equal(rec.breadcrumbs.length, 1);
  });
  const prismaError = (code: string, meta?: unknown) => Object.assign(new Error(`prisma ${code}`), { code, meta });
  it("Prisma P2002 → 409 conflict { target }, P2025 → 404, P2024 → 503 retryAfterSec 2", async () => {
    setup();
    const cases: [Error, number, string][] = [
      [prismaError("P2002", { target: ["email"] }), 409, "conflict"],
      [prismaError("P2025"), 404, "not_found"],
      [prismaError("P2024"), 503, "unavailable"],
      [prismaError("P2028"), 503, "unavailable"],
    ];
    for (const [err, status, code] of cases) {
      const GET = route(base, async () => {
        throw err;
      });
      const res = await GET(request("/api/test"), noParams());
      assert.equal(res.status, status);
      const error = await errorOf(res);
      assert.equal(error.code, code);
      if (code === "conflict") assert.deepEqual(error.details, { target: ["email"] });
      if (status === 503) {
        assert.equal(error.retryAfterSec, 2);
        assert.equal(res.headers.get("retry-after"), "2");
      }
    }
  });
  it("P1001 on a GET: one retry after 300 ms; a POST never retries", async () => {
    const rec = setup();
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw prismaError("P1001");
      return { ok: true };
    };
    const GET = route(base, flaky);
    assert.equal((await GET(request("/api/test"), noParams())).status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(rec.sleeps, [300]);
    calls = 0;
    const POST = route({ ...base, method: "POST" }, flaky);
    const res = await POST(request("/api/test", { method: "POST" }), noParams());
    assert.equal(res.status, 503);
    assert.equal(calls, 1);
    calls = -5;
    const always = route(base, async () => {
      calls += 1;
      throw prismaError("P1017");
    });
    assert.equal((await always(request("/api/test"), noParams())).status, 503);
  });
  it("unknown error → 500 'Something went wrong' and captureException with the route tag", async () => {
    const rec = setup();
    const GET = route(base, async () => {
      throw new Error("secret detail from the database");
    });
    const res = await GET(request("/api/test", { headers: { "x-request-id": "req-abcdef12" } }), noParams());
    assert.equal(res.status, 500);
    const text = await res.clone().text();
    assert.ok(!text.includes("secret detail"));
    const error = await errorOf(res);
    assert.equal(error.message, "Something went wrong");
    assert.equal(error.requestId, "req-abcdef12");
    assert.deepEqual(rec.exceptions[0]?.context, { tags: { route: "test.get" }, extra: { requestId: "req-abcdef12" } });
  });
});

describe("route(): ctx", () => {
  it("passes after() and timing marks", async () => {
    const rec = setup();
    const GET = route(base, async (ctx) => {
      ctx.after(() => "later");
      ctx.timing.mark("dto");
      return { ok: true };
    });
    const res = await GET(request("/api/test"), noParams());
    assert.equal(rec.afterTasks.length, 1);
    assert.match(res.headers.get("server-timing") ?? "", /dto;dur=/);
  });
});
