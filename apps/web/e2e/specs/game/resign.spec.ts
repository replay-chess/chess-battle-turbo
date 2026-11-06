// T9 (phase-02 plan 1.2, 12.6): ⋯ → Resign… → Keep playing → Resign… → Resign. Focus starts on Keep playing; the
// loser sees over_resign_loss, the winner over_resign_win, both with the flag badge; the DB holds the result.
import { byColor, expect, planEvent, finishedSnapshot, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("resign", { tag: p2("@local-only") }, () => {
  test(
    "resign confirm: keep playing, then resign",
    { tag: gameTags("state", ["abort", "their_move", "your_move", "viewing", "resign_confirm", "over_resign_loss", "over_resign_win"]) },
    async ({ seat, seedGame, telemetry }) => {
      const a = await seat("F");
      const b = await seat("G");
      const g = await seedGame("G-THREEFOLD", a, b);
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);

      await s.w.waitPhase("abort");
      await s.b.waitPhase("their_move");
      await s.w.move("e2e4");
      await s.b.waitPhase("abort");
      await s.b.move("e7e5");
      await s.w.waitPhase("your_move");
      await s.w.move("g1f3");
      await s.w.waitPhase("their_move");

      const page = s.w.page;
      // Stepping back through the moves (←) shows `viewing`; → back to the live position.
      await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.keyboard.press("ArrowLeft");
      await s.w.waitPhase("viewing");
      await page.keyboard.press("ArrowRight");
      await s.w.waitPhase("their_move");

      // White resigns on Black's turn.
      await s.w.byTestId("game-menu-button").click();
      await s.w.byTestId("resign-button").click();
      await s.w.waitPhase("resign_confirm");
      await expect(page.getByTestId("keep-playing-button")).toBeFocused();
      await page.getByTestId("keep-playing-button").click();
      await s.w.waitPhase("their_move");
      await planEvent(telemetry, "resign_cancelled", undefined, { source: "client" });

      await s.w.byTestId("game-menu-button").click();
      await s.w.byTestId("resign-button").click();
      await page.getByTestId("confirm-resign-button").click();
      await s.w.waitPhase("over_resign_loss");
      await s.b.waitPhase("over_resign_win");
      await expect(page.getByTestId("game-result-method")).toContainText(/resign/i);
      await expect(page.locator('[data-badge="flag"]')).toHaveCount(1);
      await planEvent(telemetry, "resign_confirmed", undefined, { source: "client", count: 1 });

      const snap = await finishedSnapshot(s.b, g.ref);
      expect(snap.status).toBe("COMPLETED");
      expect(snap.result?.method).toBe("resignation");
      expect(snap.result?.winner).toBe("b");
    },
  );
});
