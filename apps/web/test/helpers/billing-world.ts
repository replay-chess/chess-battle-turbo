// Shared world of the phase-04 billing integration tests (test/api/billing.contract.int.test.ts,
// test/integration/fanout.int.test.ts): a real Postgres after `prisma migrate deploy`, real route handlers through
// route() with the injected seams, and recording fakes for everything outside the database (Dodo, the socket emit,
// the worker kick, PostHog). Never imported by app code. Local Postgres only (the URL host is checked).
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { Webhook } from "standardwebhooks";
import { PrismaClient } from "@repo/db";
import type { Viewer } from "@/lib/auth/viewer";
import type { RouteHandler } from "@/lib/api/route";
import type { DodoApi, DodoSubscription, CheckoutSessionInput } from "@/lib/billing/dodo-api";
import { installTestDeps, noParams, request, viewerFixture, type Recorded } from "./route-harness";

// entitlement.ts and products.ts start with `import "server-only"`, which only Next.js resolves. Stub it first.
const STUB = "data:text/javascript,export%20%7B%7D";
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) => (specifier === "server-only" ? { url: STUB, shortCircuit: true } : next(specifier, context)),
  });
} else {
  nodeModule.register(
    "data:text/javascript," +
      encodeURIComponent(`export async function resolve(s, c, n) { return s === "server-only" ? { url: ${JSON.stringify(STUB)}, shortCircuit: true } : n(s, c); }`),
  );
}

export const TEST_URL = process.env.TEST_DATABASE_URL;
export const WEBHOOK_KEY = `whsec_${randomBytes(32).toString("base64")}`;
export const PEPPER = "billing-int-pepper-0123456789abcdef";
const COOKIE_SECRET = randomBytes(32).toString("hex");

/** Process env the routes read at call time (set once, before the route modules load). */
export function primeEnv(): void {
  if (!TEST_URL) return;
  const host = new URL(TEST_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) throw new Error(`refusing to run against ${host}: local Postgres only`);
  Object.assign(process.env, {
    DATABASE_URL: TEST_URL,
    DIRECT_URL: TEST_URL,
    HASH_PEPPER: PEPPER,
    SIGNED_COOKIE_SECRET: COOKIE_SECRET,
    DODO_PAYMENTS_WEBHOOK_KEY: WEBHOOK_KEY,
    DODO_PRODUCT_ID_MONTHLY: "pdt_int_monthly",
    DODO_PRODUCT_ID_YEARLY: "pdt_int_yearly",
    NEXT_PUBLIC_APP_ENV: "test",
    ALLOW_TEST_HOOKS: "1",
    FLAGS_OVERRIDE: "onboarding-v3:on,import-v3:on",
    // `web` signs socket emits (internalFetch), `webwk` signs worker kicks (kickWorker).
    INTERNAL_API_SECRET: `web:${randomBytes(32).toString("base64")},webwk:${randomBytes(32).toString("base64")}`,
    ANALYSIS_WORKER_URL: "http://worker.invalid:3003",
  });
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.POSTHOG_PROJECT_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
}

export const ROUTE_ENV = { ROUTE_VALIDATE_RESPONSES: "1", NEXT_PUBLIC_APP_ENV: "test", SIGNED_COOKIE_SECRET: COOKIE_SECRET };

export type Handlers = { GET?: RouteHandler; POST?: RouteHandler };

export type WorldUser = { id: bigint; ref: string; googleId: string; email: string; name: string };

/** Recording fakes, reset per test with `fakes.reset()`. */
export function makeFakes() {
  const f = {
    sessions: [] as CheckoutSessionInput[],
    lists: [] as string[],
    retrieves: [] as string[],
    cancels: [] as string[],
    subscriptions: new Map<string, DodoSubscription>(),
    sessionStatus: new Map<string, string | null>(),
    listResult: [] as DodoSubscription[],
    createError: null as Error | null,
    emits: [] as { event: string; targets: unknown; data: Record<string, unknown> }[],
    kicks: [] as unknown[],
    events: [] as { event: string; props: Record<string, unknown>; who: string }[],
    seq: 0,
    reset() {
      f.sessions.length = 0;
      f.lists.length = 0;
      f.retrieves.length = 0;
      f.cancels.length = 0;
      f.subscriptions.clear();
      f.sessionStatus.clear();
      f.listResult = [];
      f.createError = null;
      f.emits.length = 0;
      f.kicks.length = 0;
      f.events.length = 0;
    },
    api: null as unknown as DodoApi,
  };
  f.api = {
    async createCheckoutSession(input) {
      if (f.createError) throw f.createError;
      f.sessions.push(input);
      const id = `cks_int_${++f.seq}`;
      return { sessionId: id, checkoutUrl: `https://test.checkout.dodopayments.com/${id}` };
    },
    async listSubscriptions(customerId) {
      f.lists.push(customerId);
      return f.listResult;
    },
    async retrieveSubscription(id) {
      f.retrieves.push(id);
      const s = f.subscriptions.get(id);
      if (!s) throw Object.assign(new Error("not found"), { name: "NotFoundError", status: 404 });
      return s;
    },
    async retrieveCheckoutSession(id) {
      return { paymentStatus: f.sessionStatus.get(id) ?? null };
    },
    async cancelAtNextBillingDate(id) {
      f.cancels.push(id);
    },
  };
  return f;
}
export type Fakes = ReturnType<typeof makeFakes>;

