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
import { defineConfig, type PlaywrightTestConfig, type Project } from "@playwright/test";
import base from "../../../playwright.devices.config";

const DEVICES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.resolve(DEVICES_DIR, "../..");

const layout = (base.projects ?? []).filter((p: Project) => p.name?.includes("@"));

// Playwright runs a webServer command in the directory of the config that declares it, which is this one: every server
// of the base config runs from apps/web, as it does there. P5 made the base's webServer a list (the next server and the
// puzzle shard server); the single-object form was the only one handled here, so the shard server's relative
// `e2e/mocks/puzzle-shards.ts` resolved under e2e/devices/game and the job failed to start (CI 43599091643,
// devices-game: ERR_MODULE_NOT_FOUND …/e2e/devices/game/e2e/mocks/puzzle-shards.ts; regression: devices-game-shard-cwd).
type WebServer = NonNullable<PlaywrightTestConfig["webServer"]>;
export function fromWebDir(servers: PlaywrightTestConfig["webServer"]): PlaywrightTestConfig["webServer"] {
  if (!servers) return servers;
  const one = (s: Extract<WebServer, { command: string }>) => ({ ...s, cwd: s.cwd ?? WEB_DIR });
  return Array.isArray(servers) ? servers.map(one) : one(servers as Extract<WebServer, { command: string }>);
}

export default defineConfig({
  ...base,
  testDir: DEVICES_DIR,
  projects: layout.map((p: Project) => ({ ...p, testMatch: "game/**/*.spec.ts" })),
  webServer: fromWebDir(base.webServer),
});
