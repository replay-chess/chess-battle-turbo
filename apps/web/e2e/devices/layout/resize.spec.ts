// Live resizes without a reload (SPEC 10.6): the Safari toolbar collapsing, and a
// desktop window zooming in. Container queries resize the board with no script.
import type { Page, TestInfo } from "@playwright/test";
import { expectOneViewport, stageGeometry } from "./assertions";
import { expect, gotoStable, test } from "./fixtures";
import { GAME_ROUTE } from "./routes";

const PROJECTS = ["iphone-safari@100", "desktop-1440@100", "desktop-1280@125"];

/**
 * Waits until the board, its stage and main's scroll height stay the same for 10 frames (at most 3 s). A resize re-renders the
 * media-query-driven chrome and the ResizeObserver-sized arrows a few frames later (WebKit: the board passed
 * through 676px for ~200 ms on 1440→960, and moved 4px ~100 ms after 659→745), so two
 * rAFs could measure a stale layout.
 */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const key = () =>
          ['[data-testid="chess-board"]', ".rc-stage"]
            .map((sel) => {
              const r = document.querySelector(sel)?.getBoundingClientRect();
              return r ? `${r.x},${r.y},${r.width},${r.height}` : "-";
            })
            .join("|") + `|${document.querySelector("[data-rc-main]")?.scrollHeight ?? "-"}`;
        const deadline = performance.now() + 3000;
        let last = key();
        let same = 0;
        const tick = () => {
          const now = key();
          same = now === last ? same + 1 : 0;
          last = now;
          if (same >= 10 || performance.now() > deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

const onlyOnResizeProjects = (testInfo: TestInfo) =>
  test.skip(!PROJECTS.includes(testInfo.project.name), "resize runs on three projects only");

test("Safari toolbar collapse 393x659 → 393x745 keeps the board inside @p1", async ({ page }, testInfo) => {
  onlyOnResizeProjects(testInfo);
  await page.setViewportSize({ width: 393, height: 659 });
  await gotoStable(page, GAME_ROUTE);
  await expectOneViewport(page, { board: true });
  const before = await stageGeometry(page);

  await page.setViewportSize({ width: 393, height: 745 });
  await settle(page);
  await expectOneViewport(page, { board: true });
  const after = await stageGeometry(page);

  // The board is width-limited at 393px, so the stage (and the move strip) grows instead.
  expect(after.stage!.height, "stage follows the taller viewport").toBeGreaterThan(before.stage!.height + 50);
  expect(after.board!.width).toBeLessThanOrEqual(393.5);
});

test("desktop 1440x900 → 960x600 resizes the board @p1", async ({ page }, testInfo) => {
  onlyOnResizeProjects(testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoStable(page, GAME_ROUTE);
  await expectOneViewport(page, { board: true });
  const before = await stageGeometry(page);

  await page.setViewportSize({ width: 960, height: 600 });
  await settle(page);
  await expectOneViewport(page, { board: true });
  const after = await stageGeometry(page);

  expect(after.board!.width, "board shrinks with the viewport").toBeLessThan(before.board!.width - 50);
});

test("banner=payment shrinks a height-limited board @p1", async ({ page }, testInfo) => {
  onlyOnResizeProjects(testInfo);
  await gotoStable(page, GAME_ROUTE);
  const plain = await stageGeometry(page);

  await gotoStable(page, `${GAME_ROUTE}&banner=payment`);
  await expectOneViewport(page, { board: true });
  const withBanner = await stageGeometry(page);

  expect(withBanner.stage!.height, "the banner row takes height from the stage").toBeLessThan(plain.stage!.height - 1);
  if (testInfo.project.name.startsWith("desktop-")) {
    // Height-limited projects: the board loses about the banner height.
    expect(withBanner.board!.width).toBeLessThan(plain.board!.width - 1);
  } else {
    expect(withBanner.board!.width).toBeLessThanOrEqual(plain.board!.width + 0.5);
  }
});
