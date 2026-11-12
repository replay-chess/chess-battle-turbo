// A slow engine download is "loading", not "the engine couldn't start" (phase-02 plan 5.3, 8.13; CI run 43068898609:
// the first bot-game attempt on webkit-iphone showed the engine error because the 8 s init timeout counted the
// download of the 7.3 MB WASM). The WASM response is held back 15 s, longer than that timeout: the coach zone shows
// "Loading the engine…", the error never appears, the engine starts and the bot plays.
import type { Route } from "@playwright/test";
import { expect, seatLetters, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

const WASM = /\/sf18-[0-9a-f]+\/stockfish-18-lite-single\.wasm(\?|$)/;
const HOLD_MS = 15_000;

test.describe("engine on a slow network", { tag: p2("@smoke", "@local-only") }, () => {
  test("a WASM that takes longer than the init timeout shows loading, then the engine plays", { tag: gameTags("state", ["bot"]) }, async ({ seat, telemetry }, testInfo) => {
    test.setTimeout(300_000);
    // Other users than bot-game.spec (E / G), whose bot_game_* counts are per user.
    const [letter] = seatLetters(testInfo, ["M"], ["L"]);
    // No service worker: the engine's requests go to the network (and through the route below), not a SW cache.
    const me = await seat(letter, { contextOptions: { serviceWorkers: "block" } });
    const page = me.page;
    let held = 0;
    // The worker's WASM request (context routes cover workers): answered normally, after HOLD_MS.
    await me.context.route(WASM, async (route: Route) => {
      held++;
      await new Promise((r) => setTimeout(r, HOLD_MS));
      await route.continue().catch(() => undefined);
    });
    const errors: number[] = [];
    const loadingAt: number[] = [];
    let start = 0;

    await page.goto("/play", { timeout: 180_000 });
    start = Date.now();
    await page.getByTestId("start-game-button").click();
    await page.waitForURL(/\/game\//, { timeout: 120_000 });
    await me.waitPhase("bot", 120_000);

    const loading = page.getByTestId("zone-engine-loading");
    const error = page.getByTestId("zone-engine-error");
    await expect(loading).toBeVisible({ timeout: 30_000 });
    await expect(loading).toContainText(/Loading the engine/);
    // Past the 8 s init timeout and the whole hold: never the failure.
    while (Date.now() - start < HOLD_MS + 5_000) {
      if (await error.isVisible()) errors.push(Date.now() - start);
      if (await loading.isVisible()) loadingAt.push(Date.now() - start);
      await page.waitForTimeout(500);
    }
    expect(errors, "the engine error showed while the WASM was still downloading").toEqual([]);
    expect(held, "the WASM request went through the held route").toBeGreaterThan(0);
    expect(Math.max(0, ...loadingAt), "still loading past the 8 s init timeout").toBeGreaterThan(10_000);

    await telemetry.expect("engine_init", { ok: true }, { source: "client", count: 1, timeout: 90_000 });
    await expect(loading).toBeHidden();
    await expect(error).toBeHidden();

    // The engine plays: our move, then its reply.
    const color = (await me.color())!;
    await expect(page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-current-turn", color, { timeout: 60_000 });
    const p0 = await me.ply();
    await me.board.playValidMove(color);
    await me.waitPly(p0 + 2, 60_000);
    await me.board.resign();
    await me.waitPhase(/^over_/, 30_000);
  });
});
