// route()'s dependencies and the test seam (plan §7.2, §12.1 route.test.ts "injected getAuth/getViewer").
//
// Everything route() needs from the outside world goes through getRouteDeps(): Clerk's auth(), the viewer read, the
// rate limiter, the data cache, next/server after(), Sentry and the logger. Production uses the defaults below; tests
// call setRouteDeps({...}) and get a restore function back.
//
// Viewer: lib/auth/viewer.ts (1B·F4a). The default loader is getRouteViewer() (React cache(), one statement,
// provisioning on a first request) and the 402 reason is membership.ts's reasonFor().
import * as Sentry from "@sentry/nextjs";
import type { SubscriptionReason } from "@repo/contracts/http/codes";
import { after } from "next/server";
import { unstable_cache } from "next/cache";
import { reasonFor } from "@/lib/auth/membership";
import type { Viewer } from "@/lib/auth/viewer";
import { logger, type LogContext } from "@/lib/logger";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit-db";
import type { LedgerProbe } from "@/lib/billing/trial-eligibility";

type Env = Readonly<Record<string, string | undefined>>;

export type { Viewer };
export type MembershipStateName = Viewer["entitlement"]["state"];
/** What route() reads from the viewer (kept as a name for older imports; it is the full Viewer since 1B·F4a). */
export type RouteViewer = Viewer;

