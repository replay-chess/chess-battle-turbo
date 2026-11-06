// already_ended (phase-02 plan 4.3, 12.6): a finished game (G-ENDED, the main line to mate with a stored PGN) opens on
// the result with the "already ended" note and an Analyse link; the PGN route serves it to a player, `no-store`.
import { expect, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("already ended", { tag: p2("@local-only") }, () => {
  test("opening a finished game", { tag: gameTags("state", ["already_ended"]) }, async ({ seat, seedGame }) => {
    const a = await seat("F");
    const b = await seat("G");
    // Ended ten minutes ago: older than ALREADY_ENDED_AFTER_MS (2 min), so the screen says it ended earlier.
    const g = await seedGame("G-ENDED", a, b, { endedMinutesAgo: 10 });
    await a.open(g.ref);
    await a.waitPhase("already_ended");
    await expect(a.page.getByTestId("zone-ended")).toBeVisible();
    await expect(a.page.locator('a[href^="/analysis/"]:visible').first()).toBeVisible();

    const pgn = await a.page.request.get(`/api/games/${g.ref}/pgn`);
    expect(pgn.status()).toBe(200);
    expect(pgn.headers()["cache-control"]).toContain("no-store");
    expect(await pgn.text()).toContain("%clk");
  });
});
