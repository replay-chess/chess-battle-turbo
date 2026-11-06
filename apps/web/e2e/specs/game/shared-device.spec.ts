// Shared device (phase-02 plan 11.2 rule 13, 12.6; api-perf AP-04): member A opens a finished game and downloads its
// PGN, signs out from the account menu; member B signs in in the same browser context and requests the same URLs.
// Every answer comes from the network (no HTTP-cache or service-worker hit); B gets PGN 403 and never A's player
// view of the snapshot (404, or the spectator projection of a watchable game).
import type { Page } from "@playwright/test";
import { signIn } from "../../fixtures/auth";
import { expect, test } from "../../fixtures/games";
import { letterEmail } from "../../fixtures/users";
import { p2 } from "./tags";

/** Fetches `url` in the page and reports the status and whether the bytes came over the network. */
async function fetchFresh(page: Page, url: string): Promise<{ status: number; network: boolean }> {
  return page.evaluate(async (u) => {
    performance.clearResourceTimings();
    const res = await fetch(u, { credentials: "same-origin" });
    await res.arrayBuffer();
    const entry = performance.getEntriesByType("resource").find((e) => e.name.endsWith(u)) as PerformanceResourceTiming | undefined;
    // transferSize 0 with a body = served from the HTTP cache (or a service worker).
    return { status: res.status, network: entry ? entry.transferSize > 0 : true };
  }, url);
}

test.describe("shared device (games)", { tag: p2("@local-only") }, () => {
  test("a finished game and its PGN never reach the next person", async ({ seat, seedGame }) => {
    test.setTimeout(300_000);
    const a = await seat("N");
    const opp = await seat("O");
    const g = await seedGame("G-ENDED", a, opp);
    const page = a.page;
    const urls = [`/api/games/${g.ref}/pgn`, `/api/games/${g.ref}`];

    await a.open(g.ref);
    for (const u of urls) expect((await fetchFresh(page, u)).status, u).toBe(200);
    const pgn = await page.request.get(urls[0]!);
    expect(pgn.headers()["cache-control"]).toMatch(/no-store/);

    // A signs out from the account menu (POST /api/session/clear before Clerk's sign-out).
    await page.goto("/play", { timeout: 180_000 });
    // Let /play's own reads finish first: a fetch cut off by the sign-out navigation is logged as an error.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.getByTestId("shell-account-button").click();
    // (P1's shared-device.spec.ts asserts the session/clear answer itself.)
    await page.getByTestId("account-item-signout").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });

    // B (not a player of the game) in the same context.
    await signIn(page, letterEmail("P"), "");
    const pgnB = await fetchFresh(page, urls[0]!);
    expect(pgnB).toEqual({ status: 403, network: true });
    const snapB = await fetchFresh(page, urls[1]!);
    expect(snapB.network).toBe(true);
    // Plan 12.6 says 404; plan 11.1 makes a finished friend game watchable, so a member who is not a player gets the
    // spectator projection. Either way B must never get A's player view.
    if (snapB.status !== 404) {
      expect(snapB.status).toBe(200);
      const body = (await (await page.request.get(urls[1]!)).json()) as { data: { snapshot: { you: { role: string } } } };
      expect(body.data.snapshot.you.role).toBe("spectator");
    }
  });
});
