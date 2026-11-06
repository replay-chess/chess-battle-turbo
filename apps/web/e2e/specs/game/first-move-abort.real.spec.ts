// Nightly (@slow) copy of first-move-abort.spec.ts with the real 30 s first-move window on the app's socket.
import { test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";
import { firstMoveAbort } from "./timers";

test.describe("first-move abort (real timing)", { tag: p2("@slow", "@local-only") }, () => {
  test("nobody moves within 30 s", { tag: gameTags("state", ["over_aborted"]) }, async ({ seat, seedGame, telemetry }) => {
    test.setTimeout(240_000);
    await firstMoveAbort({ seat, seedGame, telemetry }, ["C", "D"], 31_000);
  });
});