/** Installs the fakes into the app seams; returns the restore function. */
export async function installFakes(f: Fakes): Promise<() => void> {
  const [{ setDodoApi }, { setEntitlementEmitTransport }, { setKickTransport }, { setBillingEventSink }] = await Promise.all([
    import("@/lib/billing/dodo-api"),
    import("@/lib/billing/emit"),
    import("@/lib/services/analysis/kick"),
    import("@/lib/billing/server-events"),
  ]);
  const restores = [
    setDodoApi(f.api),
    setEntitlementEmitTransport((async (_url: string | URL | Request, init?: RequestInit) => {
      f.emits.push(JSON.parse(String(init?.body)) as Fakes["emits"][number]);
      return new Response(JSON.stringify({ data: { delivered: 1 } }), { status: 200 });
    }) as typeof fetch),
    setKickTransport(async (_url, init) => {
      f.kicks.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 202 });
    }),
    setBillingEventSink((event, props, who) => void f.events.push({ event, props, who })),
  ];
  return () => {
    for (const r of restores.reverse()) r();
  };
}

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
let n = 0;

export function billingWorld() {
  const db = new PrismaClient({ datasourceUrl: TEST_URL });
  const created: bigint[] = [];

  async function makeUser(over: Record<string, unknown> = {}): Promise<WorldUser> {
    n += 1;
    const tag = `${RUN}${n}`;
    const email = (over.email as string | undefined) ?? `bill-${tag}@example.test`;
    const user = await db.user.create({
      data: { googleId: `user_bill_${tag}`, email, name: "Bill Int", code: `B${tag}`.slice(-10).toUpperCase(), ...over },
      select: { id: true, referenceId: true, googleId: true, email: true, name: true },
    });
    created.push(user.id);
    return { id: user.id, ref: user.referenceId, googleId: user.googleId, email: user.email, name: user.name };
  }

  /** The route viewer of a user: non-member by default (the onboarding / pricing checkout). */
  function viewerOf(u: WorldUser, member = false): Viewer {
    return viewerFixture({
      id: u.id,
      ref: u.ref,
      clerkUserId: u.googleId,
      user: { ref: u.ref, name: u.name, email: u.email, onboarded: true },
      entitlement: member
        ? {}
        : { member: false, entitled: false, state: "none", status: null, planKey: null, interval: null, priceCents: null, currentPeriodEnd: null, hasBillingPortal: false, trial: { eligible: true } },
      billing: member
        ? { email: u.email }
        : {
            email: u.email,
            dodoCustomerId: null,
            subscriptionId: null,
            subscriptionProductId: null,
            summary: {
              entitled: false,
              plan: null,
              planKey: null,
              interval: null,
              priceCents: null,
              status: null,
              subscriptionId: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              trial: { active: false, used: false, endsAt: null, daysLeft: 0 },
            },
          },
    });
  }

  async function call(
    handler: RouteHandler,
    viewer: Viewer | null,
    init: { method?: string; path: string; headers?: Record<string, string>; body?: unknown; now?: number },
  ): Promise<{ res: Response; recorded: Recorded }> {
    const t = installTestDeps({ env: ROUTE_ENV, userId: viewer?.clerkUserId ?? null, viewer, clock: init.now });
    try {
      const headers: Record<string, string> = { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers };
      const req = request(init.path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body) });
      const res = await handler(req, noParams());
      return { res, recorded: t.recorded };
    } finally {
      t.restore();
    }
  }

  /** Runs route()'s after() tasks in order (and any they queue), like Next does once the response is sent. */
  async function runAfter(recorded: Recorded): Promise<void> {
    for (let i = 0; i < recorded.afterTasks.length; i++) await recorded.afterTasks[i]!();
  }

  async function linkAccount(userId: bigint, provider: "CHESSCOM" | "LICHESS", username: string, verified: boolean): Promise<bigint> {
    const rows = await db.$queryRawUnsafe<{ id: bigint }[]>(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "verifiedAt", "updatedAt")
       VALUES ($1, $2::"ChessProvider", $3, $4, lower($4), CASE WHEN $5::boolean THEN (now() AT TIME ZONE 'UTC') ELSE NULL END, (now() AT TIME ZONE 'UTC'))
       RETURNING id`,
      userId,
      provider,
      `${username}:${randomUUID().slice(0, 8)}`,
      username,
      verified,
    );
    return rows[0]!.id;
  }

  async function waitingRun(userId: bigint, linkedAccountId: bigint): Promise<bigint> {
    await db.$executeRawUnsafe(`UPDATE linked_accounts SET "importState" = 'WAITING_FOR_MEMBERSHIP' WHERE id = $1`, linkedAccountId);
    const rows = await db.$queryRawUnsafe<{ id: bigint }[]>(
      `INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "updatedAt")
       SELECT $3, $1, la.id, la.provider, 'INITIAL', 'WAITING_FOR_MEMBERSHIP', (now() AT TIME ZONE 'UTC') FROM linked_accounts la WHERE la.id = $2
       RETURNING id`,
      userId,
      linkedAccountId,
      // A cuid-shaped ref (Prisma fills @default(cuid()) client-side; raw SQL must supply it).
      `c${randomBytes(12).toString("hex").slice(0, 24)}`,
    );
    return rows[0]!.id;
  }

  /** `n` imported, never-analysed games of the member (the backlog release's candidates). */
  async function seedImportedGames(userId: bigint, count: number): Promise<void> {
    await db.$executeRawUnsafe(
      `WITH src AS (
         SELECT i, $2::text || lpad(i::text, 6, '0') AS ref, (now() AT TIME ZONE 'UTC') - make_interval(mins => i) AS ended
           FROM generate_series(1, $3::int) AS i
       ), g AS (
         INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                            "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", mode, source, "externalId",
                            "whitePlayerId", "plyCount", "completedAt", "analysisStatus")
         SELECT src.ref, $1, 'COMPLETED', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 600, 0, 0, 0, src.ended,
                (now() AT TIME ZONE 'UTC'), 'IMPORTED', 'CHESSCOM', src.ref, $1, 40, src.ended, 'NONE'
           FROM src
         RETURNING id, "completedAt"
       )
       INSERT INTO game_players ("gameId", "userId", color, mode, source, "endedAt", "updatedAt")
       SELECT g.id, $1, 'w', 'IMPORTED', 'CHESSCOM', g."completedAt", (now() AT TIME ZONE 'UTC') FROM g`,
      userId,
      `cb${RUN}${userId}x`.slice(0, 20),
      count,
    );
  }

  async function teardown(): Promise<void> {
    if (created.length) {
      await db.$executeRawUnsafe(`DELETE FROM jobs WHERE "userId" = ANY($1::bigint[])`, created);
      await db.$executeRawUnsafe(`DELETE FROM game_players WHERE "userId" = ANY($1::bigint[])`, created);
      await db.$executeRawUnsafe(`DELETE FROM games WHERE "creatorId" = ANY($1::bigint[])`, created);
      await db.$executeRawUnsafe(`DELETE FROM idempotency_keys WHERE "userId" = ANY($1::bigint[])`, created);
      await db.user.deleteMany({ where: { id: { in: created } } });
    }
    await db.$disconnect();
  }

  return { db, makeUser, viewerOf, call, runAfter, linkAccount, waitingRun, seedImportedGames, teardown };
}

/**
 * A Standard-Webhooks-signed Dodo delivery (`webhook-id`, `webhook-timestamp`, `webhook-signature`). `at` is the
 * event's own time (the body `timestamp`, the CAS ordering key); the delivery is signed now (the 5-minute tolerance).
 */
export function signedDodo(type: string, data: unknown, opts: { id?: string; at?: Date } = {}): { body: string; headers: Record<string, string> } {
  const id = opts.id ?? `msg_${randomUUID()}`;
  const at = opts.at ?? new Date();
  const signedAt = new Date();
  const body = JSON.stringify({ business_id: "bus_int", type, timestamp: at.toISOString(), data });
  const signature = new Webhook(WEBHOOK_KEY).sign(id, signedAt, body);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
      "webhook-signature": signature,
    },
  };
}

/** A Dodo subscription payload as the webhook and subscriptions.retrieve carry it. */
export function dodoSubscription(over: Partial<DodoSubscription> & { email: string; clerkUserId?: string }): DodoSubscription {
  const { email, clerkUserId, ...rest } = over;
  return {
    subscription_id: `sub_int_${randomUUID().slice(0, 8)}`,
    product_id: "pdt_int_monthly",
    status: "active",
    next_billing_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    cancel_at_next_billing_date: false,
    created_at: new Date(Date.now() - 2_000).toISOString(),
    payment_frequency_interval: "Month",
    trial_period_days: 7,
    customer: { customer_id: `cus_int_${randomUUID().slice(0, 8)}`, email },
    metadata: clerkUserId ? { clerkUserId } : {},
    ...rest,
  };
}
