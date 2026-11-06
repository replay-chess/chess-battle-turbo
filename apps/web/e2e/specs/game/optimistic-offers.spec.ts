// Optimistic offers (phase-02 plan 5.2.8, G5, 12.6): with every frame from A delayed 300 ms, A's draw offer and,
// after the game, A's rematch offer render before the ack arrives; a forced negative ack (draw_cooldown) rolls the
// optimistic offer back with the cooldown toast.
import type { Page } from "@playwright/test";
import { byColor, expect, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

/** Clicks and reports how many ms passed until the board container showed `phase` (polled every frame). */
async function msUntilPhase(page: Page, click: () => Promise<void>, phase: string): Promise<number> {
  const watch = page.evaluate(
    (p) =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          if (document.querySelector('[data-testid="game-board-container"]')?.getAttribute("data-phase") === p) resolve(performance.now() - t0);
          else if (performance.now() - t0 > 5_000) resolve(Infinity);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    phase,
  );
  await click();
  return watch;
}

test.describe("optimistic offers", { tag: p2("@local-only") }, () => {
  test("draw and rematch offers render before the ack; a negative ack rolls back", { tag: gameTags("state", ["draw_sent", "over_rematch_sent", "over_rematch_declined"]) }, async ({ seat, seedGame }) => {
    const a = await seat("L");
    const b = await seat("M");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await s.w.move("e2e4");
    await s.b.move("e7e5");
    await s.w.waitPly(2);

    // 1. A real offer with a 300 ms delay on every frame A sends: draw_sent before the server has it.
    s.w.link.delayOutgoing(300);
    const msDraw = await msUntilPhase(s.w.page, () => s.w.byTestId("offer-draw-button").click(), "draw_sent");
    expect(msDraw).toBeLessThan(250);
    await s.b.waitPhase("draw_received");
    await s.b.page.getByTestId("decline-draw").click();
    await s.w.waitPhase("draw_declined");
    s.w.link.delayOutgoing(0);

    // Two own moves later the offer is allowed again (plan 8.7).
    await s.w.move("g1f3");
    await s.b.move("b8c6");
    await s.w.move("f1c4");
    await s.b.move("g8f6");
    await expect(s.w.byTestId("offer-draw-button")).toBeEnabled({ timeout: 10_000 });

    // 2. Forced negative ack: the offer shows at once, then rolls back with the cooldown toast.
    s.w.link.forceAck("draw:offer", { ok: false, code: "draw_cooldown", canOfferAtPly: (await s.w.ply()) + 2 }, 300);
    await s.w.byTestId("offer-draw-button").click();
    await s.w.waitPhase("draw_sent", 1_000);
    await expect(s.w.page.getByTestId("game-toast")).toContainText(/offer again/i, { timeout: 5_000 });
    await expect(s.w.page.locator('[data-testid="game-board-container"]')).not.toHaveAttribute("data-phase", "draw_sent");
    await expect(s.b.page.getByTestId("draw-offer-bar")).toHaveCount(0);

    // 3. After the game: the rematch offer renders before its ack.
    await s.b.board.resign();
    await s.w.waitPhase("over_resign_win");
    s.w.link.delayOutgoing(300);
    const msRematch = await msUntilPhase(s.w.page, () => s.w.page.getByTestId("rematch-button").click(), "over_rematch_sent");
    expect(msRematch).toBeLessThan(250);
    await s.b.waitPhase("over_rematch_received");
    await s.b.page.getByTestId("decline-rematch").click();
    await s.w.waitPhase("over_rematch_declined");
  });
});
