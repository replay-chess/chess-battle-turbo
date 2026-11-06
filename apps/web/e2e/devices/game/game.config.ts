/**
 * Runs ONLY the P2 game device suites (e2e/devices/game/**) on P1's device × zoom matrix (playwright.devices.config.ts:
 * same projects, server, baselines and tiers). P1's config itself also matches game/** (REGRESSION-2), so
 * `pnpm test:devices`, nightly devices-full and update-snapshots include them; this config is the PR job's shortcut:
 *
 *   DEVICES_TIER=pr npx playwright test -c e2e/devices/game/game.config.ts
 *   npx playwright test -c e2e/devices/game/game.config.ts --grep @visual      (official image only)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Project } from "@playwright/test";
import base from "../../../playwright.devices.config";

const DEVICES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.resolve(DEVICES_DIR, "../..");

const layout = (base.projects ?? []).filter((p: Project) => p.name?.includes("@"));

export default defineConfig({
  ...base,
  testDir: DEVICES_DIR,
  projects: layout.map((p: Project) => ({ ...p, testMatch: "game/**/*.spec.ts" })),
  webServer: base.webServer && !Array.isArray(base.webServer) ? { ...base.webServer, cwd: WEB_DIR } : base.webServer,
});
