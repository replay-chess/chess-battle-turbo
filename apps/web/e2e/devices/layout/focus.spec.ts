// Keyboard focus never scrolls the document or the clip root; ScrollRegions
// scroll instead (SPEC 10.6, F M6). Chromium projects only.
import type { Page } from "@playwright/test";
import { inside } from "./assertions";
import { expect, gotoStable, test } from "./fixtures";
import { GAME_ROUTE, LIST_ROUTE } from "./routes";

test.skip(({ browserName }) => browserName !== "chromium", "keyboard specs run on Chromium projects (F M6)");

function rootScrolls(page: Page) {
  return page.evaluate(() => ({
    doc: document.scrollingElement!.scrollTop,
    viewport: document.querySelector("[data-rc-viewport]")!.scrollTop,
    main: document.querySelector("[data-rc-main]")!.scrollTop,
  }));
}

test("tabbing through the aside scrolls the move list, never the page", async ({ page }) => {
  await gotoStable(page, GAME_ROUTE);
  const aside = page.locator("[data-rc-aside]");
  const asideBox = await aside.boundingBox();
  test.skip(!asideBox || asideBox.height < 40, "the move strip is folded at this size");

  const region = aside.locator("[data-rc-scroll]");
  const startTop = await region.evaluate((el) => el.scrollTop);
  await region.focus();
  await page.keyboard.press("Tab"); // first move: off-screen above (the list starts at the latest move)
  await expect(region.locator("button").first()).toBeFocused();
  expect(await region.evaluate((el) => el.scrollTop), "the ScrollRegion scrolled to the focused move").not.toBe(startTop);
  expect(await rootScrolls(page)).toEqual({ doc: 0, viewport: 0, main: 0 });

  const controls = aside.locator("button:visible, a[href]:visible, input:visible, select:visible");
  const n = await controls.count();
  expect(n).toBeGreaterThan(1);
  await controls.nth(n - 2).focus();
  await page.keyboard.press("Tab");
  const last = controls.nth(n - 1);
  await expect(last, "Tab reaches the last control in the aside").toBeFocused();
  expect(await rootScrolls(page)).toEqual({ doc: 0, viewport: 0, main: 0 });
  const vp = page.viewportSize()!;
  expect(inside(await last.boundingBox(), vp.width, vp.height), "the last control is on screen").toBe(true);
});

test("a ScrollRegion with no focusable content is keyboard-reachable", async ({ page }) => {
  await gotoStable(page, LIST_ROUTE);
  await page.getByRole("button", { name: "Filter" }).focus();
  await page.keyboard.press("Tab");
  const region = page.locator("[data-rc-scroll]");
  await expect(region).toBeFocused();
  await expect(region).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("End");
  await expect.poll(() => region.evaluate((el) => el.scrollTop), { message: "End scrolls the region" }).toBeGreaterThan(0);
  expect(await rootScrolls(page)).toEqual({ doc: 0, viewport: 0, main: 0 });
});
