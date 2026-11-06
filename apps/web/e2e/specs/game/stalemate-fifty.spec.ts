// Automatic draws (phase-02 plan 8.5, 12.6): stalemate (G-STALEMATE, 59.Qf7) and the fifty-move rule (G-FIFTY,
// halfmove clock 98 → two quiet moves).
import { byColor, expect, finishedSnapshot, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("stalemate and fifty-move", { tag: p2("@local-only") }, () => {
  test("59.Qf7 is stalemate", { tag: gameTags("state", ["over_stalemate"]) }, async ({ seat, seedGame }) => {
    const a = await seat("L");
    const b = await seat("M");
    const g = await seedGame("G-STALEMATE", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await s.w.move("e7f7");
    await s.w.waitPhase("over_stalemate");
    await s.b.waitPhase("over_stalemate");
    expect((await finishedSnapshot(s.w, g.ref)).result?.method).toBe("stalemate");
  });

  test("the hundredth quiet half-move is a draw", { tag: gameTags("state", ["over_fifty"]) }, async ({ seat, seedGame }) => {
    const a = await seat("N");
    const b = await seat("O");
    const g = await seedGame("G-FIFTY", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await s.w.move("a1a2");
    await s.b.move("h1h2");
    await s.w.waitPhase("over_fifty");
    await s.b.waitPhase("over_fifty");
    expect((await finishedSnapshot(s.w, g.ref)).result?.method).toBe("fifty_move");
  });
});
