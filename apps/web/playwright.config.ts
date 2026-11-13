import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import type { ConsoleGuardOptions } from "./e2e/fixtures/console-guard";
import type { TelemetryOptions } from "./e2e/fixtures/telemetry";
import { prodGuardEnv } from "./lib/test-hooks/registry";
import {
  DEFAULT_SINK_PORT,
  E2E_PORT_OFFSET,
  FAST_SOCKET_PORT,
  MAIN_SOCKET_PORT,
  SOCKET_SERVER_COMMAND,
  WEB_PORT,
  socketServerEnv,
} from "./e2e/fixtures/socket-server";
import { WORKER_PORT, WORKER_SERVER_COMMAND, WORKER_URL, workerFaultsHonoured, workerServerEnv } from "./e2e/fixtures/analysis-worker";
import { UPSTREAM_PORT, upstreamEnv } from "./e2e/mocks/upstream-client";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

// Load .env.test FIRST with override so E2E tests always use the dev/E2E database,
// never prod — even if a dev server is already running or .env.local is present.
// E2E_ENV_FILE names another file (an absolute path outside the repo), e.g. .env.test with a local Docker database
// for a CI-like run on a laptop; it is loaded the same way.
config({ path: process.env.E2E_ENV_FILE || path.resolve(WEB_DIR, ".env.test"), override: true });
// A shifted run (E2E_PORT_OFFSET, e.g. a second git worktree) points the app at its own main socket and worker. `next
// dev` reads them at runtime; a `next start` build must have been built with the same value (NEXT_PUBLIC_* is inlined).
if (E2E_PORT_OFFSET) {
  process.env.NEXT_PUBLIC_WEBSOCKET_URL = `ws://localhost:${MAIN_SOCKET_PORT}`;
  process.env.ANALYSIS_WORKER_URL = WORKER_URL;
}

// ── Targets (phase-01 plan §12.3, CT X2) ────────────────────────────────────
// E2E_BASE_URL runs the suite against a deployed site (the dev URL): no local
// servers, Vercel's automation bypass headers when the secret is present, and
// `@local-only` specs (sinks, mocks, the local socket) skipped.
// PROD_GUARD=1 runs only e2e/specs/prod-guard.spec.ts against a production-mode
// build on :3200 started with every test hook switched on (plan §11.6).
const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const REMOTE = Boolean(BASE_URL) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL ?? "");
const PROD_GUARD = process.env.PROD_GUARD === "1";
const PROD_GUARD_PORT = 3200;
const SINK_PORT = Number(process.env.POSTHOG_SINK_PORT ?? DEFAULT_SINK_PORT);
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

// ── flags-off (plan §12.3, CT X13; 1Q·2) ─────────────────────────────────────
// `--project=flags-off` (or E2E_FLAGS_OFF=1) switches to the flags-off mode: one project, served by its
// own web server with FLAGS_OVERRIDE=shell-v3:off, that runs flags-off.spec.ts and the Phase 0 specs.
// The mode is read from argv once and pinned in the env, so worker processes (which re-read this
// config with other argv) see the same projects. Port 3110, not the plan's 3100: the devices suite
// builds and reuses a server on 3100 and must never reuse this one.
const argv = process.argv;
const FLAGS_OFF =
  process.env.E2E_FLAGS_OFF === "1" ||
  argv.some((a, i) => a === "--project=flags-off" || (a === "--project" && argv[i + 1] === "flags-off"));
if (FLAGS_OFF) process.env.E2E_FLAGS_OFF = "1";
const FLAGS_OFF_PORT = Number(process.env.FLAGS_OFF_PORT ?? 3110 + E2E_PORT_OFFSET);
/** The open phase's flags, switched off. Every later phase appends its own `<key>:off`. */
const FLAGS_OFF_OVERRIDE =
  "shell-v3:off,live-protocol-v2:off,game-v3:off,review-v3:off,review-share:off,onboarding-v3:off,import-v3:off";
