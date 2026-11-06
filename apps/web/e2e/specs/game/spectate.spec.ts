// T13 / T17 (phase-02 plan 1.2, 8.10, 11.1, 12.6) @smoke: a member opens a live game's URL and watches it one ply
// behind (only Flip and the move steppers); at the end `over_spectator` with "Watch another game" (the live list).
// A non-member who opens the same URL is sent to /pricing.
import { expect, byColor, planEvent, playLine, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("spectate", { tag: p2("@smoke", "@local-only") }, () => {
  test(
    "watch one ply behind, then the result; a non-member is redirected",
    { tag: [...gameTags("state", ["spectate", "over_spectator"]), "@state:V3Spectate.spectate"] },
    async ({ seat, seedGame, nonMemberPage, telemetry }) => {
      const a = await seat("O");
      const b = await seat("P");
      const c = await seat("F");
      const g = await seedGame("G-THREEFOLD", a, b);
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);
      await playLine(s, ["e2e4", "e7e5", "g1f3", "b8c6"]);
      const p4 = await s.w.ply();

      await c.open(g.ref);
      await c.waitPhase("spectate");
      await expect(c.page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-role", "spectator");
      await planEvent(telemetry, "spectate_started", { source: "link" }, { source: "client" });
      // One ply behind the players.
      await c.waitPly(p4 - 1);
      await s.w.move("f1c4");
      await s.b.waitPly(p4 + 1);
      await c.waitPly(p4);
      // Spectator controls: Flip and the steppers, nothing that acts on the game.
      await expect(c.byTestId("flip-button")).toBeVisible();
      await expect(c.page.locator('[data-testid="resign-button"]:visible, [data-testid^="offer-draw-button"]:visible, [data-testid^="abort-button"]:visible')).toHaveCount(0);
      // If the spectator has a ⋯ menu, nothing in it acts on the game.
      const menu = c.page.locator('[data-testid="game-menu-button"]:visible, [data-testid="game-menu-button-bar"]:visible').first();
      if (await menu.isVisible().catch(() => false)) {
        await menu.click();
        await expect(c.page.locator('[data-testid="resign-button"], [data-testid="offer-draw-menu-item"], [data-testid="abort-menu-item"]')).toHaveCount(0);
        await c.page.keyboard.press("Escape");
      }

      // A non-member who opens the URL lands on /pricing with the game as the return address.
      await nonMemberPage.goto(`/game/${g.ref}`, { timeout: 180_000 });
      await nonMemberPage.waitForURL(/\/pricing\?/, { timeout: 60_000 });
      expect(new URL(nonMemberPage.url()).searchParams.get("redirect_url")).toBe(`/game/${g.ref}`);

      // The game ends: every withheld ply is shown and the spectator result card offers another game.
      await s.b.board.resign();
      await c.waitPhase("over_spectator");
      await c.waitPly(p4 + 1);
      await c.page.getByTestId("watch-another").click();
      await expect(c.page.locator('[data-testid="live-games"], [data-testid="live-games-empty"]').first()).toBeVisible();
    },
  );
});
