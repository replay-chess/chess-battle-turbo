// Nightly (@slow) copy of opponent-offline.spec.ts with the real 30 s reconnect grace on the app's socket.
import { test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";
import { opponentOffline } from "./timers";

test.describe("opponent offline (real timing)", { tag: p2("@slow", "@local-only") }, () => {
  test("30 s grace runs out → abandoned", { tag: gameTags("state", ["over_abandoned"]) }, async ({ seat, seedGame }) => {
    test.setTimeout(240_000);
    await opponentOffline({ seat, seedGame }, ["M", "N"], 31_000);
  });
});
