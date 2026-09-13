import { test, expect } from "@playwright/test";

/**
 * Pricing page and paywall UI. These run signed out, never reach Dodo, and
 * pass whether BILLING_PAYWALL is on or off: the plan picker and the
 * "required to play" banner are driven by the page itself, not the gate.
 */
test.describe("Pricing", () => {
  test("preselects the yearly plan at $50", async ({ page }) => {
    await page.goto("/pricing");
    const amount = page.getByTestId("pricing-amount");
    await expect(amount).toBeVisible({ timeout: 30_000 });
    await expect(amount).toContainText("$50");
    await expect(amount).not.toContainText("$4.99");
  });

  test("switches to the monthly plan at $4.99", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByTestId("pricing-amount")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("billing-option-monthly").click();
    const amount = page.getByTestId("pricing-amount");
    await expect(amount).toContainText("$4.99");
    await expect(amount).not.toContainText("$50");

    await page.getByTestId("billing-option-yearly").click();
    await expect(amount).toContainText("$50");
  });

  test("asks signed-out visitors to sign in before subscribing", async ({ page }) => {
    await page.goto("/pricing");
    const subscribe = page.getByTestId("pricing-subscribe");
    await expect(subscribe).toBeVisible({ timeout: 30_000 });
    await expect(subscribe).toHaveText(/sign in to subscribe/i);
  });

  test("explains the paywall when sent here with ?reason=required", async ({ page }) => {
    await page.goto("/pricing?reason=required");
    await expect(page.getByText(/required to play/i).first()).toBeVisible({
      timeout: 30_000,
    });
    // The picker still works from the paywall landing.
    await expect(page.getByTestId("pricing-amount")).toContainText("$50");
  });
});
