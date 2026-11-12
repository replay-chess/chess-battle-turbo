// Review routing before the cut-over (phase-03 plan §12.3 `analysis-redirects.spec.ts`, §3.1, P3-D30; owner test T16).
// Stage A (this file): `/review` (the nav item's old target) redirects to `/games` (307 outside production), and the
// legacy `/analysis/<ref>` still serves the game's player until the H3 switch, while every review link the P3 screens
// render points at `/review/<ref>` (or `/review/<ref>/legend`) with review-v3 on.
// H3 (stage B, after the parity check) turns the flag `analysis-redirect` on: `/analysis/<ref>` → 308 `/review/<ref>`,
// a legend game → `/review/<ref>/legend`, an unknown ref → `/games`, `/api/analysis/<ref>` → `/api/review/<ref>`. Those
// assertions are the `@analysis-redirect-on` block below; they run on the flag-on server (`--project=lapsed-read`,
// playwright.config.ts), and the stage-A block runs on the main server where the flag is off.
import { DEVICES, expect, gotoOk, test } from "./_lib/review";

test.describe("review routing (stage A)", { tag: ["@p3"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test("/review → /games (307 outside production)", async ({ member, page }) => {
    test.setTimeout(180_000);
    await member("A");
    const res = await page.request.get("/review", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers().location!, "http://localhost").pathname).toBe("/games");
    await gotoOk(page, "/review");
    await expect(page).toHaveURL(/\/games$/);
  });

  test("the legacy /analysis/<ref> still serves its player until H3", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("A");
    const res = await page.goto(`/analysis/${seeded.GAME}`, { timeout: 180_000 });
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/analysis/${seeded.GAME}$`));
  });

  test("the P3 screens link reviews to /review, never /analysis", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("A");
    await gotoOk(page, `/games?sel=${seeded.LEGEND}`);
    await expect(page.getByTestId("games-aside")).toHaveAttribute("data-ref", seeded.LEGEND, { timeout: 60_000 });
    await expect(page.getByTestId("games-open-review")).toHaveAttribute("href", `/review/${seeded.LEGEND}?from=archive`);
    await expect(page.getByTestId("games-open-compare")).toHaveAttribute("href", `/review/${seeded.LEGEND}/legend`);
    expect(await page.locator('a[href^="/analysis"]').count()).toBe(0);
  });
});

// regression: h3-redirect-code (FIX-1): the R1 redirect was not written in stage A.
test.describe("review routing after the H3 switch (analysis-redirect on)", { tag: ["@p3", "@analysis-redirect-on"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test("/analysis/<ref> → 308 /review/<ref>; a legend game → /review/<ref>/legend; unknown → /games", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("A");
    const target = async (path: string) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(308);
      return new URL(res.headers().location!, "http://localhost").pathname;
    };
    expect(await target(`/analysis/${seeded.GAME}`)).toBe(`/review/${seeded.GAME}`);
    expect(await target(`/analysis/${seeded.LEGEND}`)).toBe(`/review/${seeded.LEGEND}/legend`);
    expect(await target("/analysis/cnosuchgame000000000000000")).toBe("/games");
    expect(await target(`/api/analysis/${seeded.GAME}`)).toBe(`/api/review/${seeded.GAME}`);
    await gotoOk(page, `/analysis/${seeded.GAME}`);
    await expect(page).toHaveURL(new RegExp(`/review/${seeded.GAME}$`));
    await expect(page.getByTestId("review-screen")).toBeVisible({ timeout: 60_000 });
  });

  // regression: legacy-redirect-reveals-games (FIX-2, review round 2): any signed-in user could tell from the Location
  // header that a game existed, and that it was a legend game, for games they did not play.
  test("a game the viewer did not play redirects like an unknown ref: /games, legend or not", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("B");
    for (const ref of [seeded.GAME, seeded.LEGEND]) {
      const res = await page.request.get(`/analysis/${ref}`, { maxRedirects: 0 });
      expect(res.status(), ref).toBe(308);
      expect(new URL(res.headers().location!, "http://localhost").pathname, ref).toBe("/games");
    }
  });
});
