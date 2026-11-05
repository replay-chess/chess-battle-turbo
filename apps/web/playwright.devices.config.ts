/**
 * Device x zoom suites (SPEC D7, 5.2; 04 §8.3).
 *
 *   40 layout projects  `<device>@<zoom%>`   testMatch layout/**
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
 */
import { defineConfig, type Project } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { BASE_DEVICES, MOTION_PROJECTS, UI_PROJECTS, ZOOMS, baseDevice, projectName, zoomed } from "./e2e/devices/matrix";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".env.test"), override: true });

const layoutProjects: Project[] = BASE_DEVICES.flatMap((d) =>
  ZOOMS.map((z) => ({ name: projectName(d, z), testMatch: "layout/**/*.spec.ts", ...zoomed(d, z) })),
);

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
  expect: { timeout: 10_000 },
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
    : {
        command: "pnpm build && pnpm start --port 3100",
        port: 3100,
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
        },
      },
});
