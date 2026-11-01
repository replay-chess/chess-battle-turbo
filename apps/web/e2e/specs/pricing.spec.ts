import { test, expect } from "@playwright/test";

/**
 * Pricing page and paywall UI. These run signed out and never reach Dodo.
 * The offer is paid-only with a 7-day free trial (card required, first
 * charge on day 8), so every CTA must say so.
 */
test.describe("Pricing @public", () => {
  test("preselects the yearly plan at $50", async ({ page }) => {
    await page.goto("/pricing");
    const amount = page.getByTestId("pricing-amount");
    await expect(amount).toBeVisible({ timeout: 30_000 });
    await expect(amount).toContainText("$50");
    await expect(amount).not.toContainText("$4.99");
  });

  test("switches to the monthly plan at $4.99 and the trial line follows", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByTestId("pricing-amount")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("billing-option-monthly").click();
    await expect(page.getByTestId("pricing-amount")).toContainText("$4.99");
    await expect(page.getByTestId("pricing-trial-terms")).toContainText("Then $4.99/month.");

    await page.getByTestId("billing-option-yearly").click();
    await expect(page.getByTestId("pricing-amount")).toContainText("$50");
    await expect(page.getByTestId("pricing-trial-terms")).toContainText("Then $50/year.");
  });

  test("offers the 7-day free trial to signed-out visitors", async ({ page }) => {
    await page.goto("/pricing");
    const subscribe = page.getByTestId("pricing-subscribe");
    await expect(subscribe).toBeVisible({ timeout: 30_000 });
    await expect(subscribe).toHaveText(/start your 7-day free trial/i);
    await expect(page.getByTestId("pricing-trial-terms")).toHaveText(
      /^Then \$\d+(\.\d+)?\/(month|year)\. Cancel before \d{1,2} [A-Z][a-z]{2} and you won't be charged\.$/,
    );
  });

  test("names the plan Coaching, not Player", async ({ page }) => {
    await page.goto("/pricing");
    const card = page.getByTestId("pricing-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(/coaching/i);
    await expect(card).not.toContainText(/\bplayer\b/i);
  });

  test("explains the paywall when sent here with ?reason=required", async ({ page }) => {
    await page.goto("/pricing?reason=required");
    await expect(page.getByText(/start your 7-day free trial to use this/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("pricing-amount")).toContainText("$50");
  });

  test("FAQ says there is a trial and no free version", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Is there a free trial?")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Is there a free version?")).toBeVisible();
  });
});
