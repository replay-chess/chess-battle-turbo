import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import type { ConsoleGuardOptions } from "./e2e/fixtures/console-guard";
import type { TelemetryOptions } from "./e2e/fixtures/telemetry";
import { prodGuardEnv } from "./lib/test-hooks/registry";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

// Load .env.test FIRST with override so E2E tests always use the dev/E2E database,
// never prod — even if a dev server is already running or .env.local is present.
config({ path: path.resolve(WEB_DIR, ".env.test"), override: true });

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
const SINK_PORT = Number(process.env.POSTHOG_SINK_PORT ?? 4011);
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

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
// Every condition must hold, so they compose as lookaheads.
const conditions: string[] = [];
if (process.env.E2E_PUBLIC_ONLY === "1") conditions.push("@public\\b");
if (process.env.E2E_PHASES) {
  const phases = process.env.E2E_PHASES.split(",").map((p) => p.trim().replace(/^p/i, "")).filter(Boolean);
  conditions.push(`@p(${phases.map(escapeRe).join("|")})\\b`);
}
const grepFor = (extra: string[] = []) => {
  const all = [...conditions, ...extra];
  return all.length ? new RegExp(`^${all.map((c) => `(?=.*${c})`).join("")}`) : undefined;
};
const grepInvert = [
  ...(REMOTE ? [/@local-only\b/] : []),
  ...(process.env.CI && process.env.E2E_INCLUDE_QUARANTINED !== "1" ? quarantine.map((q) => quarantinePattern(q.testId)) : []),
];

// Queue specs share one matchmaking pool, so they run one at a time in their own
// project until P2's token-based isolation (plan §12.0).
const QUEUE_SPECS = ["**/quick-match.spec.ts", "**/queue-*.spec.ts"];
const PROD_GUARD_SPEC = "**/prod-guard.spec.ts";

const blankTelemetry = {
  NEXT_PUBLIC_POSTHOG_KEY: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
  SENTRY_DSN: "",
  NEXT_PUBLIC_GA_MEASUREMENT_ID: "",
};

const localServers: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    port: 3000,
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: process.env.CI ? 30_000 : 60_000,
  },
  {
    command: "pnpm --filter web-socket dev",
    port: 3002,
    // apps/web-socket/.env holds production values; the local socket server
    // must call back into and accept connections from the local web app.
    env: {
      WEB_APP_URL: "http://localhost:3000",
      ALLOWED_ORIGINS: "http://localhost:3000",
    },
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 30_000,
  },
  {
    // Server-side PostHog sink (plan §10.1). The web server reaches it when it
    // runs with POSTHOG_HOST=http://127.0.0.1:4011 (CI); otherwise it idles.
    command: `npx tsx e2e/mocks/posthog-sink.ts --port ${SINK_PORT}`,
    url: `http://127.0.0.1:${SINK_PORT}/__health`,
    reuseExistingServer: true,
    timeout: 15_000,
  },
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
    baseURL: PROD_GUARD ? `http://localhost:${PROD_GUARD_PORT}` : (BASE_URL ?? "http://localhost:3000"),
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
    : [
        {
          name: "chromium",
          testIgnore: [...QUEUE_SPECS, PROD_GUARD_SPEC],
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "play-queue",
          testMatch: QUEUE_SPECS,
          workers: 1,
          use: { ...devices["Desktop Chrome"] },
        },
        // The ci.yml e2e-smoke job runs `--project=chromium --project=webkit-iphone --grep @smoke`.
        // Only in CI (or E2E_WEBKIT=1), so a plain local run stays chromium-only.
        ...(process.env.CI || process.env.E2E_WEBKIT === "1"
          ? [
              {
                name: "webkit-iphone",
                testIgnore: [...QUEUE_SPECS, PROD_GUARD_SPEC],
                grep: grepFor(["@smoke\\b"]),
                grepInvert: grepInvert.length ? grepInvert : undefined,
                use: { ...devices["iPhone 15"] },
              },
            ]
          : []),
      ],
  webServer: PROD_GUARD ? prodGuardServer : BASE_URL ? undefined : localServers,
});