// Phase 0 has no @smoke tags, so its specs are listed by file. tournament (≈ 10 min) stays in the main run; the
// bot and friend games cover the game flow here. P2 plan 12.10: with live-protocol-v2 and game-v3 off, the legacy
// play-with-friend and quick-match specs pass over protocol v1 until the parity gate.
const FLAGS_OFF_SPECS = [
  "**/quick-match.spec.ts",
  "**/flags-off.spec.ts",
  "**/membership.spec.ts",
  "**/paid-only.spec.ts",
  "**/pricing.spec.ts",
  "**/play-with-bot.spec.ts",
  "**/play-with-friend.spec.ts",
];

// ── review-lapsed-read on (phase-03 plan §12.3 review-lapsed.spec.ts, P3-Q1) ─────────────────────────────────────
// The flag is off for the main run (the owner's default). `--project=lapsed-read` (or E2E_LAPSED_READ=1) switches to
// one project served by its own web server with FLAGS_OVERRIDE + review-lapsed-read:on (port 3111, the same build in
// CI) that runs only the `@lapsed-read-on` tests; the main projects leave those out. The same server also has the H3
// switch `analysis-redirect` on (FIX-1): `@analysis-redirect-on` tests (analysis-redirects.spec.ts, the R1 308s) run
// there, while the main run keeps the legacy /analysis page as stage A serves it.
const LAPSED_READ =
  process.env.E2E_LAPSED_READ === "1" ||
  argv.some((a, i) => a === "--project=lapsed-read" || (a === "--project" && argv[i + 1] === "lapsed-read"));
if (LAPSED_READ) process.env.E2E_LAPSED_READ = "1";
const LAPSED_READ_PORT = Number(process.env.LAPSED_READ_PORT ?? 3111 + E2E_PORT_OFFSET);
const LAPSED_READ_TAG = /@lapsed-read-on\b/;
const ANALYSIS_REDIRECT_TAG = /@analysis-redirect-on\b/;
const FLAG_SERVER_TAGS = /@lapsed-read-on\b|@analysis-redirect-on\b/;

