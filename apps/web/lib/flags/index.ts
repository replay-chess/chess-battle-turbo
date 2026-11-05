// Server-side feature flags (plan §7.10, decision P1-12). Import path "@/lib/flags" as every phase cites it.
//
// Server only. Never import this from middleware (Edge), from a "use client" module, or from code that runs in
// the browser: flags reach the client inside the viewer payload (`qk.me().flags`) and `useFlag()` reads them
// there (lib/flags/client.ts). `flags.test.ts` fails when middleware or a client module imports this file.
//
// Precedence per key:
//   1. FLAGS_OVERRIDE ("shell-v3:on,other:off"), honoured only when testHooksEnabled();
//   2. PostHog local evaluation (posthog-node, definitions polled every 30 s, no network per request),
//      distinctId = viewer ref or "anon", personProperties { app_env, role, member };
//   3. FLAGS[key].default[env].
// PostHog is capped at 300 ms; a timeout, missing keys, unloaded definitions or any error → step 3.

import { cache } from "react";
import { PostHog } from "posthog-node";
import {
  FLAG_KEYS,
  FLAGS,
  defaultFlags,
  flagEnv,
  isFlagKey,
  type FlagEnv,
  type FlagKey,
  type FlagValues,
} from "./registry";
import { testHooksEnabled } from "@/lib/env-server";

export { FLAGS, FLAG_KEYS, defaultFlags, flagEnv, isFlagKey, type FlagEnv, type FlagKey, type FlagValues };

export const POSTHOG_FLAGS_TIMEOUT_MS = 300;

/**
 * The viewer fields flags read. Structural, so the `Viewer` from lib/auth/viewer.ts (MeData-shaped:
 * `user.ref`, `user.role`, `entitlement.member`, plan §7.3 / §8.2) satisfies it without an import.
 */
export type FlagViewer = {
  user: { ref: string; role: string };
  entitlement: { member: boolean };
};

export type PostHogFlagEvaluator = (
  distinctId: string,
  personProperties: Record<string, string | boolean>,
  keys: FlagKey[],
) => Promise<Record<string, boolean | string | undefined>>;

export type FlagDeps = {
  appEnv: string | undefined;
  nodeEnv: string | undefined;
  /** Raw FLAGS_OVERRIDE. */
  override: string | undefined;
  testHooksEnabled: () => boolean;
  /** null when PostHog is not configured (no project key or no feature-flags key). */
  posthog: PostHogFlagEvaluator | null;
  timeoutMs: number;
  /** Called once per instance when FLAGS_OVERRIDE is set but ignored on a production build. */
  reportIgnoredOverride: (raw: string) => void;
};

/**
 * Parses FLAGS_OVERRIDE: comma-separated `key:on|off` (also `true|false`, `1|0`). Unknown keys and malformed
 * entries are ignored. Returns only the keys it sets.
 */
export function parseFlagsOverride(raw: string | undefined): Partial<FlagValues> {
  const out: Partial<FlagValues> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const sep = part.lastIndexOf(":");
    if (sep <= 0) continue;
    const key = part.slice(0, sep).trim();
    const value = part.slice(sep + 1).trim().toLowerCase();
    if (!isFlagKey(key)) continue;
    if (value === "on" || value === "true" || value === "1") out[key] = true;
    else if (value === "off" || value === "false" || value === "0") out[key] = false;
  }
  return out;
}

