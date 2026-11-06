// Automatic draws (phase-02 plan 8.5, 12.6): threefold repetition with knights out and back twice (G-THREEFOLD).
import { byColor, expect, playLine, finishedSnapshot, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("threefold", { tag: p2("@local-only") }, () => {
  test("knights out and back twice ends the game", { tag: gameTags("state", ["over_threefold"]) }, async ({ seat, seedGame }) => {
    const a = await seat("J");
    const b = await seat("K");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await playLine(s, ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"]);
    await s.b.move("f6g8");
    await s.w.waitPhase("over_threefold");
    await s.b.waitPhase("over_threefold");
    const snap = await finishedSnapshot(s.w, g.ref);
    expect(snap.result?.method).toBe("threefold");
  });
});
