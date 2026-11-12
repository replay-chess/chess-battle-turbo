// A bot game reloaded while the page gets no animation frames still resumes from the device's journal (P2 plan 5.3.2).
//
// regression: CI run 43226863882 (webkit-iphone, bot-game.spec): after `page.reload()` the board sat at the server
// snapshot's ply 11 for the whole 30 s wait while the journal held ply 13, and a second, hidden, React-less copy of the
// game screen (`div[hidden]#S:2`) stayed in the document. Both come from frames that never ran: the controller started
// its resume on the next animation frame only (useLocalGame `defer`), and React's streamed reveal (`$RC` → `$RV`) of the
// outlined Suspense segments also waits for a frame, so while frames are starved a boundary that React had to render
// on the client (a context update during hydration, e.g. Clerk loading) keeps its server copy hidden in the document.
//
// The spec reproduces it on demand: the document's streamed part is held back (fixtures/slow-document.ts, the slow
// server case) and requestAnimationFrame is starved for 20 s on the reloaded game page (an init script). The live,
// React-owned board must reach the journal's ply while frames are still starved; once frames run again exactly one
// game screen is left, and the game goes on past the reload ply.
import type { Page } from "@playwright/test";
import { expect, expectOneGameScreen, seatLetters, test } from "../../fixtures/games";
import { startSlowDocumentProxy } from "../../fixtures/slow-document";
import { WEB_PORT } from "../../fixtures/socket-server";
import { p2 } from "./tags";

const STARVE_MS = 20_000;

/** data-ply of the board container React renders (the one with a fiber), or null while there is none. */
const liveBoardPly = (page: Page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid="game-board-container"]')) {
      if (Object.keys(el).some((k) => k.startsWith("__reactFiber"))) return Number(el.getAttribute("data-ply"));
    }
    return null;
  });

test.describe("bot game resume without animation frames", { tag: p2("@smoke", "@local-only") }, () => {
  test("a reload with starved frames and a slow stream resumes at the journal's ply; one screen once frames run", async ({
    seat,
  }, testInfo) => {
    test.setTimeout(300_000);
    const proxy = await startSlowDocumentProxy({ target: WEB_PORT, match: (p) => p.startsWith("/game/") });
    try {
      // Not E/G: bot-game.spec counts bot_game_* events for those users while this runs.
      const [letter] = seatLetters(testInfo, ["N"], ["O"]);
      const me = await seat(letter, { contextOptions: { baseURL: proxy.url } });
      const page = me.page;
      await page.goto("/play", { timeout: 180_000 });
      await page.getByTestId("start-game-button").click();
      await page.waitForURL(/\/game\//, { timeout: 120_000 });
      await me.waitPhase("bot", 120_000);
      const color = (await me.color())!;
      await expect(page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-current-turn", color, { timeout: 60_000 });
      const p0 = await me.ply();
      await me.board.playValidMove(color);
      await me.waitPly(p0 + 2, 60_000);
      await me.board.playValidMove(color);
      await me.waitPly(p0 + 4, 60_000);
      const reloadPly = p0 + 4; // in the journal; the server has at most the last checkpoint

      proxy.hold(1_500);
      await page.context().addInitScript((ms: number) => {
        if (!location.pathname.startsWith("/game/")) return;
        const raf = window.requestAnimationFrame.bind(window);
        const start = performance.now();
        window.requestAnimationFrame = (cb: FrameRequestCallback) => {
          const wait = ms - (performance.now() - start);
          return wait > 0 ? (setTimeout(() => raf(cb), wait) as unknown as number) : raf(cb);
        };
      }, STARVE_MS);
      const reloadedAt = Date.now();
      await page.reload({ timeout: 180_000, waitUntil: "commit" });
      expect(proxy.held().at(-1)?.chunks ?? 0, "the stream was held back").toBeGreaterThan(0);

      // While frames are still starved: the live board resumes from the journal.
      await expect.poll(() => liveBoardPly(page), { timeout: 10_000, message: "live board at the journal's ply" }).toBe(reloadPly);
      expect(Date.now() - reloadedAt, "resumed before any frame ran").toBeLessThan(STARVE_MS);

      // Frames run again: the streamed copies are gone, one screen is left, and the game goes on.
      await page.waitForTimeout(Math.max(0, STARVE_MS - (Date.now() - reloadedAt)) + 1_000);
      await expectOneGameScreen(page);
      await expect(page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-current-turn", color, { timeout: 60_000 });
      await me.board.playValidMove(color);
      await me.waitPly(reloadPly + 2, 60_000);
    } finally {
      await proxy.close();
    }
  });
});
