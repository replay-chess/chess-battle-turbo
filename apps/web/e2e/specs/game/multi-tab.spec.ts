// Multi-tab (phase-02 plan 12.4, 12.6): one player with the game open in two tabs; a move from the second tab shows
// in both, and the opponent keeps seeing them online until both tabs are gone.
import { byColor, expect, startSeeded, test, attr } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("multi-tab", { tag: p2("@local-only") }, () => {
  test("two tabs of one player stay in sync; presence until both close", { tag: gameTags("state", ["opp_disconnected"]) }, async ({ seat, seedGame }) => {
    const a = await seat("G");
    const b = await seat("H");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await s.w.move("e2e4");
    await s.b.move("e7e5");
    await s.w.waitPly(2);

    // White's second tab.
    const tab2 = await s.w.context.newPage();
    await tab2.goto(`/game/${g.ref}`, { timeout: 180_000 });
    await expect(tab2.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-ply", "2", { timeout: 90_000 });
    await tab2.locator('[data-square="g1"]').click();
    await tab2.locator('[data-square="f3"]').click();
    await s.w.waitPly(3);
    await s.b.waitPly(3);
    await expect(tab2.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-ply", "3");

    // Closing one tab: still online for Black.
    await tab2.close();
    await s.b.page.waitForTimeout(3_000);
    expect(await attr(s.b.page, "data-phase")).not.toBe("opp_disconnected");
    // Closing the last one: Black sees White disconnected.
    await s.w.page.goto("about:blank");
    await s.b.waitPhase("opp_disconnected", 30_000);
  });
});
