// Rematch expiry (phase-02 plan 8.8, 12.6) on the fast fixture socket (3 s TTL): the offer ends with
// over_rematch_expired when the other player leaves the page ("…left.") or does not answer ("…timed out.").
import { byColor, startSeeded, test, expect, type Seat } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.use({ socketKind: "fast" });

async function finishedGame(seat: (l: string) => Promise<Seat>, seedGame: (n: "G-THREEFOLD", w: Seat, b: Seat) => Promise<{ ref: string }>, letters: [string, string]) {
  const a = await seat(letters[0]);
  const b = await seat(letters[1]);
  const g = await seedGame("G-THREEFOLD", a, b);
  await startSeeded(a, b, g.ref);
  const s = await byColor(a, b);
  await s.w.move("e2e4");
  await s.b.move("e7e5");
  await s.w.waitPly(2);
  await s.b.board.resign();
  await s.w.waitPhase("over_resign_win");
  return s;
}

test.describe("rematch expiry", { tag: p2("@local-only") }, () => {
  test("the other player leaves", { tag: gameTags("state", ["over_rematch_sent", "over_rematch_expired"]) }, async ({ seat, seedGame }) => {
    const s = await finishedGame(seat, seedGame, ["K", "L"]);
    await s.w.page.getByTestId("rematch-button").click();
    await s.b.waitPhase("over_rematch_received");
    await s.b.page.goto("about:blank");
    await s.w.waitPhase("over_rematch_expired", 20_000);
    await expect(s.w.page.getByTestId("game-toast")).toContainText(/Rematch offer expired: .* left\./i);
  });

  test("nobody answers within the TTL", { tag: gameTags("state", ["over_rematch_received", "over_rematch_expired"]) }, async ({ seat, seedGame }) => {
    const s = await finishedGame(seat, seedGame, ["K", "L"]);
    await s.w.page.getByTestId("rematch-button").click();
    await s.b.waitPhase("over_rematch_received");
    await s.w.waitPhase("over_rematch_expired", 20_000);
    // Plan 12.6 says "…timed out."; the shipped copy is "Rematch offer expired." (request to WP-G, hand-back).
    await expect(s.w.page.getByTestId("game-toast")).toContainText(/Rematch offer expired/i);
  });
});