// ── Quarantine (CT X14) ─────────────────────────────────────────────────────
// PR CI skips quarantined tests; nightly sets E2E_INCLUDE_QUARANTINED=1 and
// reports them. An expired entry fails the run in CI.
type QuarantineEntry = { testId: string; reason: string; owner: string; expires: string; issue?: string };
function readQuarantine(): QuarantineEntry[] {
  try {
    const data = JSON.parse(readFileSync(path.join(WEB_DIR, "e2e/quarantine.json"), "utf8")) as {
      entries?: QuarantineEntry[];
    };
    return data.entries ?? [];
  } catch {
    return [];
  }
}
const quarantine = readQuarantine();
const expired = quarantine.filter((q) => !(Date.parse(`${q.expires}T23:59:59Z`) >= Date.now()));
if (expired.length) {
  const msg = `e2e/quarantine.json has expired entries: ${expired.map((q) => q.testId).join("; ")}`;
  if (process.env.CI) throw new Error(msg);
  console.warn(`[playwright] ${msg}`);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "e2e/specs/x.spec.ts › Describe › title" → matches the title path, whatever the separator. */
const quarantinePattern = (testId: string) =>
  new RegExp(
    testId
      .split("›")
      .map((s) => escapeRe(s.trim()))
      .filter(Boolean)
      .join(".*"),
  );

// ── Grep (CT X11) ───────────────────────────────────────────────────────────
// E2E_PUBLIC_ONLY=1   signed-out specs only (@public)
// E2E_PHASES=1,2      only specs tagged @p1 or @p2
// E2E_SMOKE=1         only @smoke specs, in every project that runs (the ci.yml e2e-smoke job). Use it instead of
//                     `--grep @smoke` whenever a selected project has dependencies: Playwright applies a CLI grep to
//                     the top-level projects only, so `--project=game-serial --grep @smoke` would run its dependencies
//                     (chromium, play-queue, webkit-iphone) in full. The config grep below reaches them too.
// Every condition must hold, so they compose as lookaheads.
const conditions: string[] = [];
if (process.env.E2E_PUBLIC_ONLY === "1") conditions.push("@public\\b");
if (process.env.E2E_SMOKE === "1") conditions.push("@smoke\\b");
if (process.env.E2E_PHASES) {
  const phases = process.env.E2E_PHASES.split(",").map((p) => p.trim().replace(/^p/i, "")).filter(Boolean);
  conditions.push(`@p(${phases.map(escapeRe).join("|")})\\b`);
}
const grepFor = (extra: string[] = []) => {
  const all = [...conditions, ...extra];
  return all.length ? new RegExp(`^${all.map((c) => `(?=.*${c})`).join("")}`) : undefined;
};
// `@prod-build` specs need what only a production build serves (the service worker /sw.js: next-pwa is off under
// `next dev`). They run in CI (`pnpm start` on the build), against E2E_BASE_URL and with PROD_GUARD; a local run
// serves `next dev` unless E2E_WEB_BUILD=1 (after `pnpm build`: the config then starts `pnpm start`).
const WEB_BUILD = Boolean(process.env.CI) || process.env.E2E_WEB_BUILD === "1";
const DEV_SERVER = !BASE_URL && !PROD_GUARD && !WEB_BUILD;
const grepInvert = [
  ...(REMOTE ? [/@local-only\b/] : []),
  ...(DEV_SERVER ? [/@prod-build\b/] : []),
  // P3: kick-body faults need an APP_ENV=test worker, which runs only against a local database (CI, Docker); a run on
  // the Neon dev branch has an APP_ENV=dev worker that ignores them (fixtures/analysis-worker.ts).
  ...(REMOTE || !workerFaultsHonoured() ? [/@worker-faults\b/] : []),
  ...(LAPSED_READ ? [] : [LAPSED_READ_TAG, ANALYSIS_REDIRECT_TAG]),
  // P4: the real Dodo test-mode checkout runs only in nightly's dodo-hosted job against the dev site (DODO_HOSTED=1).
  ...(process.env.DODO_HOSTED === "1" ? [] : [/@dodo-hosted\b/]),
  // Real-timing copies of the timer specs (*.real.spec.ts) run nightly only (P2 plan 12.6).
  ...(process.env.E2E_SLOW === "1" ? [] : [/@slow\b/]),
  ...(process.env.CI && process.env.E2E_INCLUDE_QUARANTINED !== "1" ? quarantine.map((q) => quarantinePattern(q.testId)) : []),
];

// Queue specs share one matchmaking pool, so they run one at a time in their own
// project until P2's token-based isolation (plan §12.0).
const QUEUE_SPECS = ["**/quick-match.spec.ts", "**/queue-*.spec.ts"];
// Game specs that restart or replace a socket server (e2e/specs/game/serial/**) run alone, after every other project:
// a socket that boots restores every live game of the shared database (fixtures/socket-server.ts). Locally,
// `--project=game-serial --no-deps` runs them without the rest.
// P3: review/serial/** holds the specs that hold the whole e2e worker (`hold_queue`), so they also run alone, last.
// P4: onboarding/serial/** holds the spec whose upstream 429 pauses the worker's Chess.com gate for every caller.
const SERIAL_GAME_SPECS = ["**/game/serial/**/*.spec.ts", "**/review/serial/**/*.spec.ts", "**/onboarding/serial/**/*.spec.ts"];
const PROD_GUARD_SPEC = "**/prod-guard.spec.ts";
const FLAGS_OFF_SPEC = "**/flags-off.spec.ts";

const blankTelemetry = {
  NEXT_PUBLIC_POSTHOG_KEY: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
  SENTRY_DSN: "",
  NEXT_PUBLIC_GA_MEASUREMENT_ID: "",
};

// The web servers Playwright starts are test builds with the sinks on (plan §10.1, §11.6): client events
// go to window.__rcTelemetry, server events to the local PostHog sink (any project key makes posthog-node
// send; POSTHOG_HOST keeps it local), and the fault hooks answer. Real telemetry keys stay blank.
// In CI the NEXT_PUBLIC_* values must also be set for `pnpm build` (ci.yml does); a reused server
// (PW_REUSE_SERVER=1) must have been started with the same values.
// ── Phase 4 (phase-04 plan §12.4, testing X3, X16) ──────────────────────────────────────────────────────────────
// The upstream mock (e2e/mocks/upstream-server.ts) on 4010 (+ offset) stands in for Chess.com, Lichess and Dodo: the
// web reads `/chesscom`, `/lichess`, `/dodo`, the worker `/chesscom-worker`, `/lichess-worker` (so the mock tells the
// web's lookups from the worker's fallback), and the mock posts its signed `subscription.active` webhooks to the web
// app. The onboarding and import flags are on and the paywall is on in every P4 project; the worker honours the
// import fault table (`IMPORT_FAULTS_ALLOWED=1`, refused by a production worker).
/** FLAGS_OVERRIDE with the P4 flags on (unless the env already decides them). */
function withP4Flags(override: string | undefined): string {
  const entries = (override ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  for (const flag of ["onboarding-v3", "import-v3"]) {
    if (!entries.some((e) => e.startsWith(`${flag}:`))) entries.push(`${flag}:on`);
  }
  return entries.join(",");
}

const p4WebEnv = {
  ...upstreamEnv("web"),
  FLAGS_OVERRIDE: withP4Flags(process.env.FLAGS_OVERRIDE),
  BILLING_PAYWALL: "on",
  // Checkout returns land on this server (lib/billing/return-url.ts takes the origin of this URL).
  DODO_PAYMENTS_RETURN_URL: `http://localhost:${WEB_PORT}/pricing?checkout=success`,
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
};

const testServerEnv = {
  ...blankTelemetry,
  ...p4WebEnv,
  NEXT_PUBLIC_DEV_WIDGETS: "0",
  NEXT_PUBLIC_APP_ENV: "test",
  NEXT_PUBLIC_TELEMETRY_SINK: "1",
  ALLOW_TEST_HOOKS: "1",
  POSTHOG_HOST: `http://127.0.0.1:${SINK_PORT}`,
  POSTHOG_PROJECT_KEY: process.env.POSTHOG_PROJECT_KEY || "phc_e2e_local_sink",
};

const upstreamServer = {
  // The upstream mock signs its Dodo webhooks with DODO_PAYMENTS_WEBHOOK_KEY (inherited from this process: .env.test
  // locally, the per-run key in CI) and posts them to the web server under test.
  command: `npx tsx e2e/mocks/upstream-server.ts --port ${UPSTREAM_PORT} --web http://localhost:${WEB_PORT}`,
  url: `http://127.0.0.1:${UPSTREAM_PORT}/__health`,
  reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
  timeout: 15_000,
};

const sinkServer = {
  // Server-side PostHog sink (plan §10.1). The web server reaches it through POSTHOG_HOST.
  command: `npx tsx e2e/mocks/posthog-sink.ts --port ${SINK_PORT}`,
  url: `http://127.0.0.1:${SINK_PORT}/__health`,
  reuseExistingServer: true,
  timeout: 15_000,
};

/**
 * The local socket servers (phase-02 plan 12.6, e2e/fixtures/socket-server.ts): the app's :3002 (real timings,
 * PROTOCOL_V1=on) and the fast fixture server :3102 (TIMING_PROFILE=fast, PROTOCOL_V1=off), both from source with an
 * explicit environment (APP_ENV=test, local origins, the local PostHog sink, the dev or Docker database; never
 * apps/web-socket/.env). The restartable :3103 is spawned by the `restartable` fixture in the game-serial project.
 */
const socketServer = (kind: "main" | "fast", webAppUrl: string) => ({
  command: SOCKET_SERVER_COMMAND,
  url: `http://127.0.0.1:${kind === "main" ? MAIN_SOCKET_PORT : FAST_SOCKET_PORT}/ready`,
  env: socketServerEnv(kind, { webAppUrl, extraOrigins: [`http://localhost:${FLAGS_OFF_PORT}`], sinkPort: SINK_PORT }),
  reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
  timeout: 90_000,
});

/**
 * The e2e analysis worker (phase-03 plan §12.3; e2e/fixtures/analysis-worker.ts): from source on :3003, ENGINE=fake
 * against a local database (CI), the native Stockfish against the Neon dev branch. The web (ANALYSIS_WORKER_URL) and
 * the :3002 socket kick it; it emits analysis:* to :3002.
 */
const workerServer = () => ({
  command: WORKER_SERVER_COMMAND,
  url: `http://127.0.0.1:${WORKER_PORT}/ready`,
  stdout: serverStdout,
  env: {
    ...workerServerEnv({ sinkPort: SINK_PORT }),
    // P4: providers through the mock (the worker's own base), the import fault table, the shared pepper.
    ...upstreamEnv("worker"),
    IMPORT_FAULTS_ALLOWED: "1",
    BILLING_PAYWALL: "on",
    ...(process.env.HASH_PEPPER ? { HASH_PEPPER: process.env.HASH_PEPPER } : {}),
  },
  reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
  timeout: 120_000,
});

/** E2E_SERVER_LOGS=1 prints the web and worker servers' stdout (info logs: kicks, claims) next to the run. */
const serverStdout = process.env.E2E_SERVER_LOGS === "1" ? ("pipe" as const) : ("ignore" as const);

// The upstream mock starts first: the worker drains due import jobs at boot and must find the providers up.
const localServers = (): NonNullable<PlaywrightTestConfig["webServer"]> => [
  upstreamServer,
  {
    command: WEB_BUILD
      ? `pnpm start${WEB_PORT === 3000 ? "" : ` --port ${WEB_PORT}`}`
      : WEB_PORT === 3000
        ? "pnpm dev"
        : `node scripts/build-engine-assets.mjs && pnpm exec next dev --port ${WEB_PORT}`,
    port: WEB_PORT,
    env: testServerEnv,
    stdout: serverStdout,
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: process.env.CI ? 30_000 : 60_000,
  },
  socketServer("main", `http://localhost:${WEB_PORT}`),
  socketServer("fast", `http://localhost:${WEB_PORT}`),
  workerServer(),
  sinkServer,
];

// lapsed-read: the main test build with review-lapsed-read on, on its own port (CI: `pnpm start` of the same build;
// locally a second `next dev` with its own dist dir). It shares the :3002 socket, the worker and the sink.
const lapsedReadServers = (): NonNullable<PlaywrightTestConfig["webServer"]> => [
  upstreamServer,
  {
    command: WEB_BUILD ? `pnpm start --port ${LAPSED_READ_PORT}` : `pnpm exec next dev --port ${LAPSED_READ_PORT}`,
    port: LAPSED_READ_PORT,
    env: {
      ...testServerEnv,
      FLAGS_OVERRIDE: `${withP4Flags(process.env.FLAGS_OVERRIDE)},review-lapsed-read:on,analysis-redirect:on`,
      ...(WEB_BUILD ? {} : { NEXT_DIST_DIR: ".next-lapsed" }),
    },
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: process.env.CI ? 60_000 : 180_000,
  },
  socketServer("main", `http://localhost:${LAPSED_READ_PORT}`),
  workerServer(),
  sinkServer,
];

// flags-off: the same test-build env plus the override, in its own dist dir (a `next dev` and a
// `next build` must not share `.next` with the main server). CI has no build for it, so it builds.
// The upstream mock too: testServerEnv points Dodo's REST API (and the providers) at it, so without it every checkout
// of the flags-off run answered 502 (regression: flags-off-upstream-mock; membership.spec "checkout is created").
const flagsOffServers = (): NonNullable<PlaywrightTestConfig["webServer"]> => [
  upstreamServer,
  {
    command: process.env.CI
      ? `pnpm build && pnpm start --port ${FLAGS_OFF_PORT}`
      : `pnpm exec next dev --port ${FLAGS_OFF_PORT}`,
    port: FLAGS_OFF_PORT,
    env: {
      ...testServerEnv,
      FLAGS_OVERRIDE: FLAGS_OFF_OVERRIDE,
      NEXT_DIST_DIR: ".next-flagsoff",
    },
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: process.env.CI ? 600_000 : 120_000,
  },
  socketServer("main", `http://localhost:${FLAGS_OFF_PORT}`),
  sinkServer,
];

const prodGuardServer: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: `pnpm build && pnpm start --port ${PROD_GUARD_PORT}`,
    port: PROD_GUARD_PORT,
    env: { ...prodGuardEnv(), ...blankTelemetry, NEXT_DIST_DIR: ".next-prodcheck" },
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 600_000,
  },
];

