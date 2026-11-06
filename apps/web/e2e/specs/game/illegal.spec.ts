// T5 (phase-02 plan 1.2, 8.17, 12.6): an illegal move shakes and explains itself in plain English, client-side only
// (no socket command, no HTTP request). A pinned knight and a blocked rook.
import type { Request } from "@playwright/test";
import { byColor, expect, playLine, sentCommands, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("illegal moves", { tag: p2("@local-only") }, () => {
  test("pinned knight and blocked rook are explained", { tag: gameTags("state", ["illegal"]) }, async ({ seat, seedGame }) => {
    const a = await seat("G");
    const b = await seat("H");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    // 1.e4 d6 2.d4 Nc6 3.Bb5: the knight on c6 is pinned to the king on e8.
    await playLine(s, ["e2e4", "d7d6", "d2d4", "b8c6", "f1b5"]);

    const page = s.b.page;
    const requests: string[] = [];
    const onRequest = (r: Request) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
    };
    page.on("request", onRequest);
    const movesBefore = sentCommands(s.b, "game:move").length;

    await s.b.drag("c6", "e5");
    await s.b.waitPhase("illegal");
    await expect(page.getByTestId("game-toast")).toContainText(/the knight on c6 is pinned to your king/i);
    await expect(page.locator("[data-shake]").first()).toBeAttached();

    // A rook boxed in by its own pawn.
    await s.b.drag("a8", "a5");
    await expect(page.getByTestId("game-toast")).toContainText(/block/i);

    await page.waitForTimeout(500);
    page.off("request", onRequest);
    expect(requests, "an illegal move makes no HTTP request").toEqual([]);
    expect(sentCommands(s.b, "game:move").length, "an illegal move sends no socket command").toBe(movesBefore);
  });
});
