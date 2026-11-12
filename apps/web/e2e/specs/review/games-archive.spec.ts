// My games on real data (phase-03 plan §12.3 `games-archive.spec.ts`; owner test T12) on desktop-1440@100,
// ipad-portrait@100 and iphone@100, member A (40+ seeded games; members only gain data, so no absolute counts):
// page 1, then the sentinel loads page 2 (its meta has no counts, AP-38); ↑/↓ move aria-activedescendant and Enter opens
// the review; Filter → Losses + Rapid → the live "Show N Games" → apply → `?result=loss&tc=rapid`; Clear All; search
// "tal"; Compare only on a legend game's aside; the phone filter is a bottom sheet and a tap opens the review; the
// leased `review-empty` persona sees `empty`.
import type { Page } from "@playwright/test";
import { DEVICES, expect, gotoOk, test, type DeviceName } from "./_lib/review";

const isPhone = (d: DeviceName) => d === "iphone";
/** The archive boards draw one screen (V3GamesArchive, …Empty, …Filters); a reached state is reached on all three. */
export const ARCHIVE_BOARDS = ["V3GamesArchive", "V3GamesArchiveEmpty", "V3GamesArchiveFilters"] as const;

async function openArchive(page: Page) {
  await gotoOk(page, "/games");
  // While the page streams, the route's loading UI (data-state="loading") and the page share the test id.
  await expect(page.locator('[data-testid="games-archive"][data-state="default"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("games-row").first()).toBeVisible();
}

for (const device of ["desktop-1440", "ipad-portrait", "iphone"] as const) {
  test.describe(`games archive · ${device}@100`, { tag: ["@p3"] }, () => {
    test.use(DEVICES[device]);

    test("page 1, page 2 without counts, then open a game", { tag: [...ARCHIVE_BOARDS.map((b) => `@state:${b}.default`), "@state:V3Nav.review"] }, async ({ member, page, telemetry }) => {
      test.setTimeout(240_000);
      await member("A");
      const pages: URL[] = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.pathname === "/api/me/games") pages.push(u);
      });
      await openArchive(page);
      // The shell's Review destination (review-v3 on) is current on /games: the side nav, or the tab bar on phones.
      const review = page.locator('[data-rc-nav] a[href="/games"]:visible, [data-rc-tabbar] a[href="/games"]:visible').first();
      await expect(review).toHaveAttribute("aria-current", "page");
      await expect(review).toContainText("Review");
      await telemetry.expect("games_archive_viewed", { filters_active: 0 }, { source: "client" });
      const list = page.getByTestId("games-list");
      const page2 = page.waitForResponse((r) => r.url().includes("/api/me/games") && r.url().includes("cursor="), { timeout: 60_000 });
      await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
      const body = (await (await page2).json()) as { meta: Record<string, unknown> };
      expect(body.meta.filteredTotal).toBeUndefined();
      expect(body.meta.counts).toBeUndefined();
      expect(pages.some((u) => u.searchParams.has("cursor"))).toBe(true);

      if (isPhone(device)) {
        await list.evaluate((el) => (el.scrollTop = 0));
        await page.getByTestId("games-row").first().click();
        await expect(page).toHaveURL(/\/review\/c[a-z0-9]+\?from=archive$/, { timeout: 60_000 });
        await telemetry.expect("games_archive_game_opened", { target: "review" }, { source: "client" });
        return;
      }
      await list.evaluate((el) => (el.scrollTop = 0));
      await list.focus();
      await page.keyboard.press("Home");
      const first = await list.getAttribute("aria-activedescendant");
      expect(first).toBeTruthy();
      await page.keyboard.press("ArrowDown");
      await expect(list).not.toHaveAttribute("aria-activedescendant", first!);
      await page.keyboard.press("ArrowUp");
      await expect(list).toHaveAttribute("aria-activedescendant", first!);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/review\/c[a-z0-9]+\?from=archive$/, { timeout: 60_000 });
      await telemetry.expect("games_archive_game_opened", { target: "review" }, { source: "client" });
    });

    test(
      "Filter Losses + Rapid with the live count, Clear All, search 'tal'",
      { tag: ARCHIVE_BOARDS.map((b) => `@state:${b}.filters_open`) },
      async ({ member, page, telemetry }) => {
        test.setTimeout(240_000);
        await member("A");
        await openArchive(page);
        await page.getByTestId("games-filter").click();
        const panel = page.getByTestId("games-filter-panel");
        await expect(panel).toBeVisible();
        if (isPhone(device)) await expect(panel).toHaveAttribute("data-surface", "sheet");
        const count = page.waitForResponse((r) => r.url().includes("/api/me/games") && r.url().includes("limit=0"), { timeout: 60_000 });
        await panel.getByRole("radio", { name: "Losses" }).click();
        await panel.getByRole("button", { name: "Rapid" }).click();
        await count;
        const show = panel.getByTestId("games-filter-show");
        await expect(show).toHaveText(/^Show \d+ Games?$/);
        await show.click();
        await expect(page).toHaveURL(/\/games\?result=loss&tc=rapid$/);
        await expect(page.getByTestId("games-list")).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
        // The option is named by its content (FIX-1, label in name); textContent also holds the wide-only context.
        const labels = await page.getByTestId("games-row").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) expect(label).toMatch(/^LOSS vs .*Rapid/);
        await telemetry.expect("games_archive_filtered", { result: ["loss"], tc: ["rapid"] }, { source: "client" });

        await page.getByTestId("games-filter").click();
        await page.getByTestId("games-filter-clear").click();
        await page.getByTestId("games-filter-show").click();
        await expect(page).toHaveURL(/\/games$/);

        await page.getByTestId("games-search").fill("tal");
        await expect(page).toHaveURL(/\/games\?q=tal$/);
        await expect(page.getByTestId("games-list")).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
        const searched = await page.getByTestId("games-row").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
        expect(searched.length).toBeGreaterThan(0);
        for (const label of searched) expect(label).toMatch(/tal/i);
        telemetry.forbid("tal_fan_77");
      },
    );

    if (!isPhone(device)) {
      test("Compare shows only for a legend game", async ({ member, page, seeded }) => {
        test.setTimeout(240_000);
        await member("A");
        await gotoOk(page, `/games?sel=${seeded.LEGEND}`);
        await expect(page.getByTestId("games-aside")).toHaveAttribute("data-ref", seeded.LEGEND, { timeout: 60_000 });
        await expect(page.getByTestId("games-open-compare")).toBeVisible();
        await gotoOk(page, `/games?sel=${seeded.GAME}`);
        await expect(page.getByTestId("games-aside")).toHaveAttribute("data-ref", seeded.GAME, { timeout: 60_000 });
        await expect(page.getByTestId("games-open-review")).toBeVisible();
        await expect(page.getByTestId("games-open-compare")).toHaveCount(0);
      });
    }
  });
}
