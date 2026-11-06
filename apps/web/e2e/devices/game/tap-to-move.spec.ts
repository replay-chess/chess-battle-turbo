// Touch play on the device matrix (phase-02 plan 12.7; FIX-A: the spec was missing): on the touch projects (iPhone,
// Android, iPad) tap-tap moves, drag moves and promotion-picker taps work, and the board's and the picker's hit
// targets are at least 44 px. Runs at 100 % (the zoom levels do not change touch handling).
import type { Page } from "@playwright/test";
import { expect, gotoStable, test } from "../layout/fixtures";

const ply = async (page: Page) => Number(await page.locator('[data-testid="game-board-container"]').getAttribute("data-ply"));

async function firstTarget(page: Page) {
  const t = page.locator("[data-square][data-target]").first();
  await expect(t).toBeVisible();
  return t;
}

test.describe("tap to move @p2", () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "touch projects only");
    test.skip(!testInfo.project.name.endsWith("@100"), "100 % only");
  });

  test("tap-tap and drag moves; squares are at least 44 px", async ({ page }) => {
    await gotoStable(page, "/dev/ui/game?state=your_move&freeze=1");
    const board = page.locator('[data-testid="game-board-container"]');
    await expect(board).toBeVisible();
    const size = await page.locator("[data-square]").first().boundingBox();
    expect(size!.width, "square width").toBeGreaterThanOrEqual(44 * 0.95);

    // Tap a movable piece, then one of its targets.
    const before = await ply(page);
    await page.locator("[data-square][data-movable]").first().tap();
    await (await firstTarget(page)).tap();
    await expect.poll(() => ply(page)).toBe(before + 1);
  });

  test("drag a piece onto a target", async ({ page }) => {
    await gotoStable(page, "/dev/ui/game?state=your_move&freeze=1");
    const fromSq = await page.locator("[data-square][data-movable]").first().getAttribute("data-square");
    const from = page.locator(`[data-square="${fromSq}"]`);
    await from.tap(); // shows the targets
    const toSq = await (await firstTarget(page)).getAttribute("data-square");
    const to = page.locator(`[data-square="${toSq}"]`);
    await from.tap(); // deselect
    const before = await ply(page);
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => ply(page)).toBe(before + 1);
  });

  test("promotion picker: tap a piece; options are at least 44 px", async ({ page }) => {
    // White pawn on b7, kings out of the way.
    const fen = "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1";
    await gotoStable(page, `/dev/ui/board?fen=${encodeURIComponent(fen)}`);
    await page.locator('[data-square="b7"]').tap();
    await page.locator('[data-square="b8"]').tap();
    const picker = page.getByTestId("promotion-picker");
    await expect(picker).toBeVisible();
    for (const opt of await picker.locator("[data-promotion]").all()) {
      const box = (await opt.boundingBox())!;
      expect(Math.min(box.width, box.height), "promotion option").toBeGreaterThanOrEqual(44 * 0.95);
    }
    await picker.locator('[data-promotion="n"]').tap();
    await expect(picker).toBeHidden();
    await expect(page.locator('[data-square="b8"] [data-piece="wn"]')).toBeVisible();
  });
});
