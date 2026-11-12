// In-game auth refresh (phase-02 plan 4.7, 5.5.1, 10.1, 12.6; the V3SessionExpired states P1 deferred to P2): A's Clerk
// session is revoked with the Backend API mid-game and A's socket is dropped; the reconnect is refused `unauthorized`
// and the token endpoint answers 401, so the screen shows `in_game_refresh` (the board stays). A's Clerk notices the
// revocation too, and the "You've Been Signed Out" modal is held back while the game is on (plan: "In a live game the
// modal is deferred until game:ended"). A signs in again in another tab, the way a player can mid-game; the next
// token retry succeeds, the socket comes back with `in_game_ok`, and A's next move reaches B.
//
// Not an in-page `clerk.signIn` on the game tab: Clerk's setActive first awaits the Next provider's cache-invalidating
// server action, a POST to /game/<ref> made with the dead session cookie, which the middleware answers with a
// cross-origin redirect to sign-in; the action never settles and setActive hangs (the old version of this spec timed
// out there on every run). No player signs in from inside the game page.
import { signIn } from "../../fixtures/auth";
import { byColor, expect, planEvent, startSeeded, test } from "../../fixtures/games";
import { letterEmail } from "../../fixtures/users";
import { p2 } from "./tags";

// @smoke: the PR e2e-smoke job (chromium + webkit-iphone) runs it; it needs only what that job has (the Clerk development
// keys for the Backend API revoke and the ticket sign-in, and the local socket servers for the link).
test.describe("in-game auth refresh", { tag: p2("@smoke", "@local-only") }, () => {
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
      // Clerk loads after the board (a production build under a busy run takes seconds): wait for its session.
      const readSessionId = () =>
        page.evaluate(() => (window as unknown as { Clerk?: { session?: { id?: string } } }).Clerk?.session?.id ?? null);
      await expect.poll(readSessionId, { message: "Clerk's session on the game page", timeout: 30_000 }).toBeTruthy();
      const sessionId = await readSessionId();
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

      // A's Clerk learns the session is gone (as its next token poll would): no modal over the board while the game is
      // on, past the 1.5 s flip debounce; the chip carries the state.
      await page.evaluate(async () => {
        const c = (window as unknown as { Clerk?: { session?: { getToken: (o: object) => Promise<unknown> } | null } })
          .Clerk;
        await c?.session?.getToken({ skipCache: true }).catch(() => null);
      });
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session ?? null), {
          timeout: 30_000,
        })
        .toBeNull();
      await page.waitForTimeout(3_000);
      await expect(page.getByTestId("session-expired-modal")).toHaveCount(0);
      await expect(page.getByTestId("chip-auth-refresh")).toBeVisible();

      // Signed in again in another tab (a new session; the cookies are shared): the next retry gets a token and the
      // socket is back.
      s.w.link.refuseWith(null);
      const tab = await page.context().newPage();
      await signIn(tab, letterEmail(s.w.letter), "");
      await tab.close();
      await expect(page.getByTestId("chip-auth-ok")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("session-expired-modal")).toHaveCount(0);
      await s.w.move("g1f3");
      await s.b.waitPly(3, 30_000);
      await planEvent(telemetry, "in_game_auth_refresh", { result: "ok" }, { source: "client" });
    },
  );
});
