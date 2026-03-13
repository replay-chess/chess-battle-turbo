import { test, expect } from "@playwright/test";
import { ChessBoardHelper } from "../fixtures/chess-board";

test.describe("Demo Game", () => {
  test("should browse positions, play demo game vs bot, resign, and view analysis", async ({
    page,
  }) => {
    const board = new ChessBoardHelper(page);

    // 1. Browse featured positions
    await page.goto("/try");
    const positionCards = page.locator('a[href^="/try/"]');
    await positionCards.first().waitFor({ timeout: 30_000 });
    await expect(positionCards.first()).toBeVisible();

    // 2. Open position detail
    await positionCards.first().click();
    await page.waitForURL(/\/try\//, { timeout: 30_000, waitUntil: "commit" });

    // 3. Start demo game
    const playButton = page.getByRole("button", { name: /play vs bot/i });
    await expect(playButton).toBeVisible({ timeout: 10_000 });
    await playButton.click();
    await page.waitForURL(/\/try\/game\//, {
      timeout: 60_000,
      waitUntil: "commit",
    });

    // 4. Play game
    await board.waitForBoard();
    await board.waitForGameStarted();
    const myColor = await board.detectPlayerColor();

    for (let i = 0; i < 2; i++) {
      await board.waitForTurn(myColor, 30_000);
      await board.playValidMove(myColor);
      const opponentColor = myColor === "w" ? "b" : "w";
      await board.waitForTurn(opponentColor, 30_000).catch(() => {});
    }

    // 5. Resign
    await board.waitForTurn(myColor, 30_000).catch(() => {});
    await board.resign();
    await expect(board.gameResult()).toContainText("Defeat", {
      timeout: 10_000,
    });

    // 6. Verify analysis page
    const gameId = page.url().split("/try/game/")[1]?.split("?")[0];
    await page.goto(`/try/analysis/${gameId}`);
    await page
      .locator("[data-square]")
      .first()
      .waitFor({ timeout: 30_000 });
    await expect(page.locator("[data-square]").first()).toBeVisible();
  });
});
