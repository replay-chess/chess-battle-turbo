// The open phase's flags off (phase-01 plan §12.3, CT X13; 1Q·2). @p1
//
// Runs only in the `flags-off` project (playwright.config.ts): its own web server with
// FLAGS_OVERRIDE=shell-v3:off (honoured because the server also has NEXT_PUBLIC_APP_ENV=test and
// ALLOW_TEST_HOOKS=1). The same project reruns the Phase 0 specs, so turning the flag off in
// production is proven to give back today's site.
//
//   cd apps/web && set -a && source .env.test && set +a && npx playwright test --project=flags-off
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { test as reviewTest } from "./review/_lib/review";
import { test as p4Test } from "./onboarding/_lib/p04";

async function expectMarketingChrome(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(res?.status(), `${path} status`).toBe(200);
  await expect(page.getByTestId("marketing-navbar")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-rc-nav]")).toHaveCount(0);
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
}

test.describe("shell-v3 off @p1", () => {
  test("a member keeps the marketing Navbar on /play and /legends", async ({ authedPage: page }) => {
    await expectMarketingChrome(page, "/play");
    // The page itself still works: the mode cards and Start Game are there.
    await expect(page.getByTestId("start-game-button")).toBeVisible();
    await expectMarketingChrome(page, "/legends");
  });
});

// Phase 3 (plan §12.5 "Legacy"): with `review-v3` off the P3 screens are not served and the legacy /analysis page
// still serves the game's player until the H3 cut-over.
reviewTest.describe("review-v3 off @p3", () => {
  reviewTest("/review/<ref> sends the player to the legacy /analysis/<ref>, which loads the game; /games is not served", async ({ member, page, seeded }) => {
    reviewTest.setTimeout(180_000);
    await member("A");
    const legacyData = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/analysis/${seeded.GAME}`, { timeout: 120_000 });
    await page.goto(`/review/${seeded.GAME}`, { timeout: 180_000 });
    await expect(page).toHaveURL(new RegExp(`/analysis/${seeded.GAME}$`), { timeout: 60_000 });
    expect((await legacyData).status()).toBe(200);
    const games = await page.request.get("/games", { maxRedirects: 0 });
    expect(games.status()).toBe(404);
  });
});

p4Test.describe("onboarding-v3 and import-v3 off @p4", () => {
  // The persona is shared with the onboarding specs (CT X4 lease rule, plan §12.4): serial here as there.
  p4Test.describe.configure({ mode: "serial" });
  // Until the 12.6 parity check deletes it, the legacy onboarding is what a not-yet-onboarded member gets with the
  // P4 flags off (plan §7.10, §12.4 "Flags-off regression"): the legacy page on /onboarding, no v3 step route, no
  // import routes.
  p4Test("a fresh member gets the legacy onboarding; the v3 steps and the import routes are not served", async ({ page, leasePersona }) => {
    p4Test.setTimeout(180_000);
    await leasePersona("onboarding-fresh");
    const res = await page.goto("/onboarding", { waitUntil: "domcontentloaded", timeout: 120_000 });
    expect(res?.status()).toBe(200);
    // With the paywall on the legacy flow opens on its plan step (then the Chess.com step).
    await expect(page.getByTestId("onboarding-plan-step")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to ReplayChess");
    await expect(page.getByTestId("onboarding-frame")).toHaveCount(0);
    expect((await page.request.get("/onboarding/welcome", { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get("/api/accounts")).status()).toBe(404);
  });
});

// Phase 5 (plan §7.9, §12.4 "Regression of earlier phases"): with `train`, `home` and `bank-remove` off the Train pages
// are not served and /home sends a member back to /play (the §13.4 rollback), so the P1–P4 site is what members get.
// The P5 JSON routes stay up (flags never gate authorisation, lib/flags/registry/p05.ts); only the pages go dark.
test.describe("train and home off @p5", () => {
  test("/train/** answers 404, /home goes back to /play, the signed-in / stays on the marketing page", async ({ authedPage: page }) => {
    test.setTimeout(180_000);
    for (const path of ["/train", "/train/bank", "/train/bank/session", "/train/puzzles"]) {
      expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
    const home = await page.request.get("/home", { maxRedirects: 0 });
    expect([307, 308], "/home redirects").toContain(home.status());
    expect(new URL(home.headers()["location"] ?? "", page.url()).pathname).toBe("/play");
    await page.goto("/home", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await expect(page).toHaveURL(/\/play$/, { timeout: 60_000 });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await expect(page).not.toHaveURL(/\/home$/);
  });
});
