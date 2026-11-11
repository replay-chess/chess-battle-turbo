// T4 (phase-02 plan 1.2, 5.2.5, 8.18, 12.6) †: a premove set during the opponent's turn is sent with `premove: true`
// the moment they move; a premove the opponent's move made illegal is dropped with `premove_cancelled`. The first
// premove is set by click-click, the second by a mouse drag (D8). Once a premove fired, "Premove set" is gone (D10).
import { byColor, expect, playLine, sentCommands, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("premove", { tag: p2("@local-only") }, () => {
  test("fires on the opponent's move, or is cancelled when it became illegal", { tag: gameTags("state", ["premove", "premove_cancelled"]) }, async ({ seat, seedGame }) => {
    const a = await seat("I");
    const b = await seat("J");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await playLine(s, ["e2e4", "d7d5", "b1c3"]);

    // Black to move. White premoves Nf3; Black plays a quiet move; the premove fires.
    const w = s.w.page;
    await w.locator('[data-square="g1"]').click();
    await w.locator('[data-square="f3"]').click();
    await s.w.waitPhase("premove");
    await expect(w.getByTestId("game-toast")).toContainText(/Premove set/i);
    const p = await s.w.ply();
    await s.b.move("g8f6");
    await s.b.waitPly(p + 2);
    const sent = sentCommands(s.w, "game:move").find((c) => c.uci === "g1f3");
    expect(sent?.premove).toBe(true);
    await expect(w.getByTestId("game-toast").filter({ hasText: /Premove set/i })).toHaveCount(0);

    // Black to move again (… Nf6 2.Nf3). White premoves exd5; Black captures on e4 first: the premove is cancelled.
    await s.w.drag("e4", "d5");
    await s.w.waitPhase("premove");
    await s.b.move("d5e4");
    await s.w.waitPhase("premove_cancelled");
    expect(sentCommands(s.w, "game:move").some((c) => c.uci === "e4d5")).toBe(false);
  });
});
