// The server HTML is already the final layout (SPEC 10.6, 04 §5.3): the board box
// with JavaScript disabled equals the hydrated box, and nothing shifts on load.
import type { BrowserContextOptions } from "@playwright/test";
import { expect, gotoStable, hasInsets, test } from "./fixtures";
import { isChromium } from "../helpers";
import { GAME_ROUTE } from "./routes";

test("board box without JavaScript equals the hydrated box", async ({ page, browser }, testInfo) => {
  test.skip(hasInsets(testInfo), "inset emulation needs an init script, which can't run without JavaScript");
  await gotoStable(page, GAME_ROUTE);
  const hydrated = await page.getByTestId("chess-board").boundingBox();
  expect(hydrated).not.toBeNull();

  // `screen` is set by zoomed() in matrix.ts but isn't part of Playwright's test-option types.
  const use = testInfo.project.use as typeof testInfo.project.use & Pick<BrowserContextOptions, "screen">;
  const ctx = await browser.newContext({
    viewport: use.viewport,
    screen: use.screen,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    reducedMotion: "reduce",
    javaScriptEnabled: false,
  });
  try {
    const noJs = await ctx.newPage();
    const res = await noJs.goto(GAME_ROUTE, { waitUntil: "load" });
    expect(res?.status()).toBe(200);
    const server = await noJs.getByTestId("chess-board").boundingBox();
    expect(server, "board rendered in the server HTML").not.toBeNull();
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(server![k] - hydrated![k]), `${k}: server ${server![k]} vs hydrated ${hydrated![k]}`).toBeLessThanOrEqual(0.5);
    }
  } finally {
    await ctx.close();
  }
});

test("no layout shift on load (Chromium)", async ({ page }, testInfo) => {
  test.skip(hasInsets(testInfo), "projects without insets only");
  test.skip(!isChromium(testInfo), "layout-shift entries are Chromium-only");
  await page.goto(GAME_ROUTE);
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!e.hadRecentInput) total += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 1500);
      }),
  );
  expect(cls, "cumulative layout shift").toBeLessThan(0.01);
});