function toBoolean(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  // A multivariate flag answers with its variant name: any variant means "on" for a boolean gate.
  if (typeof value === "string" && value.length > 0) return true;
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Pure flag evaluation with injected dependencies (the unit-test seam behind `getFlags`). */
export async function evaluateFlags(viewer: FlagViewer | null, deps: FlagDeps): Promise<FlagValues> {
  const env = flagEnv(deps.appEnv, deps.nodeEnv);
  const result = defaultFlags(env);

  let override: Partial<FlagValues> = {};
  if (deps.override) {
    if (deps.testHooksEnabled()) override = parseFlagsOverride(deps.override);
    else if (env === "production") deps.reportIgnoredOverride(deps.override);
  }

  const pending = FLAG_KEYS.filter((key) => override[key] === undefined);
  let remote: Record<string, boolean | string | undefined> | undefined;
  if (pending.length > 0 && deps.posthog) {
    const personProperties = {
      app_env: env,
      role: viewer?.user.role ?? "anon",
      member: viewer?.entitlement.member ?? false,
    };
    try {
      remote = await withTimeout(
        deps.posthog(viewer?.user.ref ?? "anon", personProperties, pending),
        deps.timeoutMs,
      );
    } catch {
      remote = undefined;
    }
  }

  for (const key of FLAG_KEYS) {
    const forced = override[key];
    if (forced !== undefined) {
      result[key] = forced;
      continue;
    }
    const fromPostHog = toBoolean(remote?.[key]);
    if (fromPostHog !== undefined) result[key] = fromPostHog;
  }
  return result;
}

// ── Production wiring ────────────────────────────────────────────────────────────────────────────

// These server vars join REPO/turbo.json `globalEnv` with 1B·F7 (plan §7.9); drop this disable then.
/* eslint-disable turbo/no-undeclared-env-vars */

// Module scope: one client per server instance, created on first use. Definitions are polled every 30 s.
let posthogClient: PostHog | null | undefined;

function getPostHogClient(): PostHog | null {
  if (posthogClient !== undefined) return posthogClient;
  const projectKey = process.env.POSTHOG_PROJECT_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const flagsKey = process.env.POSTHOG_FEATURE_FLAGS_KEY;
  if (!projectKey || !flagsKey) {
    posthogClient = null;
    return posthogClient;
  }
  posthogClient = new PostHog(projectKey, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    // `secretKey` is the non-deprecated name for the plan's `personalApiKey`; it accepts phx_ and phs_ keys.
    secretKey: flagsKey,
    featureFlagsPollingInterval: 30_000,
    enableLocalEvaluation: true,
    disableGeoip: true,
  });
  return posthogClient;
}

const posthogEvaluator: PostHogFlagEvaluator = async (distinctId, personProperties, keys) => {
  const client = getPostHogClient();
  if (!client) return {};
  return client.getAllFlags(distinctId, {
    personProperties: Object.fromEntries(Object.entries(personProperties).map(([k, v]) => [k, String(v)])),
    flagKeys: keys,
    onlyEvaluateLocally: true,
  });
};

let reportedIgnoredOverride = false;

function reportIgnoredOverride(): void {
  if (reportedIgnoredOverride) return;
  reportedIgnoredOverride = true;
  // Never refuse to serve (that would be an outage, plan §11.6): log once and carry on with the override ignored.
  // The Error makes logger.error raise a Sentry issue too; without one it is only a Sentry log line.
  const err = new Error("FLAGS_OVERRIDE is set on a production build and is ignored");
  void import("@/lib/logger")
    .then(({ logger }) => logger.error(err.message, err))
    .catch(() => {});
}

/**
 * True when FLAGS_OVERRIDE is set where it is ignored: a production flag env with test hooks off
 * (plan §11.6 "startup logger.error + Sentry when set on production").
 */
export function isIgnoredOverrideEnv(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.FLAGS_OVERRIDE) && !testHooksEnabled(env) && flagEnv(env.NEXT_PUBLIC_APP_ENV, env.NODE_ENV) === "production";
}

// Startup report: checked when the server first loads this module, not only on the first getFlags() call.
if (typeof window === "undefined" && process.env.NEXT_RUNTIME !== "edge" && isIgnoredOverrideEnv()) {
  reportIgnoredOverride();
}

/**
 * Flags for this request, memoised per request by React `cache()` (keyed on the viewer object, which
 * `getViewer()` itself caches per request). Pass `null` for a signed-out request.
 */
export const getFlags = cache(async (viewer: FlagViewer | null): Promise<FlagValues> => {
  if (typeof window !== "undefined" || process.env.NEXT_RUNTIME === "edge") {
    throw new Error("getFlags() is server-only (Node runtime); read flags with useFlag() on the client");
  }
  return evaluateFlags(viewer, {
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    override: process.env.FLAGS_OVERRIDE,
    // The one P1-13 guard (lib/env-server.ts): NEXT_PUBLIC_APP_ENV ∈ {dev, test} and ALLOW_TEST_HOOKS=1.
    testHooksEnabled: () => testHooksEnabled(),
    posthog: getPostHogClient() ? posthogEvaluator : null,
    timeoutMs: POSTHOG_FLAGS_TIMEOUT_MS,
    reportIgnoredOverride,
  });
});
/* eslint-enable turbo/no-undeclared-env-vars */
