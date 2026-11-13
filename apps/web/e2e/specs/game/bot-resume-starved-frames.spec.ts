// A bot game reloaded while the page gets no animation frames still resumes from the device's journal (P2 plan 5.3.2),
// and the document never holds a second copy of the game screen, with frames starved or not.
//
// regression: CI runs 43211562326, 43226863882 and 43438531034 (webkit-iphone, bot-game.spec): after `page.reload()`
// a second, hidden, React-less copy of the game screen (`div[hidden]#S:2`) sat next to React's. The page streamed the
// screen as Suspense segments (the route's loading.tsx boundary, the lazy bot screen, the lazy move input); React's
// reveal of a segment (`$RC` → `$RV`) waits for an animation frame, and a boundary that React client-renders first (a
// context update during hydration, e.g. Clerk loading) leaves the server's copy hidden in the document until a frame
// runs. The fix renders the screen in the document's shell (no boundary around it), so there is no segment to leave.
// An earlier symptom of the same starvation (401bb58): the controller started its resume on the next frame only.
//
// The spec reproduces the conditions on demand: the document's streamed part is held back (fixtures/slow-document.ts,
// the slow server case) and requestAnimationFrame is starved for 20 s on the reloaded game page (an init script). While
// frames are still starved, exactly one game screen is in the document and the live, React-owned board reaches the
// journal's ply; once frames run again there is still one, and the game goes on past the reload ply.
import type { Page } from "@playwright/test";
import { expect, expectOneGameScreen, seatLetters, test } from "../../fixtures/games";
import { startSlowDocumentProxy } from "../../fixtures/slow-document";
import { WEB_PORT } from "../../fixtures/socket-server";
import { p2 } from "./tags";

const STARVE_MS = 20_000;

/** Every game-board-container in the document (hidden streamed copies included) and how many React owns. */
const containers = (page: Page) =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-testid="game-board-container"]')];
    const react = all.filter((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))).length;
    const streamedCopies = document.querySelectorAll('div[hidden][id^="S:"] [data-testid]').length;
    return { all: all.length, react, streamedCopies };
  });

/** data-ply of the board container React renders (the one with a fiber), or null while there is none. */
const liveBoardPly = (page: Page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid="game-board-container"]')) {
      if (Object.keys(el).some((k) => k.startsWith("__reactFiber"))) return Number(el.getAttribute("data-ply"));
    }
    return null;
  });

test.describe("bot game resume without animation frames", { tag: p2("@smoke", "@local-only") }, () => {
  test("a reload with starved frames and a slow stream resumes at the journal's ply with one screen throughout", async ({
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

      // While frames are still starved: the live board resumes from the journal, and from the first board on until
      // the stream is in (and a few seconds past it), the document holds exactly one game screen, React's, with no
      // streamed copy of any part of the page.
      const resumeBy = Date.now() + 10_000;
      for (;;) {
        const c = await containers(page);
        expect(c.all, "at most one game-board-container while the page loads (frames starved)").toBeLessThanOrEqual(1);
        expect(c.streamedCopies, "no streamed (hidden S:n) copy of any part of the page").toBe(0);
        if ((await liveBoardPly(page)) === reloadPly) break;
        expect(Date.now(), "live board at the journal's ply within 10 s").toBeLessThan(resumeBy);
        await page.waitForTimeout(100);
      }
      const sampleUntil = Date.now() + 4_000;
      do {
        expect(await containers(page), "one game screen, React's, no streamed copy (frames starved)").toEqual({ all: 1, react: 1, streamedCopies: 0 });
        await page.waitForTimeout(200);
      } while (Date.now() < sampleUntil);
      await expectOneGameScreen(page);
      expect(Date.now() - reloadedAt, "resumed and checked before any frame ran").toBeLessThan(STARVE_MS);

      // Frames run again: still one screen, and the game goes on.
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
