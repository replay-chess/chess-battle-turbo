// T15 (phase-02 plan 1.2, 5.3.2, 12.6): a bot game opened in a fresh browser context (no local journal) resumes from
// the server checkpoint (G-BOT-MID: 20 plies).
import { expect, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("bot resume on another device", { tag: p2("@local-only") }, () => {
  test("a fresh context resumes from the checkpoint", { tag: gameTags("state", ["bot"]) }, async ({ seat, seedGame }) => {
    const me = await seat("P");
    const other = await seat("G");
    const g = await seedGame("G-BOT-MID", me, other); // White = me; the bot plays Black
    await me.open(g.ref);
    await me.waitPhase("bot", 120_000);
    await me.waitPly(20, 30_000);
    await expect(me.page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-current-turn", "w");
  });
});
