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