export type Telemetry = {
  startSpan<T>(name: string, attributes: Record<string, string>, fn: () => T): T;
  setTag(key: string, value: string): void;
  captureException(err: unknown, context: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void;
  captureMessage(
    message: string,
    context: { level: "info" | "warning" | "error"; tags?: Record<string, string>; extra?: Record<string, unknown> },
  ): void;
  breadcrumb(crumb: { category: string; message: string; level?: "info" | "warning"; data?: Record<string, unknown> }): void;
  distribution(name: string, value: number, attributes: Record<string, string>): void;
  count(name: string, attributes: Record<string, string>): void;
};

export type DataCache = <T>(
  fn: () => Promise<T>,
  keyParts: string[],
  options: { tags: string[]; revalidate: number | false },
) => () => Promise<T>;

export type RouteDeps = {
  env: Env;
  /** Clerk auth() (local JWT verification, no network). Never called for auth "public". */
  getAuth(): Promise<{ userId: string | null }>;
  /** The signed-in viewer (one DB statement), or null when signed out, unknown or inactive. */
  getViewer(): Promise<Viewer | null>;
  /** 402 details.reason for a viewer who is not a member (plan §8.3). */
  memberDenialReason(viewer: Viewer): SubscriptionReason;
  checkRateLimit: typeof checkRateLimit;
  clientIp(headers: Pick<Headers, "get">): string | null;
  dataCache: DataCache;
  after(task: () => unknown): void;
  telemetry: Telemetry;
  log(level: "info" | "warn" | "error", message: string, context: LogContext): void;
  /** Epoch ms (ctx.now unless x-rc-now overrides). */
  clock(): number;
  /** Monotonic ms for durations. */
  perf(): number;
  sleep(ms: number): Promise<void>;
  /** lib/auth/claims.ts syncClerkClaims (never throws; a no-op when the claims already match). Run it in after(). */
  syncClaims(userId: bigint): Promise<void>;
  /** The trial-ledger probe behind `/api/me` `trial.eligible` (lib/billing/trial-eligibility.ts; one statement). */
  trialLedgerProbe: LedgerProbe;
};

// ---------------------------------------------------------------------------
// Viewer (1B·F4a)

/** route()'s viewer loader: lib/auth/viewer.ts, loaded lazily so this module stays light for plain Node tests. */
async function defaultGetViewer(): Promise<Viewer | null> {
  const { getRouteViewer } = await import("@/lib/auth/viewer");
  return getRouteViewer();
}

/** Plan §8.3 (lib/auth/membership.ts). */
export const defaultMemberDenialReason: (viewer: Viewer) => SubscriptionReason = reasonFor;

// ---------------------------------------------------------------------------
// Defaults

const sentryTelemetry: Telemetry = {
  startSpan: (name, attributes, fn) => Sentry.startSpan({ name, op: "function.api", attributes }, fn),
  setTag: (key, value) => Sentry.setTag(key, value),
  captureException: (err, context) => {
    Sentry.captureException(err, context);
  },
  captureMessage: (message, context) => {
    Sentry.captureMessage(message, context);
  },
  breadcrumb: (crumb) => Sentry.addBreadcrumb({ type: "default", ...crumb }),
  distribution: (name, value, attributes) => Sentry.metrics.distribution(name, value, { unit: "millisecond", attributes }),
  count: (name, attributes) => Sentry.metrics.count(name, 1, { attributes }),
};

/**
 * route()'s after(): the task starts on the next macrotask (once the handler's synchronous part is done) and is handed
 * to Next's `after()` as a PROMISE, which Next keeps alive with `waitUntil`. FIX-1: Next's callback form waits for the
 * response's `close` event, and when the browser navigated away right after a POST (Settings → /games after a link)
 * that never arrived on `next start`: every after-effect of the request was lost (the import kick, the audit rows,
 * the legacy dual-write, the fan-out), 2 of 3 links in a row on the e2e stack. A task failure is reported, never
 * thrown (as Next's own after() does). Exported for the unit test.
 */
export function scheduleAfter(
  task: () => unknown,
  keepAlive: (promise: Promise<unknown>) => void,
  onError: (err: unknown) => void = (err) => logger.error("route after() task failed", err),
): void {
  const run = new Promise<void>((resolve) => setImmediate(resolve)).then(task).then(
    () => undefined,
    (err: unknown) => onError(err),
  );
  keepAlive(run);
}

function defaultDeps(): RouteDeps {
  return {
    env: process.env,
    getAuth: async () => {
      const { auth } = await import("@clerk/nextjs/server");
      const { userId } = await auth();
      return { userId: userId ?? null };
    },
    getViewer: defaultGetViewer,
    memberDenialReason: defaultMemberDenialReason,
    checkRateLimit,
    clientIp: clientIpFrom,
    dataCache: (fn, keyParts, options) => unstable_cache(fn, keyParts, options),
    after: (task) => scheduleAfter(task, after),
    telemetry: sentryTelemetry,
    // logger.error's second argument is the error object; route() reports exceptions itself, so pass none.
    log: (level, message, context) =>
      level === "error" ? logger.error(message, undefined, context) : logger[level](message, context),
    clock: () => Date.now(),
    perf: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    syncClaims: async (userId) => (await import("@/lib/auth/claims")).syncClerkClaims(userId),
    trialLedgerProbe: async (input) => (await import("@/lib/billing/trial-eligibility")).defaultLedgerProbe(input),
  };
}

let currentDeps: RouteDeps = defaultDeps();

export function getRouteDeps(): RouteDeps {
  return currentDeps;
}

/** Test seam: replaces some dependencies; returns a function that restores the previous set. */
export function setRouteDeps(overrides: Partial<RouteDeps>): () => void {
  const previous = currentDeps;
  currentDeps = { ...currentDeps, ...overrides };
  return () => {
    currentDeps = previous;
  };
}

// ---------------------------------------------------------------------------
// Build info (health, and F4a's MeData.buildId)

const APP_ENVS = ["dev", "production", "test"] as const;
export type AppEnvName = (typeof APP_ENVS)[number] | "local";

/** NEXT_PUBLIC_APP_ENV as the contract's AppEnv; unset (local next dev) → "local". */
export function appEnvName(env: Env = currentDeps.env): AppEnvName {
  const value = env.NEXT_PUBLIC_APP_ENV;
  return (APP_ENVS as readonly string[]).includes(value ?? "") ? (value as AppEnvName) : "local";
}

/** The deployed commit, the same value the client sends as x-rc-build (lib/api/client.ts BUILD_ID). */
export function serverBuildId(env: Env = currentDeps.env): string {
  return env.VERCEL_GIT_COMMIT_SHA || env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev";
}

/** Next's data cache (unstable_cache) through the seam, for route handlers' public data (openings). */
export function cachedData<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  options: { tags: string[]; revalidate: number | false },
): () => Promise<T> {
  return currentDeps.dataCache(fn, keyParts, options);
}
