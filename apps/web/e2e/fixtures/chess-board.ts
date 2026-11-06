import { type Page, type Locator, expect } from "@playwright/test";

export class ChessBoardHelper {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  square(notation: string): Locator {
    return this.page.locator(`[data-square="${notation}"]`);
  }

  async clickSquare(notation: string) {
    await this.square(notation).click();
  }

  async makeMove(from: string, to: string) {
    await this.clickSquare(from);
    await this.clickSquare(to);
  }

  /**
   * Play a valid move by finding a piece of the given color, clicking it to
   * reveal legal-move indicators, then clicking one of the highlighted squares.
   *
   * Works with any starting position (standard or legend/opening FENs).
   * Returns the [from, to] squares of the move played.
   */
  async playValidMove(color: "w" | "b"): Promise<[string, string]> {
    // Collect all squares that have a piece of the right color.
    // Use alt text ("White ..." / "Black ...") since Next.js Image rewrites src URLs.
    const altPrefix = color === "w" ? "White" : "Black";
    const pieceSquares = await this.page.evaluate((prefix: string) => {
      const squares = document.querySelectorAll("[data-square]");
      const result: string[] = [];
      for (const sq of squares) {
        const img = sq.querySelector("img");
        if (img && img.alt.startsWith(prefix)) {
          result.push(sq.getAttribute("data-square")!);
        }
      }
      return result;
    }, altPrefix);

    // Try each piece until we find one with legal moves
    for (const from of pieceSquares) {
      await this.clickSquare(from);
      // Short wait for legal-move indicators to render
      await this.page.waitForTimeout(200);

      // Legal move dots: div.rounded-full inside a [data-square] that isn't the selected square
      const legalTargets = await this.page.evaluate((fromSq: string) => {
        const targets: string[] = [];
        const squares = document.querySelectorAll("[data-square]");
        for (const sq of squares) {
          const notation = sq.getAttribute("data-square");
          if (notation === fromSq) continue;
          // Move dot (empty square) or capture triangles (occupied square)
          const hasDot = sq.querySelector(".rounded-full");
          const hasCapture = sq.querySelector('[style*="rgba(220, 80, 80"]');
          if (hasDot || hasCapture) {
            targets.push(notation!);
          }
        }
        return targets;
      }, from);

      if (legalTargets.length > 0) {
        const to = legalTargets[0]!;
        await this.clickSquare(to);

        // Handle pawn promotion popup — auto-select Queen
        const promoHeading = this.page.getByRole("heading", { name: "Promote Pawn" });
        if (await promoHeading.isVisible({ timeout: 500 }).catch(() => false)) {
          await this.page.getByRole("button", { name: /queen/i }).click();
        } else {
          // v3 board (components/board/PromotionPicker.tsx): a real pointer click is accepted.
          const picker = this.page.getByRole("menu", { name: "Choose a promotion piece" });
          if (await picker.isVisible({ timeout: 500 }).catch(() => false)) {
            await picker.getByRole("menuitem", { name: "Promote to queen" }).click();
          }
        }

        return [from, to];
      }

      // Deselect by clicking the same square again
      await this.clickSquare(from);
    }

    throw new Error(`No legal moves found for ${color}`);
  }

  async waitForBoard() {
    await this.page.locator("[data-square]").first().waitFor({ timeout: 30_000 });
  }

  /** Wait for the game to actually start (past analysis phase, game_started event fired) */
  async waitForGameStarted(timeout = 60_000) {
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="game-board-container"]');
        return el?.getAttribute("data-game-started") === "true";
      },
      { timeout },
    );
  }

  async detectPlayerColor(): Promise<"w" | "b"> {
    // Wait until data-player-color is set (starts as null before game_started fires)
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="game-board-container"]');
        const c = el?.getAttribute("data-player-color");
        return c === "w" || c === "b";
      },
      { timeout: 30_000 },
    );
    const container = this.page.locator('[data-testid="game-board-container"]');
    const color = await container.getAttribute("data-player-color");
    if (color !== "w" && color !== "b") {
      throw new Error(`Unexpected player color: ${color}`);
    }
    return color;
  }

  /** Read whose turn it currently is from the DOM */
  async getCurrentTurn(): Promise<"w" | "b"> {
    const container = this.page.locator('[data-testid="game-board-container"]');
    const turn = await container.getAttribute("data-current-turn");
    if (turn !== "w" && turn !== "b") {
      throw new Error(`Unexpected current turn: ${turn}`);
    }
    return turn;
  }

  /** Wait until it's the given color's turn (event-based, no arbitrary delays) */
  async waitForTurn(color: "w" | "b", timeout = 15_000) {
    await this.page.waitForFunction(
      (c) => {
        const el = document.querySelector('[data-testid="game-board-container"]');
        return el?.getAttribute("data-current-turn") === c;
      },
      color,
      { timeout },
    );
  }

  async expectPieceOnSquare(square: string) {
    const img = this.square(square).locator("img");
    await expect(img).toBeVisible({ timeout: 10_000 });
  }

  gameResult(): Locator {
    return this.page.locator('[data-testid="game-result"]');
  }

  async resign() {
    // v3 (game-v3 on): Resign lives in the ⋯ menu (row on desktop, `-bar` on phones). Legacy: a visible button.
    const menu = this.page.locator('[data-testid="game-menu-button"]:visible, [data-testid="game-menu-button-bar"]:visible').first();
    if (await menu.isVisible().catch(() => false)) await menu.click();
    await this.page.locator('[data-testid="resign-button"]:visible').click();
    await this.page.locator('[data-testid="confirm-resign-button"]').click();
  }
}
