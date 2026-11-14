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
    description: "UI gallery, shell and stage demos, data-layer demo, skeleton demo, board demo (P2)",
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
      "/dev/ui/board",
      "/dev/ui/game",
      // Phase 3 (phase-03 plan §4.10): the review, game-over and around-review demo routes.
      "/dev/ui/review",
      "/dev/ui/review/complete",
      "/dev/ui/review/share",
      "/dev/ui/game-over",
      "/dev/ui/games",
      "/dev/ui/compare",
      "/dev/ui/practice",
      // Phase 4 (phase-04 plan §4.12): the activating demo (WP-D).
      "/dev/ui/activating",
      // Phase 4 (phase-04 plan §4.12): the onboarding demo index and one step page (matches /dev/ui/onboarding/[step]).
      "/dev/ui/onboarding",
      "/dev/ui/onboarding/welcome",
      // P4 WP-G: /settings/connected in its ten board states (phase-04 plan §4.12).
      "/dev/ui/connected",
      // Phase 4 (phase-04 plan §7.7.4): the provider fault table page (also admin + testHooksEnabled() in the page).
      "/dev/import",
      // Phase 5 (phase-05 plan §2.1 "Dev demo routes", §4): the Train, runner, summary and Home demo routes
      // (`?state=`, `?stress=1`), fed by app/dev/ui/_fixtures/train.ts (WP-F, WP-G, WP-H build the pages).
      "/dev/ui/train/hub",
      "/dev/ui/train/bank",
      "/dev/ui/train/runner",
      "/dev/ui/train/puzzles",
      "/dev/ui/train/summary",
      "/dev/ui/home",
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
  // ── Phase 2 (phase-02 plan 12.0 "Test hooks P2 adds"; /dev/ui/game is in the dev-routes entry above) ──
  {
    kind: "env",
    id: "timing-profile",
    phase: 2,
    guard: "isTestBuild",
    description:
      "TIMING_PROFILE=fast shrinks the socket server's study, first-move, grace, rematch and resume timers to 2–5 s. " +
      "Read only by apps/web-socket (config/env.ts), which refuses to boot with it unless APP_ENV=test; the web app never reads it",
    env: "TIMING_PROFILE",
    prodGuardValue: "fast",
    proof: { by: "unit", test: "../web-socket/test/config.test.ts" },
  },
  {
    kind: "data",
    id: "fixture-socket-server",
    phase: 2,
    guard: "isTestBuild",
    description:
      "e2e/fixtures/socket-server.ts: the fast (:3102) and restartable (:3103) socket servers, APP_ENV=test with a per-run " +
      "ops key; pages reach them only through the Playwright WebSocket route, so no build ships a URL to them",
    value: "ws://127.0.0.1:3102, ws://127.0.0.1:3103",
    proof: { by: "unit", test: "../web-socket/test/config.test.ts" },
  },
  {
    kind: "data",
    id: "e2e-run-claim",
    phase: 2,
    guard: "isTestBuild",
    description: "Socket token claim e2eRun (queue isolation per test pair); minting refuses it unless the token env is test",
    value: "e2eRun",
    proof: { by: "unit", test: "lib/hooks/socket-token.test.ts" },
  },
  // ── Phase 3 (phase-03 plan §7.9, §11.2 rule 10) ──
  {
    kind: "env",
    id: "worker-fault",
    phase: 3,
    guard: "isTestBuild",
    description:
      "WORKER_FAULT (fail_at_ply:n, stall_at_ply:n, engine_crash:n, hold_queue, pause_at:<step>:<ms>) and ENGINE=fake. Read " +
      "only by apps/analysis-worker (config/env.ts): honoured with APP_ENV dev|test, the worker refuses to boot with either " +
      "under APP_ENV=production; a kick body's one-shot fault is honoured only with APP_ENV=test. The web app never reads them",
    env: "WORKER_FAULT",
    prodGuardValue: "fail_at_ply:1",
    proof: { by: "unit", test: "../analysis-worker/src/boot.test.ts" },
  },
  {
    kind: "route",
    id: "dev-import-fault",
    phase: 4,
    guard: "testHooksEnabled",
    description:
      "The provider fault table (phase-04 plan §7.7.4): /api/dev/import-fault forwards {v:1, provider, mode, ttlSec} to the " +
      "worker's /internal/dev/fault (signed webwk). Admin session or x-e2e-token only; 404 for everyone else and in every " +
      "production build. The worker side is IMPORT_FAULTS_ALLOWED (env hook below)",
    files: "app/api/dev/import-fault/**",
    paths: ["/api/dev/import-fault"],
  },
  {
    kind: "env",
    id: "import-faults-allowed",
    phase: 4,
    guard: "testHooksEnabled",
    description:
      "IMPORT_FAULTS_ALLOWED=1 turns on the analysis worker's provider fault table (apps/analysis-worker/src/dev/faults.ts). " +
      "Read only by the worker (config/env.ts); it refuses to boot with it under APP_ENV=production. The web never reads it",
    env: "IMPORT_FAULTS_ALLOWED",
    prodGuardValue: "1",
    proof: { by: "unit", test: "../analysis-worker/src/dev/__tests__/faults.test.ts" },
  },
  // ── Phase 4 (phase-04 plan §12.4, D4-19; WP-H) ──
  {
    kind: "env",
    id: "dodo-api-base-url",
    phase: 4,
    guard: "isTestBuild",
    description:
      "DODO_API_BASE_URL points the web's Dodo REST client at the e2e upstream mock (`/dodo` of e2e/mocks/upstream-server.ts). " +
      "lib/billing/dodo-env.ts refuses it (throws) unless the app env is `test`, so a dev or production build never talks to " +
      "anything but Dodo; never set on Vercel",
    env: "DODO_API_BASE_URL",
    prodGuardValue: "http://127.0.0.1:4010/dodo",
    proof: { by: "unit", test: "lib/billing/dodo-env.test.ts" },
  },
  {
    kind: "env",
    id: "provider-base-urls",
    phase: 4,
    guard: "isNonProdApp",
    description:
      "CHESSCOM_API_BASE / LICHESS_BASE_URL point the web (and, with their own values, the worker) at the e2e upstream mock. " +
      "lib/env-providers.ts refuses anything but the real origins when the app env is production (the worker's config/env.ts " +
      "does the same); dev and production keep them unset",
    env: "CHESSCOM_API_BASE",
    prodGuardValue: "http://127.0.0.1:4010/chesscom",
    proof: { by: "unit", test: "lib/env-providers.test.ts" },
  },
  {
    kind: "data",
    id: "upstream-mock",
    phase: 4,
    guard: "isTestBuild",
    description:
      "e2e/mocks/upstream-server.ts: Chess.com, Lichess (OAuth consent, token revoke, NDJSON export) and Dodo (checkout, hosted " +
      "pay page, signed subscription.active) on 4010 (+ E2E_PORT_OFFSET), started by playwright.config.ts only; reached only " +
      "through the two env hooks above, and its webhooks only verify against a test build's per-run DODO_PAYMENTS_WEBHOOK_KEY",
    value: "http://127.0.0.1:4010",
    proof: { by: "unit", test: "e2e/mocks/upstream-server.test.ts" },
  },
  {
    kind: "data",
    id: "dodo-webhook-fixture",
    phase: 4,
    guard: "isTestBuild",
    description:
      "e2e/fixtures/dodo-webhook.ts signs subscription.active / payment.succeeded / payment.failed with the server's " +
      "DODO_PAYMENTS_WEBHOOK_KEY (Standard Webhooks); the key differs on every deployed site, so these specs are @local-only",
    value: "standardwebhooks(DODO_PAYMENTS_WEBHOOK_KEY)",
    proof: { by: "unit", test: "e2e/fixtures/dodo-webhook.test.ts" },
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
  // Phase 5 (phase-05 plan §7.9, §13.4; interface check §0.15: no Edge Config, so the plan's `puzzles_enabled` is env).
  { env: "PUZZLES_ENABLED", off: "off", note: "puzzle sessions and the plan's puzzle step (off: 'Puzzles are taking a break.')" },
  { env: "BANK_EXTRACT_ENABLED", off: "false", note: "worker J1 mistake extraction (analysis still completes; the backfill catches up)" },
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
