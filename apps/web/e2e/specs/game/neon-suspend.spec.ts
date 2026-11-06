// Neon suspend mid-game (phase-02 plan 12.9, feasibility F-OCI-4): weekly in nightly.yml against the dev URL and the
// dev socket, never locally by default. A fixture game is played to ply 6, the dev branch's compute is suspended with
// the Neon API (what scale-to-zero does), the game is played on to a resignation, and the database must hold every
// ply, the clocks and the result. Sentry should show ws.persist.reconnect and no ws.persist.fail (checked by hand in
// the sign-off). Needs E2E_BASE_URL (the dev URL), NEON_API_KEY, NEON_PROJECT_ID and NEON_ENDPOINT_ID (the dev
// branch's endpoint; never the production branch), and DIRECT_URL of the dev branch for the fixture writer.
import { byColor, expect, finishedSnapshot, playLine, startSeeded, test } from "../../fixtures/games";
import { p2 } from "./tags";

const NEON = process.env.NEON_API_KEY;
const PROJECT = process.env.NEON_PROJECT_ID;
const ENDPOINT = process.env.NEON_ENDPOINT_ID;
const DEV_ENDPOINT = /^ep-fancy-dust-b8b3dp81$/;

test.describe("neon suspend", { tag: p2("@neon-suspend") }, () => {
  test.skip(!process.env.E2E_NEON_SUSPEND || !NEON || !PROJECT || !ENDPOINT, "weekly nightly job only (E2E_NEON_SUSPEND=1 + Neon API env)");

  test("a game survives a compute suspend", async ({ seat, seedGame }) => {
    test.setTimeout(600_000);
    expect(ENDPOINT, "only the dev branch's endpoint may be suspended").toMatch(DEV_ENDPOINT);
    const a = await seat("O");
    const b = await seat("P");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);
    const s = await byColor(a, b);
    await playLine(s, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"]);

    const res = await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}/endpoints/${ENDPOINT}/suspend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${NEON}`, Accept: "application/json" },
    });
    expect(res.status, "Neon suspend").toBeLessThan(300);
    await s.w.page.waitForTimeout(10_000);

    await playLine(s, ["d2d3", "f8c5", "b1c3", "d7d6", "c1g5", "h7h6"]);
    await s.w.board.resign();
    const snap = await finishedSnapshot(s.b, g.ref);
    expect(snap.result).toMatchObject({ method: "resignation", winner: "b" });
    expect((snap as unknown as { moves: string[] }).moves).toHaveLength(12);
  });
});
