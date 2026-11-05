// Every lock-mode route fits one viewport on every matrix project (SPEC 10.6).
import { expectTapTargets } from "../helpers";
import { expectOneViewport } from "./assertions";
import { expect, gotoStable, shellModeFor, test } from "./fixtures";
import { NAV_WIDTH } from "./modes";
import { ROUTES, isGameRoute } from "./routes";

for (const route of ROUTES) {
  test(`one viewport ${route.path}`, async ({ page }) => {
    await gotoStable(page, route.path);
    const mode = await shellModeFor(page);
    const gameInTabbar = isGameRoute(route.path) && mode === "tabbar";

    await expectOneViewport(page, { board: route.board, nav: !gameInTabbar });
    await expectTapTargets(page);

    // Shell mode, read from the rendered DOM.
    if (mode === "tabbar") {
      await expect(page.locator("[data-rc-nav]")).toBeHidden();
      if (gameInTabbar) {
        await expect(page.locator("[data-rc-controls]"), "game: control bar replaces the tab bar").toBeVisible();
        await expect(page.locator("[data-rc-tabbar]")).toHaveCount(0);
      } else {
        await expect(page.locator("[data-rc-tabbar]")).toBeVisible();
      }
    } else {
      const nav = await page.locator("[data-rc-nav]").boundingBox();
      expect(nav, `${mode}: [data-rc-nav] visible`).not.toBeNull();
      expect(Math.abs(nav!.width - NAV_WIDTH[mode]), `${mode}: nav width ${nav!.width}`).toBeLessThanOrEqual(1);
      await expect(page.locator("[data-rc-tabbar]")).toBeHidden();
    }

    // Exactly one Main navigation landmark is exposed (none on a tab-bar-mode game).
    await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })).toHaveCount(gameInTabbar ? 0 : 1);
  });
}
