// /dev/ui/games (plan §4.10): every archive interaction on fixtures, no sign-in. @demo:V3GamesArchive.*
import type { Page } from "@playwright/test";
import { DEVICES, expect, test } from "./_demo";

test.use(DEVICES["desktop-1440"]);

test.describe("games demo", { tag: ["@p3"] }, () => {
  async function open(page: Page, query: string) {
    await page.context().route(/unpkg\.com\/react-(scan|grab)\/|\/pingchat-widget\.js/, (r) => r.abort());
    // next dev's floating dev-tools button sits over the bottom-left of a sheet; production has none.
    await page.addInitScript(() => {
      const css = "nextjs-portal{display:none!important}";
      document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: css })));
    });
    await page.goto(`/dev/ui/games?${query}`, { timeout: 240_000 });
    await expect(page.getByTestId("games-archive")).toBeVisible({ timeout: 120_000 });
  }

  const optionIdOf = async (page: Page) => page.getByTestId("games-list").getAttribute("aria-activedescendant");

  test.describe("archive demo", () => {
    test("keyboard: arrows move the selection, End pages in, Enter opens, C opens Compare @demo:V3GamesArchive.default", async ({ page }) => {
      await open(page, "state=default");
      const list = page.getByTestId("games-list");
      await list.focus();
      const first = await optionIdOf(page);
      expect(first).toMatch(/cm3kc1a2b000cslzp0k3d7f9h$/);
      await page.keyboard.press("ArrowDown");
      expect(await optionIdOf(page)).not.toBe(first);
      await expect(page.getByTestId("games-aside-heading")).toHaveText("vs tal_fan_77 · lost");
      // The legend row (third): C opens Compare.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("c");
      await expect(page).toHaveURL(/opened=compare%3A|opened=compare:/);
      // End, then the sentinel loads page 2 (40 rows in all).
      await list.focus();
      await page.keyboard.press("End");
      await expect(page.getByText("Loading more games…")).toBeVisible();
      await expect(page.getByText("Loading more games…")).toBeHidden();
      await page.keyboard.press("End");
      await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveAttribute("data-index", "39");
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/opened=review(%3A|:)cm3kc1a2b000cslzp0k3d7f9h/);
    });

    test("filters: Losses + Rapid with a live count, chips, Clear All @demo:V3GamesArchiveFilters.filters_open", async ({ page }) => {
      await open(page, "state=default");
      await page.getByTestId("games-filter").click();
      const panel = page.getByTestId("games-filter-panel");
      await expect(panel).toBeVisible();
      await panel.getByRole("radio", { name: "Losses" }).click();
      await panel.getByRole("button", { name: "Rapid" }).click();
      await expect(panel.getByTestId("games-filter-chips")).toContainText("Losses");
      const show = panel.getByTestId("games-filter-show");
      await expect(show).toHaveText(/^Show \d+ Games?$/);
      const n = Number((await show.textContent())!.match(/\d+/)![0]);
      await show.click();
      await expect(panel).toBeHidden();
      await expect(page.getByTestId("games-filter")).toContainText("Filter, 2 active");
      const rows = page.getByTestId("games-row");
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(Math.min(n, await rows.count()));
      for (const label of await rows.evaluateAll((els) => els.map((e) => e.textContent ?? ""))) {
        expect(label).toMatch(/^LOSS vs /);
        expect(label).toMatch(/Rapid/);
      }
      await page.getByTestId("games-filter").click();
      await page.getByTestId("games-filter-clear").click();
      await expect(page.getByTestId("games-filter-show")).toHaveText("Show 40 Games");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("games-filter")).toContainText("Filter, 2 active"); // Esc discards the draft
    });

    test("search filters rows; no match offers Clear Search @demo:V3GamesArchive.default", async ({ page }) => {
      await open(page, "state=default");
      await page.getByTestId("games-search").fill("pawnstorm22");
      await expect(page.getByTestId("games-row").first()).toHaveAccessibleName(/pawnstorm22/);
      await page.getByTestId("games-search").fill("zzzz");
      await expect(page.getByTestId("games-no-match")).toContainText("No games match ‘zzzz’.");
      await page.getByTestId("games-clear-search").click();
      await expect(page.getByTestId("games-search")).toHaveValue("");
      await expect(page.getByTestId("games-row").first()).toBeVisible();
    });

    test("desktop: a click selects the row and fills the aside @demo:V3GamesArchive.default", async ({ page }) => {
      await open(page, "state=default");
      await page.getByTestId("games-row").nth(1).click();
      await expect(page.getByTestId("games-row").nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("games-aside")).toBeVisible();
    });

    test.describe("iphone@100", () => {
      test.use(DEVICES.iphone);

      test("a tap opens the review; no aside @demo:V3GamesArchive.default", async ({ page }) => {
        await open(page, "state=default");
        await page.getByTestId("games-row").nth(1).click();
        await expect(page).toHaveURL(/opened=review/);
        await expect(page.getByTestId("games-aside")).toBeHidden();
      });

      test("the filter is a bottom sheet @demo:V3GamesArchiveFilters.filters_open", async ({ page }) => {
        await open(page, "state=default");
        await page.getByTestId("games-filter").click();
        const panel = page.getByTestId("games-filter-panel");
        await expect(panel).toHaveAttribute("data-surface", "sheet");
        await panel.getByRole("radio", { name: "Losses" }).click();
        await expect(panel.getByTestId("games-filter-show")).toHaveText(/^Show \d+ Games?$/);
      });
    });

    test("empty, loading and error states @demo:V3GamesArchiveEmpty.empty @demo:V3GamesArchive.loading @demo:V3GamesArchive.error", async ({ page }) => {
      await open(page, "state=empty");
      await expect(page.getByTestId("games-empty")).toContainText("No games yet");
      await expect(page.getByTestId("games-empty-play")).toHaveText("Play a Game");
      await expect(page.getByTestId("games-aside")).toHaveCount(0);
      await open(page, "state=loading");
      await expect(page.getByTestId("games-ghost-rows").locator("> div")).toHaveCount(9);
      await open(page, "state=error");
      await expect(page.getByTestId("games-error")).toContainText("Couldn’t load your games.");
      await page.getByRole("button", { name: "Try Again" }).click();
      await expect(page.getByTestId("games-row").first()).toBeVisible();
    });

    test("a failed next page shows Couldn’t load more · Try Again", async ({ page }) => {
      await open(page, "state=default&next=error");
      await page.getByTestId("games-list").evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(page.getByTestId("games-next-error")).toBeVisible();
    });

    test("one viewport: the page never scrolls, only the list", async ({ page }) => {
      await open(page, "state=default");
      const m = await page.evaluate(() => ({
        sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight,
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      }));
      expect(m.sh).toBeLessThanOrEqual(m.ch);
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      const list = page.getByTestId("games-list");
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    });
  });
});
