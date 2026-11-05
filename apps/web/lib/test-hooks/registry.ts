// Test-hook registry (phase-01 plan §11.6, CT X12).
//
// Every switch that exists only for tests is listed here: dev routes, request
// headers, env variables and fixture data. Each names its guard, and the guard
// must be one of the three functions below. Two checks read this file:
// - lib/test-hooks/registry.test.ts: every file under app/dev/**, app/api/dev/**
//   and app/api/test/** is covered by a route entry, and each guard is allowed;
// - e2e/specs/prod-guard.spec.ts: against a production-mode build started with
//   ALLOW_TEST_HOOKS=1 it proves every route 404s, every header is ignored and
//   every env hook is inert.
//
// Later phases add their hooks here (one entry per hook, never a new guard).
// This module is data only: no imports, so Node tests and Playwright can load it.

/** Where each allowed guard is defined. */
export const GUARD_SOURCES = {
  /** NEXT_PUBLIC_APP_ENV in {dev, test} AND ALLOW_TEST_HOOKS=1 (P1-13; never VERCEL_ENV). */
  testHooksEnabled: "lib/env-server.ts",
  /** NEXT_PUBLIC_APP_ENV in {dev, test}, or unset outside a production build. The only definition of this name. */
  isNonProdApp: "lib/billing/products.ts",
  /** SPEC D11: `/dev/**` fails closed. */
  devRoutesEnabled: "lib/env.ts",
  /**
   * NEXT_PUBLIC_APP_ENV=test (plan §11.6 telemetry-sink row). Client-side hooks can't read the server-only
   * ALLOW_TEST_HOOKS, so they can't use testHooksEnabled; this is their build-time guard.
   */
  isTestBuild: "lib/env.ts",
} as const;

export type HookGuard = keyof typeof GUARD_SOURCES;
export const ALLOWED_GUARDS = Object.keys(GUARD_SOURCES) as HookGuard[];

type HookBase = {
  id: string;
  /** Phase that introduced the hook. */
  phase: number;
  guard: HookGuard;
  description: string;
};

export type RouteHook = HookBase & {
  kind: "route";
  /** Glob (relative to apps/web) of the files the guard protects. */
  files: string;
  /** Concrete URLs prod-guard.spec.ts requests; each must 404 in production. */
  paths: string[];
};

export type HeaderHook = HookBase & {
  kind: "header";
  /** Headers sent together; with hooks off the response must equal the plain one. */
  headers: Record<string, string>;
  /** Request prod-guard.spec.ts sends with and without the headers. */
  probe: { method: "GET" | "POST"; path: string };
};

export type EnvHook = HookBase & {
  kind: "env";
  env: string;
  /** Value prod-guard's production build is started with. */
  prodGuardValue: string;
  /** How production inertness is proven: a request, a page check, or a unit test. */
  proof:
    | { by: "http"; method: "GET" | "POST"; path: string; headers?: Record<string, string>; expectStatus: number[] }
    | { by: "browser"; path: string; absentGlobal: string }
    | { by: "unit"; test: string };
};

export type DataHook = HookBase & {
  kind: "data";
  value: string;
  proof: { by: "unit"; test: string };
};

export type TestHook = RouteHook | HeaderHook | EnvHook | DataHook;

