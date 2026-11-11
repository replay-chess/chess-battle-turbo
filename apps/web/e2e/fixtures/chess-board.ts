import { type Page, type Locator, expect } from "@playwright/test";
import { Chess } from "chess.js";

const PIECE_LETTER: Record<string, string> = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };

/**
 * A FEN for the position the board shows, with `color` to move: pieces from the square images' alt text ("White
 * knight" on the v3 board, "White n" on the legacy one). Castling and en passant are left out, so every move chess.js
 * generates from it is legal in the real position too. Null when the board cannot be read.
 */
export function fenFromBoard(pieces: readonly { square: string; alt: string }[], color: "w" | "b"): string | null {
  const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array<string | null>(8).fill(null));
  for (const { square, alt } of pieces) {
    const m = /^(White|Black)\s+(\w+)/.exec(alt.trim());
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    if (!m || square.length !== 2 || file < 0 || file > 7 || !(rank >= 1 && rank <= 8)) continue;
    const name = m[2]!.toLowerCase();
    const letter = name.length === 1 ? name : PIECE_LETTER[name];
    if (!letter || !"pnbrqk".includes(letter)) return null;
    grid[8 - rank]![file] = m[1] === "White" ? letter.toUpperCase() : letter;
  }
  const rows = grid.map((row) => {
    let out = "";
    let empty = 0;
    for (const c of row) {
      if (c) {
        out += (empty || "") + c;
        empty = 0;
      } else empty++;
    }
    return out + (empty || "");
  });
  return `${rows.join("/")} ${color} - - 0 1`;
}

/**
 * Legal moves for `color` in that position as [from, to], the ones that do not end the game first (a first move that
 * mates or stalemates would end a spec's game early). Empty when the position cannot be read.
 */
export function legalMovesFromBoard(pieces: readonly { square: string; alt: string }[], color: "w" | "b"): [string, string][] {
  const fen = fenFromBoard(pieces, color);
  if (!fen) return [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const moves = chess.moves({ verbose: true });
  const ends = (m: (typeof moves)[number]) => {
    chess.move(m);
    const over = chess.isGameOver();
    chess.undo();
    return over;
  };
  return [...moves.filter((m) => !ends(m)), ...moves.filter(ends)].map((m): [string, string] => [m.from, m.to]);
}

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
    // Every piece on the board, from the alt text ("White ..." / "Black ...") since Next.js Image rewrites src URLs.
    const pieces = await this.page.evaluate(() => {
      const result: { square: string; alt: string }[] = [];
      for (const sq of document.querySelectorAll("[data-square]")) {
        const img = sq.querySelector("img");
        if (img?.alt) result.push({ square: sq.getAttribute("data-square")!, alt: img.alt });
      }
      return result;
    });

    // The position is on the board, so chess.js picks the move and it is played straight away. Trying every piece in
    // turn costs one to several seconds per piece on a busy WebKit runner, and a side in check (only the king may
    // move, often late in DOM order) ran past the 30 s first-move window. regression: CI run 43033886505
    // (webkit-iphone friend-full: Black in check after Nxc7+, the game aborted before the king was tried).
    const legal = legalMovesFromBoard(pieces, color);
    if (legal.length > 0) {
      const [from, to] = legal[0]!;
      await this.clickSquare(from);
      await this.clickSquare(to);
      await this.choosePromotionQueen();
      return [from, to];
    }

    // Fallback (the board could not be read): try each piece until one shows legal-move indicators.
    const altPrefix = color === "w" ? "White" : "Black";
    const pieceSquares = pieces.filter((p) => p.alt.startsWith(altPrefix)).map((p) => p.square);
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
        await this.choosePromotionQueen();
        return [from, to];
      }

      // Deselect by clicking the same square again
      await this.clickSquare(from);
    }

    throw new Error(`No legal moves found for ${color}`);
  }

  /** After a pawn reaches the last rank: the queen, on the legacy popup or the v3 picker. */
  private async choosePromotionQueen() {
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