export default defineConfig<ConsoleGuardOptions & TelemetryOptions>({
  testDir: "./e2e/specs",
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["html"], ["json", { outputFile: "test-results/results.json" }], ["list"]] : "list",
  use: {
    baseURL: PROD_GUARD
      ? `http://localhost:${PROD_GUARD_PORT}`
      : FLAGS_OFF
        ? `http://localhost:${FLAGS_OFF_PORT}`
        : LAPSED_READ
          ? `http://localhost:${LAPSED_READ_PORT}`
          : (BASE_URL ?? `http://localhost:${WEB_PORT}`),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    extraHTTPHeaders: BYPASS
      ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
    // Console guard (CT X7): legacy specs in e2e/console-baseline.json only report.
    consoleGuard: (process.env.E2E_CONSOLE_GUARD as ConsoleGuardOptions["consoleGuard"] | undefined) ?? "enforce",
    allowConsole: [],
    // Telemetry fixture (CT X6): server events come from the local sink only.
    telemetrySinkUrl: REMOTE || PROD_GUARD ? null : `http://127.0.0.1:${SINK_PORT}`,
    telemetryCheck: true,
  },
  globalSetup: PROD_GUARD ? undefined : "./e2e/global-setup.ts",
  grep: grepFor(),
  grepInvert: grepInvert.length ? grepInvert : undefined,
  projects: PROD_GUARD
    ? [{ name: "prod-guard", testMatch: PROD_GUARD_SPEC, use: { ...devices["Desktop Chrome"] } }]
    : FLAGS_OFF
      ? [{ name: "flags-off", testMatch: FLAGS_OFF_SPECS, use: { ...devices["Desktop Chrome"] } }]
      : LAPSED_READ
        ? [
            {
              name: "lapsed-read",
              testMatch: ["**/review/serial/review-lapsed.spec.ts", "**/review/analysis-redirects.spec.ts"],
              grep: FLAG_SERVER_TAGS,
              use: { ...devices["Desktop Chrome"] },
            },
          ]
        : [
          {
            name: "chromium",
            testIgnore: [...QUEUE_SPECS, ...SERIAL_GAME_SPECS, PROD_GUARD_SPEC, FLAGS_OFF_SPEC],
            use: { ...devices["Desktop Chrome"] },
          },
          {
            name: "play-queue",
            testMatch: QUEUE_SPECS,
            workers: 1,
            use: { ...devices["Desktop Chrome"] },
          },
          // The ci.yml e2e-smoke job runs `--project=chromium --project=webkit-iphone --project=game-serial` with E2E_SMOKE=1.
          // Only in CI (or E2E_WEBKIT=1), so a plain local run stays chromium-only.
          ...(process.env.CI || process.env.E2E_WEBKIT === "1"
            ? [
                {
                  name: "webkit-iphone",
                  testIgnore: [...QUEUE_SPECS, ...SERIAL_GAME_SPECS, PROD_GUARD_SPEC, FLAGS_OFF_SPEC],
                  grep: grepFor(["@smoke\\b"]),
                  grepInvert: grepInvert.length ? grepInvert : undefined,
                  use: { ...devices["iPhone 15"] },
                },
              ]
            : []),
          {
            name: "game-serial",
            testMatch: SERIAL_GAME_SPECS,
            workers: 1,
            fullyParallel: false,
            dependencies: [
              "chromium",
              "play-queue",
              ...(process.env.CI || process.env.E2E_WEBKIT === "1" ? ["webkit-iphone"] : []),
            ],
            use: { ...devices["Desktop Chrome"] },
          },
        ],
  webServer: PROD_GUARD
    ? prodGuardServer
    : BASE_URL
      ? undefined
      : FLAGS_OFF
        ? flagsOffServers()
        : LAPSED_READ
          ? lapsedReadServers()
          : localServers(),
});
