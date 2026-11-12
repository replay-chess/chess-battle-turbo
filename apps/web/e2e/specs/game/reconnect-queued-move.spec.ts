// Reconnect with a queued move (phase-02 plan 5.2.4, 12.6): A loses the network on their turn and moves (ghost +
// "reconnecting" with the queued copy); back after 5 s the outbox sends it: "Back online. … was sent." and the move
// is on B's board.
import { byColor, expect, expectOneGameScreen, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("reconnect with a queued move", { tag: p2("@local-only") }, () => {
  test("the outbox sends the move after the reconnect", { tag: gameTags("state", ["reconnecting", "reconnected"]) }, async ({ seat, seedGame }) => {
    const a = await seat("O");
    const b = await seat("P");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await s.w.move("e2e4");
    await s.b.move("e7e5");
    await s.w.waitPly(2);

    await s.w.context.setOffline(true);
    await s.w.link.setDown(true);
    await s.w.waitPhase("reconnecting", 30_000);
    await expect(s.w.page.getByTestId("zone-reconnect")).toBeVisible();
    await s.w.move("g1f3", { waitTurn: false });
    await expect(s.w.page.getByTestId("zone-reconnect")).toContainText(/queued|will be sent|sent when/i);
    await s.w.page.waitForTimeout(5_000);

    await s.w.link.setDown(false);
    await s.w.context.setOffline(false);
    await s.w.waitPhase("reconnected", 45_000);
    await expect(s.w.page.getByTestId("game-toast")).toContainText(/Back online\..*was sent/i);
    await s.b.waitPly(3, 30_000);
    // The reconnect replaced nothing: one game screen on each side.
    await expectOneGameScreen(s.w.page);
    await expectOneGameScreen(s.b.page);
  });
});
