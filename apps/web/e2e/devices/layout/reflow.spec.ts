// Beyond the matrix (200% zoom), content is never trapped (WCAG 1.4.10, 04 §7.5):
// no horizontal scroll, and main's safety scroll brings the whole board into view.
import { inside } from "./assertions";
import { expect, test } from "./fixtures";
import { GAME_ROUTE } from "./routes";

const CASES = [
  // 1280x800 at 200%, on the Chromium desktop project.
  { project: "desktop-1440@100", viewport: { width: 640, height: 400 }, dpr: 4, mobile: false },
  // iPhone Safari 393x659 at 200%, on the WebKit phone project.
  { project: "iphone@100", viewport: { width: 197, height: 330 }, dpr: 6, mobile: true },
];

for (const c of CASES) {
  test(`reflow ${c.viewport.width}x${c.viewport.height} @p1`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== c.project, `runs once, on ${c.project}`);
    const ctx = await browser.newContext({
      viewport: c.viewport,
      screen: c.viewport,
      deviceScaleFactor: c.dpr,
      isMobile: c.mobile,
      hasTouch: c.mobile,
      userAgent: testInfo.project.use.userAgent,
      reducedMotion: "reduce",
    });
    try {
      const page = await ctx.newPage();
      const res = await page.goto(GAME_ROUTE);
      expect(res?.status()).toBe(200);
      await page.waitForLoadState("load");
      await page.evaluate(() => document.fonts.ready);

      const h = await page.evaluate(() => {
        const se = document.scrollingElement!;
        const main = document.querySelector("[data-rc-main]")!;
        return { doc: se.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
      });
      expect(h.doc, "no horizontal document scroll").toBeLessThanOrEqual(1);
      expect(h.main, "no horizontal scroll in main").toBeLessThanOrEqual(1);

      const board = page.getByTestId("chess-board");
      await board.scrollIntoViewIfNeeded();
      expect(inside(await board.boundingBox(), c.viewport.width, c.viewport.height), "board fully visible after main scrolls").toBe(true);
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop), "the document itself never scrolls").toBe(0);
    } finally {
      await ctx.close();
    }
  });
}
