// In-game auth refresh (phase-02 plan 10.1, 12.6; the V3SessionExpired states P1 deferred to P2): A's Clerk session is
// revoked with the Backend API mid-game and A's socket is dropped; the reconnect is refused `unauthorized` and the
// token endpoint answers 401, so the screen shows `in_game_refresh` (the board stays); once A is signed in again the
// socket comes back with `in_game_ok` and the queued move reaches B.
import { clerk } from "@clerk/testing/playwright";
import { byColor, expect, planEvent, startSeeded, test } from "../../fixtures/games";
import { letterEmail } from "../../fixtures/users";
import { p2 } from "./tags";

test.describe("in-game auth refresh", { tag: p2("@local-only") }, () => {
  test(
    "session revoked mid-game: refresh chip, then recovered",
    { tag: ["@state:V3SessionExpired.in_game_refresh", "@state:V3SessionExpired.in_game_ok"] },
    async ({ seat, seedGame, telemetry }) => {
      test.setTimeout(240_000);
      const a = await seat("J");
      const b = await seat("K");
      const g = await seedGame("G-THREEFOLD", a, b);
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);
      await s.w.move("e2e4");
      await s.b.move("e7e5");
      await s.w.waitPly(2);

      // Revoke White's session (Clerk development instance, Backend API).
      const page = s.w.page;
      const sessionId = await page.evaluate(() => (window as unknown as { Clerk?: { session?: { id?: string } } }).Clerk?.session?.id ?? null);
      expect(sessionId).toBeTruthy();
      const revoke = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      });
      expect(revoke.status).toBe(200);

      // The socket drops; the reconnect's token is refused until a fresh token can be minted.
      s.w.link.refuseWith("unauthorized");
      await s.w.link.setDown(true);
      await s.w.link.setDown(false);
      await expect(page.getByTestId("chip-auth-refresh")).toBeVisible({ timeout: 30_000 });
      // The board stays on screen with the position (a move made now is not queued yet: WP-G request in the hand-back).
      await expect(page.locator('[data-square="e4"]')).toBeVisible();

      // Signed in again (a new session); the next retry gets a token and the socket is back.
      s.w.link.refuseWith(null);
      await clerk.signIn({ page, emailAddress: letterEmail(s.w.letter) });
      await expect(page.getByTestId("chip-auth-ok")).toBeVisible({ timeout: 30_000 });
      await s.w.move("g1f3");
      await s.b.waitPly(3, 30_000);
      await planEvent(telemetry, "in_game_auth_refresh", { result: "ok" }, { source: "client" });
    },
  );
});
