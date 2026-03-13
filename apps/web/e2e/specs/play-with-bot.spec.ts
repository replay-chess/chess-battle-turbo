import { test, expect, ChessBoardHelper } from "../fixtures";

test.describe("Play with Bot", () => {
  test("should start an AI game, play moves, and resign", async ({ playerE }) => {
    const page = playerE.page;
    const board = new ChessBoardHelper(page);

    // Navigate to /play — AI mode is selected by default
    await page.goto("/play");
    await page.locator('[data-testid="start-game-button"]').click();

    // Wait for redirect to game page
    await page.waitForURL(/\/game\//, { timeout: 60_000, waitUntil: "commit" });

    // Wait for board to render and game to start (past analysis phase)
    await board.waitForBoard();
    await board.waitForGameStarted();
    const myColor = await board.detectPlayerColor();

    // Play 2 moves (our move + wait for bot response each time)
    for (let i = 0; i < 2; i++) {
      await board.waitForTurn(myColor, 30_000);
      await board.playValidMove(myColor);
      // Wait for bot's response (turn switches away then back to us, or game ends)
      const opponentColor = myColor === "w" ? "b" : "w";
      // Give the bot time to respond — it should switch to opponent's turn then back
      await board.waitForTurn(opponentColor, 30_000).catch(() => {
        // Bot may have already moved by the time we check — ignore timeout
      });
    }

    // Resign
    await board.waitForTurn(myColor, 30_000).catch(() => {});
    await board.resign();

    // Assert game result shows defeat
    await expect(board.gameResult()).toContainText("Defeat", { timeout: 10_000 });
  });
});
