// GET /api/me (A3) and POST /api/billing/refresh (A19) through route() with the injected seams (1B·F4a).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MeData } from "@repo/contracts/http/me";
import { BillingRefreshData } from "@repo/contracts/http/billing";
import { ok } from "@repo/contracts/http/envelope";
import { ApiError } from "@/lib/api/api-error";
import { setBillingProvider, type BillingProvider } from "@/lib/billing/refresh";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../helpers/route-harness";

// The route modules import lib/prisma lazily; a fake client keeps this test off any database.
(globalThis as { prismaRc?: unknown }).prismaRc = {
  user: { updateMany: async () => ({ count: 1 }), findUnique: async () => null },
};

const { GET: getMe } = await import("@/app/api/me/route");
const { POST: refresh } = await import("@/app/api/billing/refresh/route");

const ENV = { ROUTE_VALIDATE_RESPONSES: "1" };
let restore: (() => void)[] = [];
afterEach(() => {
  for (const r of restore.reverse()) r();
  restore = [];
});

function deps(options: Parameters<typeof installTestDeps>[0]) {
  const t = installTestDeps({ env: ENV, ...options });
  restore.push(t.restore);
  return t;
}

function provider(p: Partial<BillingProvider> | null) {
  restore.push(
    setBillingProvider(p && { findCustomerIdByEmail: p.findCustomerIdByEmail ?? (async () => null), listSubscriptions: p.listSubscriptions ?? (async () => []) }),
  );
}

describe("GET /api/me", () => {
  it("signed out → 401 envelope", async () => {
    deps({});
    const res = await getMe(request("/api/me"), noParams());
    assert.equal(res.status, 401);
    assert.equal(((await jsonOf(res)).error as { code: string }).code, "unauthorized");
  });

  it("MeData from the request's viewer, private-etag, 304 on a matching If-None-Match", async () => {
    const t = deps({ userId: "user_1", viewer: viewerFixture({ entitlement: { state: "trial", trial: { active: true, used: true, daysLeft: 3 } } }) });
    const res = await getMe(request("/api/me"), noParams());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-cache");
    const etag = res.headers.get("etag");
    assert.match(etag ?? "", /^"[0-9a-f]+"$/);
    const body = ok(MeData).parse(await res.json());
    assert.equal(body.data.user.ref, "cviewer00000000000000000000");
    assert.equal(body.data.entitlement.state, "trial");
    assert.equal(body.data.entitlement.trial.daysLeft, 3);
    assert.equal(typeof body.data.flags["shell-v3"], "boolean");
    assert.equal(body.data.buildId, "dev");
    assert.equal(t.recorded.viewerCalls, 1);
    // Nothing server-only leaks (billing facts, ids).
    const text = JSON.stringify(body);
    for (const key of ["billing", "clerkUserId", "cus_fixture", "neverPaid", "gamesVersion"]) assert.ok(!text.includes(key), key);

    const again = await getMe(request("/api/me", { headers: { "if-none-match": etag! } }), noParams());
    assert.equal(again.status, 304);
  });

  it("a user Clerk can't provision → 502 upstream_unavailable { provider: clerk, kind }", async () => {
    deps({
      userId: "user_1",
      overrides: {
        getViewer: async () => {
          throw new ApiError("upstream_unavailable", { details: { provider: "clerk", kind: "unverified_email" } });
        },
      },
    });
    const res = await getMe(request("/api/me"), noParams());
    assert.equal(res.status, 502);
    const error = (await jsonOf(res)).error as { code: string; details: Record<string, string> };
    assert.equal(error.code, "upstream_unavailable");
    assert.deepEqual(error.details, { provider: "clerk", kind: "unverified_email" });
  });
});

describe("POST /api/billing/refresh", () => {
  const post = () => refresh(request("/api/billing/refresh", { method: "POST" }), noParams());

  it("signed out → 401; no Dodo key → 503 not_configured", async () => {
    deps({});
    assert.equal((await post()).status, 401);
    restore.pop()!();
    deps({ userId: "user_1", viewer: viewerFixture() });
    provider(null);
    const res = await post();
    assert.equal(res.status, 503);
    assert.equal(((await jsonOf(res)).error as { code: string }).code, "not_configured");
  });

  it("Dodo has nothing newer → the stored entitlement, refreshed, legacy body, no claims sync", async () => {
    const t = deps({ userId: "user_1", viewer: viewerFixture() });
    provider({});
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const body = ok(BillingRefreshData).parse(await res.json());
    assert.equal(body.data.refreshed, true);
    assert.equal(body.data.entitlement.entitled, true);
    assert.equal(body.data.entitlement.planKey, "monthly");
    assert.equal(body.data.entitlement.hasBillingPortal, true);
    const legacy = body.data.legacy as { entitled: boolean; paywall: boolean; customerId: string; subscription: { id: string } };
    assert.equal(legacy.entitled, true);
    assert.equal(legacy.paywall, true);
    assert.equal(legacy.customerId, "cus_fixture");
    assert.equal(legacy.subscription.id, "sub_fixture");
    assert.equal(t.recorded.afterTasks.length, 0);
    assert.deepEqual((t.recorded.rateLimitCalls[0]?.specs as { bucket: string }[])[0]?.bucket, "billing-refresh");
  });

  it("Dodo unreachable → refreshed: false with the stored state", async () => {
    deps({ userId: "user_1", viewer: viewerFixture() });
    provider({
      listSubscriptions: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    const body = ok(BillingRefreshData).parse(await (await post()).json());
    assert.equal(body.data.refreshed, false);
    assert.equal(body.data.entitlement.entitled, true);
  });

  it("linking the customer by email schedules the claims sync and turns on the portal", async () => {
    const t = deps({ userId: "user_1", viewer: viewerFixture({ entitlement: { hasBillingPortal: false }, billing: { dodoCustomerId: null } }) });
    provider({ findCustomerIdByEmail: async () => "cus_linked" });
    const body = ok(BillingRefreshData).parse(await (await post()).json());
    assert.equal(body.data.entitlement.hasBillingPortal, true);
    assert.equal((body.data.legacy as { customerId: string }).customerId, "cus_linked");
    assert.equal(t.recorded.afterTasks.length, 1);
  });

  it("429 from the billing-refresh bucket", async () => {
    deps({ userId: "user_1", viewer: viewerFixture(), rateLimit: { allowed: false, retryAfterSec: 12, bucket: "billing-refresh" } });
    provider({});
    const res = await post();
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "12");
  });
});
