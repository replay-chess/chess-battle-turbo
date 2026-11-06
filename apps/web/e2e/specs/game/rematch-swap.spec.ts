// T12 (phase-02 plan 1.2, 8.8, 12.6): after a finished game on a legend position (G-STUDY) A offers a rematch, B
// accepts: both land on the new game, which starts with the study phase (`rematch_study`), colours swapped and the
// "…accepted. Colours swapped: you play Black." toast.
import { byColor, expect, snapshot, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("rematch", { tag: p2("@local-only") }, () => {
  test(
    "offer, accept, colours swapped",
    { tag: gameTags("state", ["over_rematch_sent", "over_rematch_received", "rematch_study"]) },
    async ({ seat, seedGame }) => {
      const a = await seat("I");
      const b = await seat("J");
      const g = await seedGame("G-STUDY", a, b);
      await Promise.all([a.open(g.ref), b.open(g.ref)]);
      const s = await byColor(a, b);
      await s.w.waitPhase(/^study/, 60_000);
      await s.w.page.getByTestId("study-ready").click();
      await s.b.page.getByTestId("study-ready").click();
      await expect.poll(async () => (await s.w.phase()) + (await s.b.phase()), { timeout: 30_000 }).toMatch(/abort/);
      // The side to move plays, the other side too, then White resigns.
      const turn = await s.w.turn();
      const other = turn === "w" ? "b" : "w";
      await s[turn].board.playValidMove(turn);
      await s[other].waitPhase("abort");
      await s[other].board.playValidMove(other);
      await s.w.page.waitForTimeout(500);
      await s.w.board.resign();
      await s.w.waitPhase("over_resign_loss");

      await s.w.page.getByTestId("rematch-button").click();
      await s.w.waitPhase("over_rematch_sent");
      await s.b.waitPhase("over_rematch_received");
      await expect(s.b.page.getByTestId("rematch-offer-bar")).toBeVisible();
      await s.b.page.getByTestId("accept-rematch").click();

      for (const p of [s.w.page, s.b.page]) await p.waitForURL((u) => u.pathname.startsWith("/game/") && !u.pathname.endsWith(g.ref), { timeout: 60_000 });
      const newRef = new URL(s.w.page.url()).pathname.split("/game/")[1]!;
      expect(new URL(s.b.page.url()).pathname).toBe(`/game/${newRef}`);
      // Colours swapped: the old White now plays Black.
      await expect.poll(() => s.w.color(), { timeout: 60_000 }).toBe("b");
      await expect.poll(() => s.b.color(), { timeout: 60_000 }).toBe("w");
      await s.w.waitPhase("rematch_study");
      await s.b.waitPhase("rematch_study");
      await expect(s.w.page.getByTestId("game-toast")).toContainText(/accepted\. Colours swapped: you play Black\./i);
      const snap = await snapshot(s.b, newRef);
      expect(snap.status).toBe("IN_PROGRESS");
    },
  );
});
