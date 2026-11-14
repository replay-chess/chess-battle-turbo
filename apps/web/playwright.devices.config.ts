/**
 * Device x zoom suites (SPEC D7, 5.2; 04 §8.3).
 *
 *   40 layout projects  `<device>@<zoom%>`   testMatch layout/** and game/** (P2's game one-viewport + visual)
 *    4 UI projects      ui-desktop, ui-iphone, ui-android, ui-ipad   testMatch ui/**
 *    2 motion projects  ui-desktop-motion, ui-iphone-motion          testMatch ui/overlays.spec.ts
 *
 * Caveats (F §5):
 * - WebKit's fractional DSF and its pointer/hover media are taken from the P0
 *   probe (layout/probe.spec.ts → SP/phase1/probe.json), not assumed.
 * - The Safari dynamic toolbar is approximated by `iphone-safari` at 393x659.
 * - Headless scrollbars are overlay scrollbars.
 * - Safe-area insets are emulated only by the layout fixture in helpers.ts.
 *
 * Without DEVICES_BASE_URL a production build runs on port 3100 with its own
 * dist dir. The blank telemetry keys stop test traffic from reaching the keys in
 * .env.local; .env.test (loaded with override) points at the dev database.
 *
 * Tiers (plan §12.4): DEVICES_TIER=pr keeps 4 layout projects (desktop-1440@100,
 * desktop-1280@125, iphone@100, ipad-portrait@100) plus the UI and motion
 * projects; unset runs the whole matrix (nightly).
 *
 * Real-route layer (1Q·2): layout/routes.real.ts runs on desktop-1440@100/150,
 * iphone@100/125 and ipad-portrait@100, signed in as member A. P5 (phase-05 plan §12.4): layout/train.spec.ts and
 * layout/home.spec.ts (globbed by layout/**) add their real routes on the same projects as a leased `bank-member`;
 * the puzzle session reads the committed shard subset from the CI shard server (e2e/mocks/puzzle-shards.ts, started
 * below with the build; a reused DEVICES_BASE_URL server must already point PUZZLE_SHARD_BASE_URL at one).
 * P5's tier rows: the PR tier runs train/home (and the CLS ≤ 0.02 runner gate) on the 4 PR projects; nightly runs
 * them on all 40; the move → verdict throttle check runs on desktop-1440@100 only; p05.visual.spec.ts on the plan's
 * 8 visual projects (full tier, official image).
 *
 * Visual baselines (1Q·2, plan §12.4): ui/visual.spec.ts (@visual) compares
 * screenshots with e2e/__screenshots__/<project>/<spec>/<name>.png. Baselines
 * are made and checked only in the official image
 * mcr.microsoft.com/playwright:v<@playwright/test version>-noble (fonts and
 * rasterisation must match); elsewhere the spec skips. Regenerate with the
 * `update-snapshots` PR label (.github/workflows/update-snapshots.yml) or
 * locally through Docker (see the spec header).
 */
import { defineConfig, type Project } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { BASE_DEVICES, MOTION_PROJECTS, UI_PROJECTS, ZOOMS, baseDevice, projectName, zoomed } from "./e2e/devices/matrix";
import { PUZZLE_SHARDS_PORT, puzzleShardEnv } from "./e2e/mocks/puzzle-shards-client";

// E2E_ENV_FILE: another env file (outside the repo), as in playwright.config.ts.
loadEnv({ path: process.env.E2E_ENV_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".env.test"), override: true });

const PR_TIER = new Set(["desktop-1440@100", "desktop-1280@125", "iphone@100", "ipad-portrait@100"]);
const tier = process.env.DEVICES_TIER === "pr" ? "pr" : "full";
/** Mirrors REAL_ROUTE_PROJECTS in e2e/devices/layout/routes.real.ts. */
const REAL_ROUTE_PROJECTS = new Set(["desktop-1440@100", "desktop-1440@150", "iphone@100", "iphone@125", "ipad-portrait@100"]);

const layoutProjects: Project[] = BASE_DEVICES.flatMap((d) =>
  ZOOMS.map((z) => {
    const name = projectName(d, z);
    // game/**: the P2 game suites (one-viewport, visual) run on the same projects, so `test:devices`, the nightly
    // devices-full shards and the update-snapshots workflow pick them up (REGRESSION-2; was a WP-I request to P1).
    const testMatch = REAL_ROUTE_PROJECTS.has(name)
      ? ["layout/**/*.spec.ts", "game/**/*.spec.ts", "layout/routes.real.ts"]
      : ["layout/**/*.spec.ts", "game/**/*.spec.ts"];
    return { name, testMatch, ...zoomed(d, z) };
  }),
).filter((p) => tier === "full" || PR_TIER.has(p.name!));

const uiProjects: Project[] = UI_PROJECTS.map(({ name, device }) => ({
  name,
  testMatch: "ui/**/*.spec.ts",
  ...zoomed(baseDevice(device), 1),
}));

const motionProjects: Project[] = MOTION_PROJECTS.map(({ name, device }) => {
  const z = zoomed(baseDevice(device), 1);
  return { name, testMatch: "ui/overlays.spec.ts", use: { ...z.use, contextOptions: { reducedMotion: "no-preference" } }, metadata: z.metadata };
});

export default defineConfig({
  testDir: "./e2e/devices",
  fullyParallel: true,
  workers: process.env.CI ? 4 : "50%",
  // A shared `next dev` (DEVICES_BASE_URL) recompiles under load and times out a cold `page.goto` now and then
  // (GATE-B, P1, P2 hand-backs); retry once there. Production builds (the default) get no retries.
  retries: process.env.DEVICES_BASE_URL ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    // Visual baselines (plan §12.4): 0.2 % of pixels may differ; CSS-pixel scale keeps the files small.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", scale: "css" },
  },
  snapshotPathTemplate: "{testDir}/../__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  // CI never writes a missing baseline (the update-snapshots workflow passes --update-snapshots itself).
  updateSnapshots: process.env.CI ? "none" : "missing",
  reporter: process.env.CI ? [["html", { open: "never", outputFolder: "playwright-report-devices" }], ["list"]] : "list",
  use: {
    baseURL: process.env.DEVICES_BASE_URL ?? "http://localhost:3100",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [...layoutProjects, ...uiProjects, ...motionProjects],
  webServer: process.env.DEVICES_BASE_URL
    ? undefined
    : [
        {
          command: "pnpm build && pnpm start --port 3100",
          port: 3100,
          // next build and next start write to stdout; Playwright drops a webServer's stdout unless asked.
          stdout: "pipe",
          timeout: 600_000,
          reuseExistingServer: !process.env.CI,
          env: {
            NEXT_DIST_DIR: ".next-devices",
            NEXT_PUBLIC_DEV_WIDGETS: "0",
            NEXT_PUBLIC_APP_ENV: "test",
            NEXT_PUBLIC_POSTHOG_KEY: "",
            NEXT_PUBLIC_SENTRY_DSN: "",
            SENTRY_DSN: "",
            NEXT_PUBLIC_GA_MEASUREMENT_ID: "",
            // P5: the real-route puzzle session reads the committed shard subset, never R2.
            ...puzzleShardEnv(),
          },
        },
        {
          command: `npx tsx e2e/mocks/puzzle-shards.ts --port ${PUZZLE_SHARDS_PORT}`,
          url: `http://127.0.0.1:${PUZZLE_SHARDS_PORT}/__health`,
          reuseExistingServer: true,
          timeout: 15_000,
        },
      ],
});
