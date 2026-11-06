// First-move window (phase-02 plan 8.3, 12.6) on the fast fixture socket (3 s window): nobody moves → over_aborted
// on both sides, the DB row ABORTED, `game_aborted{reason: timeout}` once per player (by self / opponent).
// Nightly copy with the real 30 s: first-move-abort.real.spec.ts (@slow).
import { test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";
import { firstMoveAbort } from "./timers";

test.use({ socketKind: "fast" });

test.describe("first-move abort", { tag: p2("@local-only") }, () => {
  test("nobody moves within the window", { tag: gameTags("state", ["abort", "over_aborted"]) }, async ({ seat, seedGame, telemetry }) => {
    await firstMoveAbort({ seat, seedGame, telemetry }, ["C", "D"], 6_000);
  });
});
