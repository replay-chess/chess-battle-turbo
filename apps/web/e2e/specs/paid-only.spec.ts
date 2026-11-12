import { test, expect } from "@playwright/test";

/**
 * Phase 0 regression: ReplayChess is paid-only. There is no guest demo, no
 * free tier, and every member API refuses signed-out callers.
 */
test.describe("Paid-only product @public", () => {
  test("the old guest demo redirects to pricing", async ({ page }) => {
    for (const path of ["/try", "/try/some-position", "/try/game/abc", "/try/analysis/abc"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page, path).toHaveURL(/\/pricing$/);
    }
  });

  test("the demo-game API is gone", async ({ request }) => {
    const res = await request.post("/api/chess/create-demo-game", { data: {} });
    expect(res.status()).toBe(404);
  });

  test("landing page sells the trial, not a free sample", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/start (7-day )?free trial/i).first()).toBeVisible({ timeout: 30_000 });
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/no sign-?up/i);
    expect(body).not.toMatch(/try free\b/i);
    await expect(page.locator('a[href="/try"], a[href^="/try/"]')).toHaveCount(0);
  });

  test("footer links to the free trial", async ({ page }) => {
    await page.goto("/");
    const footerTrial = page.locator("footer").getByRole("link", { name: "Free Trial" });
    await expect(footerTrial).toHaveAttribute("href", "/pricing");
  });

  test("sitemap no longer lists /try", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).not.toContain("/try");
  });

  test("member APIs refuse signed-out callers", async ({ request }) => {
    const analysis = await request.get("/api/analysis/does-not-exist");
    expect([401, 403]).toContain(analysis.status());
    // P3 (phase-03 plan §12.5): the review API is the paywalled read now; the legacy route above goes at H4.
    const review = await request.get("/api/review/cnotarealgameref00000000aa");
    expect(review.status()).toBe(401);
    const games = await request.get("/api/me/games");
    expect(games.status()).toBe(401);
    const checkout = await request.post("/api/checkout", { data: { plan: "monthly" } });
    expect([401, 403]).toContain(checkout.status());
  });

  test("privacy page lists the real processors", async ({ page }) => {
    await page.goto("/privacy");
    const body = await page.locator("body").innerText();
    for (const name of ["Dodo Payments", "PostHog", "Sentry", "Clerk"]) expect(body).toContain(name);
    expect(body).not.toContain("Stripe");
  });
});
