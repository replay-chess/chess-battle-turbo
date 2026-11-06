// T8 (phase-02 plan 1.2, 8.7, 12.6) †: offer → decline (button disabled for 2 own moves) → offer → accept.
import { byColor, expect, planEvent, finishedSnapshot, startSeeded, test, type Seat } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

async function offerDraw(s: Seat) {
  const button = s.byTestId("offer-draw-button");
  if (await button.isVisible().catch(() => false)) return button.click();
  await s.byTestId("game-menu-button").click();
  await s.page.getByTestId("offer-draw-menu-item").click();
}

test.describe("draw offer", { tag: p2("@local-only") }, () => {
  test(
    "decline, cooldown for two own moves, then accept",
    { tag: gameTags("state", ["draw_sent", "draw_received", "draw_declined", "over_agreement"]) },
    async ({ seat, seedGame, telemetry }) => {
      const a = await seat("H");
      const b = await seat("I");
      const g = await seedGame("G-THREEFOLD", a, b);
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);
      await s.w.move("e2e4");
      await s.b.move("e7e5");
      await s.w.waitPly(2);

      // White offers on their own turn; Black sees the offer bar.
      await offerDraw(s.w);
      await s.w.waitPhase("draw_sent");
      await s.b.waitPhase("draw_received");
      await expect(s.b.page.getByTestId("draw-offer-bar")).toContainText(/offers a draw/i);
      await s.b.page.getByTestId("decline-draw").click();
      await s.w.waitPhase("draw_declined");
      await expect(s.w.page.getByTestId("game-toast")).toContainText(/declined the draw\. You can offer again in 2 moves/i);
      await planEvent(telemetry, "draw_offered", undefined, { source: "client" });

      // Cooldown: the offer stays disabled for two of White's own moves (plan 8.7: ply + 4).
      await s.w.move("g1f3");
      await s.b.move("b8c6");
      await expect(s.w.byTestId("offer-draw-button")).toBeDisabled();
      await s.w.move("f1c4");
      await s.b.move("g8f6");
      await expect(s.w.byTestId("offer-draw-button")).toBeEnabled({ timeout: 10_000 });

      await offerDraw(s.w);
      await s.b.waitPhase("draw_received");
      await s.b.page.getByTestId("accept-draw").click();
      await s.w.waitPhase("over_agreement");
      await s.b.waitPhase("over_agreement");
      await planEvent(telemetry, "draw_answered", { accepted: true }, { source: "client" });

      const snap = await finishedSnapshot(s.w, g.ref);
      expect(snap.status).toBe("COMPLETED");
      expect(snap.result?.method).toBe("agreement");
      expect(snap.result?.winner ?? null).toBeNull();
    },
  );
});
