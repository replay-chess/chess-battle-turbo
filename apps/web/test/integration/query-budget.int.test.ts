// Query budgets (plan §12.2, §9.2) against a real database. Skips unless TEST_DATABASE_URL is set (CI: Docker
// Postgres after `prisma migrate deploy` + seeds; locally: the Neon dev branch or a throwaway container).
//
// | path                                         | budget | owner        |
// | GET /api/health                              | 0      | 1B·F1        |
// | GET /api/health?deep=1                       | 2 (SELECT 1 + limiter upsert) | 1B·F1 |
// | GET /api/openings, CDN miss, warm data cache | 0 (cold: 1) | 1B·F1   |
// | GET /api/socket-token (viewer stubbed)       | 0      | 1B·F1        |
// | (app) layout viewer read                     | 1      | 1B·J         |
// | GET /api/me                                  | 1      | 1B·F4a       |
// | POST /api/billing/refresh                    | ≤ 4    | 1B·F4a       |
// | webhook happy path (duplicate: 1)            | ≤ 4    | 1B·F4b       |
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request, viewerFixture } from "../helpers/route-harness";
import { countQueries, routeStatements } from "../helpers/query-counter";

const url = process.env.TEST_DATABASE_URL;

describe("query budgets", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let health: RouteHandler;
  let openings: RouteHandler;
  let socketToken: RouteHandler;
  let realCheckRateLimit: typeof import("@/lib/rate-limit-db").checkRateLimit;
  let disconnect: () => Promise<void>;

  before(async () => {
    process.env.DATABASE_URL = url;
    process.env.INTERNAL_API_SECRET ||= "query-budget-internal-secret";
    const { prisma } = await import("@/lib/prisma");
    disconnect = () => prisma.$disconnect();
    ({ checkRateLimit: realCheckRateLimit } = await import("@/lib/rate-limit-db"));
    ({ GET: health } = (await import("@/app/api/health/route")) as unknown as { GET: RouteHandler });
    ({ GET: openings } = (await import("@/app/api/openings/route")) as unknown as { GET: RouteHandler });
    ({ GET: socketToken } = (await import("@/app/api/socket-token/route")) as unknown as { GET: RouteHandler });
  });

  after(async () => {
    await disconnect?.();
  });

  it("GET /api/health = 0 statements", async () => {
    const t = installTestDeps({ overrides: { checkRateLimit: realCheckRateLimit } });
    try {
      const res = await health(request("/api/health"), noParams());
      assert.equal(res.status, 200);
      assert.equal(routeStatements(t.recorded), 0);
    } finally {
      t.restore();
    }
  });

  it("GET /api/health?deep=1 = 2 statements (SELECT 1 + limiter), and the limiter write is not a GET write", async () => {
    const t = installTestDeps({ overrides: { checkRateLimit: realCheckRateLimit } });
    try {
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
      const res = await health(request("/api/health?deep=1", { headers: { "x-forwarded-for": ip } }), noParams());
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(routeStatements(t.recorded), 2);
    } finally {
      t.restore();
    }
  });

  it("GET /api/openings: cold data cache = 1 statement, warm = 0", async () => {
    const memo = new Map<string, unknown>();
    const t = installTestDeps({
      overrides: {
        dataCache: (fn, keyParts) => async () => {
          const key = keyParts.join("|");
          if (!memo.has(key)) memo.set(key, await fn());
          return memo.get(key) as Awaited<ReturnType<typeof fn>>;
        },
      },
    });
    try {
      const cold = await openings(request("/api/openings"), noParams());
      assert.equal(cold.status, 200);
      assert.equal(routeStatements(t.recorded), 1);
      const warm = await openings(request("/api/openings"), noParams());
      assert.equal(warm.status, 200);
      assert.equal(routeStatements(t.recorded), 0);
      assert.equal(warm.headers.get("etag"), cold.headers.get("etag"));
    } finally {
      t.restore();
    }
  });

  it("GET /api/socket-token with the viewer stubbed = 0 statements", async () => {
    const t = installTestDeps({ userId: "user_x", viewer: viewerFixture() });
    try {
      const res = await socketToken(request("/api/socket-token"), noParams());
      assert.equal(res.status, 200);
      assert.equal(routeStatements(t.recorded), 0);
    } finally {
      t.restore();
    }
  });

  it("countQueries sees reads and writes outside route()", async () => {
    const { prisma } = await import("@/lib/prisma");
    const read = await countQueries(() => prisma.$queryRaw`SELECT 1`);
    assert.equal(read.statements, 1);
    assert.equal(read.writes, 0);
  });

  describe("viewer routes (1B·F4a)", () => {
    // The route's viewer loader with the real statement for a throwaway user (Clerk's auth() can't run here).
    const run = `qbv${Date.now().toString(36)}`;
    const email = `e2e-qbviewer-${run}@example.test`;
    const googleId = `user_${run}`;
    let userId: bigint;
    let viewerLoader: () => Promise<import("@/lib/auth/viewer").Viewer | null>;

    before(async () => {
      const nodeModule = await import("node:module");
      nodeModule.registerHooks?.({
        resolve: (specifier, context, next) =>
          specifier === "server-only" ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
      });
      const { prisma } = await import("@/lib/prisma");
      const { queryViewerRecord, toViewer } = await import("@/lib/auth/viewer");
      const { getProductCatalog } = await import("@/lib/billing/products");
      const user = await prisma.user.create({
        data: { googleId, email, name: "Budget Viewer", code: run.slice(-6).toUpperCase() },
        select: { id: true },
      });
      userId = user.id;
      viewerLoader = async () => {
        const record = await queryViewerRecord(prisma, googleId);
        return record && toViewer(record, { now: new Date(), paywallEnabled: true, catalog: getProductCatalog() });
      };
    });

    after(async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.user.deleteMany({ where: { email } });
    });

    it("(app) layout viewer read: getViewerRecord() = 1 statement (1B·J)", async () => {
      // The layout's getViewer() and getShellSession() both read getViewerRecord(), which React cache() runs once per
      // render (cache() does not memoise outside React, so this counts the one read itself).
      // Clerk's auth() can't run outside Next: answer the viewer's dynamic import with a stub for this test only.
      const g = globalThis as { __qbClerkUserId?: string };
      g.__qbClerkUserId = googleId;
      const nodeModule = await import("node:module");
      nodeModule.registerHooks?.({
        resolve: (specifier, context, next) =>
          specifier === "@clerk/nextjs/server" && g.__qbClerkUserId
            ? {
                url: "data:text/javascript,export%20async%20function%20auth()%7Breturn%7BuserId%3AglobalThis.__qbClerkUserId%7D%7D",
                shortCircuit: true,
              }
            : next(specifier, context),
      });
      try {
        const { getViewerRecord } = await import("@/lib/auth/viewer");
        const read = await countQueries(() => getViewerRecord());
        assert.equal(read.result?.googleId, googleId);
        assert.equal(read.statements, 1);
        assert.equal(read.writes, 0);
      } finally {
        delete g.__qbClerkUserId;
      }
    });

    it("GET /api/me = 1 statement", async () => {
      const { GET: me } = (await import("@/app/api/me/route")) as unknown as { GET: RouteHandler };
      const t = installTestDeps({ userId: googleId, overrides: { getViewer: viewerLoader } });
      try {
        const res = await me(request("/api/me"), noParams());
        assert.equal(res.status, 200, await res.clone().text());
        assert.equal(routeStatements(t.recorded), 1);
      } finally {
        t.restore();
      }
    });

    it("POST /api/billing/refresh ≤ 4 statements (viewer, customer link, compare-and-set read + write)", async () => {
      const { setBillingProvider } = await import("@/lib/billing/refresh");
      const { prisma } = await import("@/lib/prisma");
      const { POST: refresh } = (await import("@/app/api/billing/refresh/route")) as unknown as { POST: RouteHandler };
      const customerId = `cus_${run}`;
      const restoreProvider = setBillingProvider({
        findCustomerIdByEmail: async () => customerId,
        listSubscriptions: async () => [
          {
            subscription_id: `sub_${run}`,
            product_id: "pdt_budget",
            status: "active",
            next_billing_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            cancel_at_next_billing_date: false,
            created_at: new Date().toISOString(),
            customer: { customer_id: customerId, email },
          },
        ],
      });
      const t = installTestDeps({ userId: googleId, overrides: { getViewer: viewerLoader } });
      try {
        const res = await refresh(request("/api/billing/refresh", { method: "POST" }), noParams());
        assert.equal(res.status, 200, await res.clone().text());
        const statements = routeStatements(t.recorded);
        assert.ok(statements <= 4, `statements: ${statements}`);
        const body = (await res.json()) as { data: { refreshed: boolean; entitlement: { entitled: boolean; hasBillingPortal: boolean } } };
        assert.equal(body.data.refreshed, true);
        assert.equal(body.data.entitlement.entitled, true);
        assert.equal(body.data.entitlement.hasBillingPortal, true);
        const row = await prisma.user.findUnique({ where: { id: userId }, select: { dodoCustomerId: true, subscriptionStatus: true } });
        assert.deepEqual(row, { dodoCustomerId: customerId, subscriptionStatus: "active" });
      } finally {
        t.restore();
        restoreProvider();
      }
    });
  });
  it("Dodo webhook happy path ≤ 4 statements: claim, user read, compare-and-set, outcome (1B·F4b)", async () => {
    // dodo-events.ts / entitlement.ts start with `import "server-only"`, which only Next.js resolves.
    const nodeModule = await import("node:module");
    nodeModule.registerHooks?.({
      resolve: (specifier, context, next) =>
        specifier === "server-only" ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
    });
    const { Webhook } = await import("standardwebhooks");
    const { randomBytes } = await import("node:crypto");
    const { prisma } = await import("@/lib/prisma");
    const key = `whsec_${randomBytes(32).toString("base64")}`;
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = key;
    const { POST: dodo } = (await import("@/app/api/webhook/dodo-payments/route")) as unknown as { POST: RouteHandler };

    const run = `qb${Date.now().toString(36)}`;
    const email = `e2e-qbwebhook-${run}@example.test`;
    const user = await prisma.user.create({
      data: { googleId: `user_${run}`, email, name: "Budget", code: run.slice(-6).toUpperCase() },
      select: { id: true },
    });
    const id = `msg_${run}`;
    const body = JSON.stringify({
      type: "subscription.active",
      timestamp: new Date().toISOString(),
      data: {
        subscription_id: `sub_${run}`,
        product_id: "pdt_budget",
        status: "active",
        next_billing_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        cancel_at_next_billing_date: false,
        customer: { customer_id: `cus_${run}`, email },
      },
    });
    const now = new Date();
    const headers = {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
      "webhook-signature": new Webhook(key).sign(id, now, body),
    };
    const t = installTestDeps();
    try {
      const res = await dodo(request("/api/webhook/dodo-payments", { method: "POST", headers, body }), noParams());
      assert.equal(res.status, 200, String((t.recorded.exceptions[0]?.err as Error | undefined)?.stack ?? (await res.clone().text())));
      assert.ok(routeStatements(t.recorded) <= 4, `statements: ${routeStatements(t.recorded)}`);
      const replay = await dodo(request("/api/webhook/dodo-payments", { method: "POST", headers, body }), noParams());
      assert.equal(replay.status, 200);
      assert.equal(routeStatements(t.recorded), 1, "a duplicate is the claim statement only");
    } finally {
      t.restore();
      await prisma.$executeRawUnsafe(`DELETE FROM webhook_events WHERE provider = 'dodo' AND "eventId" = $1`, id);
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
