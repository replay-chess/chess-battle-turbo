// route() test harness (unit, contract and integration tests). Never imported by app code.
//
//   const t = installTestDeps({ userId: "user_1", viewer: memberViewer() });
//   const res = await GET(request("/api/health"), noParams());
//   t.restore();
import { NextRequest } from "next/server";
import type { RateLimitDecision } from "@/lib/rate-limit-db";
import { setRouteDeps, type RouteDeps, type Viewer } from "@/lib/api/context";

export type Recorded = {
  authCalls: number;
  viewerCalls: number;
  rateLimitCalls: { specs: unknown; subject: unknown }[];
  exceptions: { err: unknown; context: unknown }[];
  messages: { message: string; context: unknown }[];
  breadcrumbs: unknown[];
  logs: { level: string; message: string; context: Record<string, unknown> }[];
  tags: Record<string, string>;
  afterTasks: (() => unknown)[];
  sleeps: number[];
};

export type TestDepsOptions = {
  env?: Record<string, string | undefined>;
  userId?: string | null;
  viewer?: Viewer | null;
  rateLimit?: RateLimitDecision | ((specs: unknown, subject: unknown) => RateLimitDecision);
  clock?: number;
  overrides?: Partial<RouteDeps>;
};

/** Strict (test) env: BigInt and bad cache headers throw; hooks off unless the test turns them on. */
export const TEST_ENV: Record<string, string | undefined> = { NODE_ENV: "test", NEXT_PUBLIC_APP_ENV: "test" };

export const FIXED_NOW = Date.parse("2026-11-05T12:00:00.000Z");

export function installTestDeps(options: TestDepsOptions = {}): { recorded: Recorded; restore: () => void } {
  const recorded: Recorded = {
    authCalls: 0,
    viewerCalls: 0,
    rateLimitCalls: [],
    exceptions: [],
    messages: [],
    breadcrumbs: [],
    logs: [],
    tags: {},
    afterTasks: [],
    sleeps: [],
  };
  let perf = 0;
  const deps: Partial<RouteDeps> = {
    env: { ...TEST_ENV, ...options.env },
    getAuth: async () => {
      recorded.authCalls += 1;
      return { userId: options.userId ?? null };
    },
    getViewer: async () => {
      recorded.viewerCalls += 1;
      return options.viewer ?? null;
    },
    checkRateLimit: async (specs, subject) => {
      recorded.rateLimitCalls.push({ specs, subject });
      const rl = options.rateLimit;
      if (typeof rl === "function") return rl(specs, subject);
      return rl ?? { allowed: true, retryAfterSec: 0 };
    },
    clientIp: (headers) => headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    dataCache: (fn) => fn,
    after: (task) => {
      recorded.afterTasks.push(task);
    },
    telemetry: {
      startSpan: (_name, _attributes, fn) => fn(),
      setTag: (key, value) => {
        recorded.tags[key] = value;
      },
      captureException: (err, context) => {
        recorded.exceptions.push({ err, context });
      },
      captureMessage: (message, context) => {
        recorded.messages.push({ message, context });
      },
      breadcrumb: (crumb) => {
        recorded.breadcrumbs.push(crumb);
      },
      distribution: () => undefined,
      count: () => undefined,
    },
    log: (level, message, context) => {
      recorded.logs.push({ level, message, context: context as Record<string, unknown> });
    },
    clock: () => options.clock ?? FIXED_NOW,
    perf: () => (perf += 1),
    sleep: async (ms) => {
      recorded.sleeps.push(ms);
    },
    ...options.overrides,
  };
  const restore = setRouteDeps(deps);
  return { recorded, restore };
}

export function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {},
): NextRequest {
  const hasBody = init.body !== undefined && init.body !== null;
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers: init.headers,
    body: hasBody ? init.body : undefined,
    ...(hasBody && typeof init.body !== "string" ? { duplex: "half" } : {}),
  } as ConstructorParameters<typeof NextRequest>[1]);
}

export function noParams(params: Record<string, string> = {}): { params: Promise<unknown> } {
  return { params: Promise.resolve(params) };
}

type EntitlementOverrides = Omit<Partial<Viewer["entitlement"]>, "trial" | "paymentIssue"> & {
  trial?: Partial<Viewer["entitlement"]["trial"]>;
  paymentIssue?: Partial<NonNullable<Viewer["entitlement"]["paymentIssue"]>> | null;
  /** Shorthand for billing.neverPaid (the trial_used reason). */
  neverPaid?: boolean;
};

export type ViewerOverrides = Omit<Partial<Viewer>, "entitlement" | "user" | "billing"> & {
  entitlement?: EntitlementOverrides;
  user?: Partial<Viewer["user"]>;
  billing?: Partial<Viewer["billing"]>;
};

const FIXTURE_PERIOD_END = "2026-12-05T12:00:00.000Z";

/**
 * A full lib/auth/viewer.ts Viewer (an active monthly member by default); overrides merge one level deep
 * (entitlement.trial and entitlement.paymentIssue too). `role: "admin"` also sets user.role.
 */
export function viewerFixture(overrides: ViewerOverrides = {}): Viewer {
  const { entitlement = {}, user, billing, ...rest } = overrides;
  const { trial, paymentIssue, neverPaid, ...entitlementRest } = entitlement;
  const role = rest.role ?? "user";
  const fullPaymentIssue =
    paymentIssue === undefined || paymentIssue === null
      ? (paymentIssue ?? null)
      : { state: "banner" as const, accessEndsAt: FIXTURE_PERIOD_END, accessEndsAtLabel: "Dec 5", ...paymentIssue };
  const summary = {
    entitled: true,
    plan: "player" as const,
    planKey: "monthly" as const,
    interval: "month" as const,
    priceCents: 499,
    status: "active" as const,
    subscriptionId: "sub_fixture",
    currentPeriodEnd: FIXTURE_PERIOD_END,
    cancelAtPeriodEnd: false,
    trial: { active: false, used: false, endsAt: null, daysLeft: 0 },
  };
  return {
    id: 1n,
    ref: "cviewer00000000000000000000",
    clerkUserId: "user_fixture",
    gamesVersion: 0,
    ...rest,
    role,
    user: {
      ref: rest.ref ?? "cviewer00000000000000000000",
      code: "FIXTUR",
      name: "Fixture Viewer",
      email: "fixture@example.test",
      avatarUrl: null,
      role,
      onboarded: true,
      ratingLabel: null,
      ...user,
    },
    entitlement: {
      state: "member",
      member: true,
      entitled: true,
      paywall: true,
      planKey: "monthly",
      interval: "month",
      priceCents: 499,
      status: "active",
      currentPeriodEnd: FIXTURE_PERIOD_END,
      cancelAtPeriodEnd: false,
      hasBillingPortal: true,
      ...entitlementRest,
      trial: { active: false, used: false, endsAt: null, daysLeft: null, eligible: false, ...trial },
      paymentIssue: fullPaymentIssue,
    },
    billing: {
      neverPaid: neverPaid ?? false,
      email: "fixture@example.test",
      dodoCustomerId: "cus_fixture",
      subscriptionId: "sub_fixture",
      subscriptionProductId: "pdt_fixture",
      summary,
      ...billing,
    },
  };
}

export async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
