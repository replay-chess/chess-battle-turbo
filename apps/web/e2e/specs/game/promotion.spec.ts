// T6 (phase-02 plan 1.2, 4.5.3, 12.6): G-PROMO; b7→b8 opens the picker on the file, Esc puts the pawn back with the
// status line, then a knight is chosen and the move sent is `b7b8n`.
import { byColor, expect, planEvent, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("promotion", { tag: p2("@local-only") }, () => {
  test("Esc cancels, then under-promote to a knight", { tag: gameTags("state", ["promotion"]) }, async ({ seat, seedGame, telemetry }) => {
    const a = await seat("P");
    const b = await seat("F");
    const g = await seedGame("G-PROMO", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    const page = s.w.page;
    const picker = page.getByRole("menu", { name: "Choose a promotion piece" });
    const p0 = await s.w.ply();

    await page.locator('[data-square="b7"]').click();
    await page.locator('[data-square="b8"]').click();
    await s.w.waitPhase("promotion");
    await expect(picker).toBeVisible();
    for (const piece of ["queen", "rook", "bishop", "knight"]) {
      await expect(picker.getByRole("menuitem", { name: `Promote to ${piece}` })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(page.locator('[data-square="b7"] img, [data-square="b7"] [data-piece]').first()).toBeVisible();
    await expect(page.getByTestId("game-status")).toContainText(/promotion/i);
    expect(await s.w.ply()).toBe(p0);

    await page.locator('[data-square="b7"]').click();
    await page.locator('[data-square="b8"]').click();
    await picker.getByRole("menuitem", { name: "Promote to knight" }).click();
    await s.b.waitPly(p0 + 1);
    expect(s.w.link.sent().some((f) => f.includes('"game:move"') && f.includes('"b7b8n"'))).toBe(true);
    await planEvent(telemetry, "promotion_picked", { piece: "n" }, { source: "client" });
  });
});
