import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Load .env.test FIRST with override so E2E tests always use the perf database,
// never prod — even if a dev server is already running or .env.local is present.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".env.test"), override: true });

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: process.env.CI ? "pnpm start" : "pnpm dev",
      port: 3000,
      reuseExistingServer: false,
      timeout: process.env.CI ? 30_000 : 60_000,
    },
    {
      command: "pnpm --filter web-socket dev",
      port: 3002,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
