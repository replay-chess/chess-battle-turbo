// Review privacy (phase-03 plan §12.3 `review-privacy.spec.ts`, §11.1; owner tests T17, T18): member B gets the 404
// page and a 404 from the API for member A's review (existence hidden); user R (never a member) is sent to pricing and
// the API answers 402; a signed-out API call is 401; and while A's game is analysed, B's socket receives no
// `analysis:*` event of it (A's own socket does).
import { completeBotGame, createBotGame, kickWorker } from "./_lib/games";
import { DEVICES, expect, gotoOk, openReview, test } from "./_lib/review";
import { recordSocketEvents } from "./_lib/socket-frames";

test.describe("review privacy", { tag: ["@p3"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test("member B: the 404 page and a 404 from A1", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("B");
    // The page streams (loading.tsx), so notFound() renders the not-found UI after the 200 status line went out; the
    // existence of A's game is hidden either way: the same UI as a ref that does not exist, and noindex.
    await gotoOk(page, `/review/${seeded.GAME}`);
    await expect(page.getByTestId("review-not-found")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("review-screen")).toHaveCount(0);
    const missing = await page.request.get("/review/cnotarealgameref00000000aa");
    expect(missing.status()).toBe(200);
    await gotoOk(page, "/review/cnotarealgameref00000000aa");
    await expect(page.getByTestId("review-not-found")).toBeVisible({ timeout: 60_000 });
    for (const path of [`/api/review/${seeded.GAME}`, `/api/review/${seeded.GAME}/status`, `/api/review/${seeded.GAME}/pgn`]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    }
  });

  test("user R (never a member): pricing, and 402 trial_available", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("R");
    await page.goto(`/review/${seeded.GAME}`, { timeout: 180_000 });
    await expect(page).toHaveURL(/\/pricing\?reason=/, { timeout: 60_000 });
    const res = await page.request.get(`/api/review/${seeded.GAME}`);
    expect(res.status()).toBe(402);
    expect(((await res.json()) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe("trial_available");
  });

  test("signed out: 401 from A1", async ({ playwright, seeded }) => {
    const api = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    try {
      const res = await api.get(`/api/review/${seeded.GAME}`, { headers: { accept: "application/json" } });
      expect(res.status()).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    } finally {
      await api.dispose();
    }
  });

  test("B's socket hears nothing of A's analysis", { tag: ["@local-only", "@worker-faults"] }, async ({ member, page, userPage }) => {
    test.setTimeout(240_000);
    const b = await userPage("B");
    const bEvents = recordSocketEvents(b);
    await gotoOk(b, "/games");
    // B's archive may be empty on a fresh database: any settled state will do (B's socket is connected by then).
    await expect(b.locator('[data-testid="games-archive"]:not([data-state="loading"])')).toBeVisible({ timeout: 120_000 });

    await member("A");
    const aEvents = recordSocketEvents(page);
    const ref = await createBotGame(page);
    // Hold the run in its final write long enough that A's page is open when the done event goes out.
    await kickWorker({ watch: ref, fault: "pause_at:writing:15000" });
    await completeBotGame(page, ref);
    await openReview(page, ref);
    await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 120_000 });

    const aboutGame = (e: { event: string; payload: unknown }) =>
      e.event.startsWith("analysis:") && JSON.stringify(e.payload).includes(ref);
    expect(aEvents.filter(aboutGame).length, "A's socket received its analysis events").toBeGreaterThan(0);
    // A grace period for any late frame, then: nothing for B.
    await b.waitForTimeout(3_000);
    expect(bEvents.filter(aboutGame)).toEqual([]);
    expect(bEvents.filter((e) => e.event.startsWith("analysis:") && JSON.stringify(e.payload).includes(ref))).toHaveLength(0);
  });
});
