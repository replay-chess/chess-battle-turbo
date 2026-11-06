// T10 (phase-02 plan 1.2, 8.6, 12.6) on the fast fixture socket (3 s grace): B's network drops after two plies; A sees
// "…disconnected. They have 30 seconds to reconnect.", the ring counting to the server's graceEndsAt, then
// over_abandoned. Nightly copy with the real 30 s grace: opponent-offline.real.spec.ts (@slow).
import { test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";
import { opponentOffline } from "./timers";

test.use({ socketKind: "fast" });

test.describe("opponent offline", { tag: p2("@local-only") }, () => {
  test("grace runs out → abandoned", { tag: gameTags("state", ["opp_disconnected", "over_abandoned"]) }, async ({ seat, seedGame }) => {
    await opponentOffline({ seat, seedGame }, ["M", "N"], 6_000);
  });
});
