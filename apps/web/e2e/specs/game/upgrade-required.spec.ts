// Protocol upgrade (phase-02 plan 7.4.1, 12.3 compat, 12.6): a client without `proto` is refused with
// `upgrade_required` by a server running PROTOCOL_V1=off (the fast fixture socket); a game page whose reconnect is
// refused that way shows "Update ready · installs after this game" and keeps the board.
import { byColor, expect, socketCommand, startSeeded, test } from "../../fixtures/games";
import { FAST_SOCKET_PORT } from "../../fixtures/socket-server";
import { p2 } from "./tags";

test.use({ socketKind: "fast" });

test.describe("upgrade required", { tag: p2("@local-only") }, () => {
  test("a v1 handshake is refused; a refused reconnect shows the update chip", async ({ seat, seedGame }) => {
    const a = await seat("C");
    const b = await seat("D");
    const tokenRes = await a.page.request.get("/api/socket-token");
    const token = ((await tokenRes.json()) as { data: { token: string } }).data.token;
    expect(await socketCommand(token, "game:sync", { ref: "x" }, { port: FAST_SOCKET_PORT, proto: null })).toEqual({ connectError: "upgrade_required" });

    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await s.w.move("e2e4");
    await s.b.move("e7e5");
    await s.w.waitPly(2);

    // The server now refuses this client's protocol (as a server one protocol ahead would).
    s.w.link.refuseWith("upgrade_required");
    await s.w.link.setDown(true);
    await s.w.link.setDown(false);
    await expect(s.w.page.getByTestId("chip-upgrade")).toHaveText(/Update ready · installs after this game/, { timeout: 30_000 });
    await expect(s.w.page.locator("[data-square]").first()).toBeVisible();
    s.w.link.refuseWith(null);
  });

  // During a bot game the update must wait for game:ended before reloading (plan 12.6). No such reload exists on the
  // client yet (request to WP-G in the WP-I hand-back).
  test.fixme("during a bot game the reload waits for the end", async () => {});
});
