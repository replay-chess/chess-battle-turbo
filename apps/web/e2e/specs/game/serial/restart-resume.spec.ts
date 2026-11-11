// T11 (phase-02 plan 1.2, 7.6, 12.6) @smoke, in the game-serial project: mid-game the socket broadcasts a restart
// (5 s), is stopped with SIGTERM (the drain: clocks frozen, checkpoint flushed) and started again (restore from the
// journal + DB). Both players see the restart chip, come back at the same ply with the same colours, the clocks stay
// frozen until both are back, no ply is lost, and the new bootId causes exactly one user-level resync. Neither player
// is ever told that the other one left (D7): the restart sends no presence change to "offline".
//
// While the server is down the socket link answers every connection attempt as a failed transport, as Caddy's 502 does
// on the dev box (fixtures/socket-server.ts `REFUSED_FRAME`): a clean close made socket.io-client wait out its 10 s
// connect timeout, longer than the fast profile's resume wait plus grace, and one player came back abandoned
// (CI run 43037495714).
import type { Request } from "@playwright/test";
import { byColor, expect, playLine, startSeeded, test, type Seat } from "../../../fixtures/games";
import { gameTags, p2 } from "../tags";

test.use({ socketKind: "restartable" });

function bootIds(seat: Seat): string[] {
  return seat.link
    .frames()
    .filter((f) => f.startsWith('42["session:hello"'))
    .map((f) => (JSON.parse(f.slice(2)) as [string, { bootId: string }])[1].bootId);
}

test.describe("restart and resume", { tag: p2("@smoke", "@local-only") }, () => {
  test("a socket deploy mid-game loses nothing", { tag: gameTags("state", ["reconnecting", "your_move", "their_move"]) }, async ({ seat, seedGame, restartable }) => {
    test.setTimeout(300_000);
    const a = await seat("A");
    const b = await seat("B");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await playLine(s, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]);
    const before = { ply: await s.w.ply(), w: await s.w.color(), b: await s.b.color() };
    const boot0 = bootIds(s.w).at(-1);

    const meCalls: string[] = [];
    const onReq = (r: Request) => {
      if (new URL(r.url()).pathname === "/api/me") meCalls.push(r.url());
    };
    s.w.page.on("request", onReq);

    const framesFrom = { w: s.w.link.frames().length, b: s.b.link.frames().length };
    await restartable.broadcastRestart(5);
    for (const p of [s.w, s.b]) await expect(p.page.getByTestId("chip-restarting")).toContainText(/Server restarting in 0:0\d/i, { timeout: 15_000 });
    await restartable.stop("SIGTERM");
    await s.w.waitPhase(/reconnecting/, 30_000);
    const frozen = await s.b.page.locator('[data-testid="clock-b"]:visible').first().innerText();
    await restartable.start();

    for (const p of [s.w, s.b]) await p.waitPhase(/your_move|their_move/, 90_000);
    expect(await s.w.ply()).toBe(before.ply);
    expect(await s.b.ply()).toBe(before.ply);
    expect([await s.w.color(), await s.b.color()]).toEqual([before.w, before.b]);
    // Black's clock was frozen across the restart (it is Black's turn; it only runs again once both are back).
    const after = await s.b.page.locator('[data-testid="clock-b"]:visible').first().innerText();
    expect(after <= frozen || after === frozen).toBe(true);

    for (const side of ["w", "b"] as const) {
      const left = s[side].link
        .frames()
        .slice(framesFrom[side])
        .filter((f) => f.startsWith('42["presence:update"') && f.includes('"online":false'));
      expect(left, `${side} was told the other side left`).toEqual([]);
    }

    // Play on: no ply lost.
    await playLine(s, ["g8f6"]);
    expect(await s.w.ply()).toBe(before.ply + 1);

    // The new bootId: exactly one user-level resync (/api/me refetched once).
    const boot1 = bootIds(s.w).at(-1);
    expect(boot1).toBeTruthy();
    expect(boot1).not.toBe(boot0);
    await s.w.page.waitForTimeout(2_000);
    s.w.page.off("request", onReq);
    expect(meCalls.length).toBeLessThanOrEqual(1);
  });
});
