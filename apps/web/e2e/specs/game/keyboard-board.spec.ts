// Keyboard play (phase-02 plan 4.5.5, 12.6): three moves with the keyboard only (grid focus + Enter) and with the
// text move input; the focus outline is visible; axe finds no serious violations on the game screen.
import AxeBuilder from "@axe-core/playwright";
import { byColor, expect, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("keyboard", { tag: p2("@local-only") }, () => {
  test("grid moves, typed moves, a11y", { tag: gameTags("state", ["your_move"]) }, async ({ seat, seedGame }) => {
    const a = await seat("H");
    const b = await seat("I");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    const w = s.w.page;

    // Grid: focus e2, Enter, focus e4, Enter.
    await w.locator('[data-square="e2"]').focus();
    await w.keyboard.press("Enter");
    await w.locator('[data-square="e4"]').focus();
    const outline = await w.locator('[data-square="e4"]').evaluate((el) => getComputedStyle(el).outlineStyle + getComputedStyle(el).boxShadow);
    expect(outline).not.toBe("nonenone");
    await w.keyboard.press("Enter");
    await s.b.waitPly(1);

    // Black and White by keyboard too: e7→e5, g1→f3.
    const grid = async (page: typeof w, from: string, to: string) => {
      await page.locator(`[data-square="${from}"]`).focus();
      await page.keyboard.press("Enter");
      await page.locator(`[data-square="${to}"]`).focus();
      await page.keyboard.press("Enter");
    };
    await grid(s.b.page, "e7", "e5");
    await s.w.waitPly(2);
    await grid(w, "g1", "f3");
    await s.b.waitPly(3);

    const axe = await new AxeBuilder({ page: w }).include('[data-testid="game-board-container"]').analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

// The text move input (MoveInput, plan 4.5.1) under the game board: SAN and UCI, a refused move shows the reason.
// regression: FIX-A — it was mounted only on /dev/ui/board.
test.describe("typed moves", { tag: p2("@local-only") }, () => {
  test("SAN and UCI through the move input; an illegal one is explained", async ({ seat, seedGame }) => {
    const a = await seat("H");
    const b = await seat("I");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    const type = async (page: typeof s.w.page, text: string) => {
      const input = page.locator('[data-testid="game-board-container"] [data-testid="move-input"] input');
      await input.focus();
      await input.fill(text);
      await input.press("Enter");
    };
    await type(s.w.page, "e4");
    await s.b.waitPly(1);
    await type(s.b.page, "e7e5");
    await s.w.waitPly(2);
    await type(s.w.page, "Ke3");
    await expect(s.w.page.locator('[data-testid="game-board-container"] [data-testid="move-input"] [role="status"]')).toContainText(/legal/i);
    await type(s.w.page, "Nf3");
    await s.b.waitPly(3);
  });
});