export const TEST_HOOKS: readonly TestHook[] = [
  {
    kind: "route",
    id: "dev-routes",
    phase: 1,
    guard: "devRoutesEnabled",
    description: "UI gallery, shell and stage demos, data-layer demo, skeleton demo",
    files: "app/dev/**",
    paths: [
      "/dev/ui",
      "/dev/ui/sections/foundations",
      "/dev/ui/sections/controls",
      "/dev/ui/sections/overlays",
      "/dev/ui/sections/shell",
      "/dev/ui/sections/layout",
      "/dev/ui/shell",
      "/dev/ui/stage",
      "/dev/ui/data",
      "/dev/ui/skeletons",
    ],
  },
  {
    kind: "header",
    id: "x-rc-fault",
    phase: 1,
    guard: "testHooksEnabled",
    description: "route() answers the injected error envelope (401|402|429|500|503)",
    headers: { "x-rc-fault": "500" },
    probe: { method: "GET", path: "/api/health" },
  },
  {
    kind: "header",
    id: "x-rc-fault-429",
    phase: 1,
    guard: "testHooksEnabled",
    description: "x-rc-fault 429 with a custom Retry-After",
    headers: { "x-rc-fault": "429", "x-rc-fault-retry": "5" },
    probe: { method: "GET", path: "/api/health" },
  },
  {
    kind: "header",
    id: "x-rc-now",
    phase: 1,
    guard: "testHooksEnabled",
    description: "ctx.now from the header; also needs x-e2e-token = E2E_TEST_TOKEN",
    headers: { "x-rc-now": "946684800000", "x-e2e-token": "prod-guard-token" },
    probe: { method: "GET", path: "/api/health" },
  },
  {
    kind: "env",
    id: "flags-override",
    phase: 1,
    guard: "testHooksEnabled",
    description: "FLAGS_OVERRIDE forces flag values (e.g. shell-v3:off for the flags-off project)",
    env: "FLAGS_OVERRIDE",
    prodGuardValue: "shell-v3:on",
    proof: { by: "unit", test: "lib/flags/flags.test.ts" },
  },
  {
    kind: "env",
    id: "perf-auth-bypass",
    phase: 1,
    guard: "testHooksEnabled",
    description: "PERF_AUTH_BYPASS + x-perf-token lets k6 call member routes (H9)",
    env: "PERF_AUTH_BYPASS",
    prodGuardValue: "true",
    proof: {
      by: "http",
      method: "GET",
      path: "/api/me",
      headers: { "x-perf-token": "prod-guard-perf-token" },
      expectStatus: [401, 404],
    },
  },
  {
    kind: "env",
    id: "telemetry-sink",
    phase: 1,
    guard: "isTestBuild",
    description: "NEXT_PUBLIC_TELEMETRY_SINK=1 mirrors client events into window.__rcTelemetry (test builds only)",
    env: "NEXT_PUBLIC_TELEMETRY_SINK",
    prodGuardValue: "1",
    proof: { by: "browser", path: "/", absentGlobal: "__rcTelemetry" },
  },
  {
    kind: "data",
    id: "e2e-fixture-product",
    phase: 1,
    guard: "isNonProdApp",
    description: "subscriptionProductId 'e2e-fixture' resolves to the monthly plan outside production",
    value: "e2e-fixture",
    proof: { by: "unit", test: "lib/billing/products.test.ts" },
  },
];

/**
 * Kill switches are production operations controls, not test hooks: they are
 * allowed in production and only log a warning there (plan §11.6).
 */
export const KILL_SWITCHES = [
  { env: "BILLING_PAYWALL", off: "off", note: "Phase 0 ops switch; startup warning when off" },
  { env: "MIDDLEWARE_MEMBER_GATE", off: "off", note: "member gate in middleware" },
  { env: "LEGACY_402_MIRROR", off: "off", note: "removed in P2" },
  { env: "EDGE_DOC_LIMIT", off: "off", note: "optional middleware document limiter" },
] as const;

/**
 * Env values prod-guard's production build is started with. The tokens match
 * the probe headers above, so a header is proven ignored even with a valid token.
 */
export function prodGuardEnv(): Record<string, string> {
  const env: Record<string, string> = {
    NEXT_PUBLIC_APP_ENV: "production",
    ALLOW_TEST_HOOKS: "1",
    E2E_TEST_TOKEN: "prod-guard-token",
    PERF_TOKEN: "prod-guard-perf-token",
  };
  for (const hook of TEST_HOOKS) if (hook.kind === "env") env[hook.env] = hook.prodGuardValue;
  return env;
}
