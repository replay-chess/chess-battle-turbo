// In review/serial/: leasing specs run in the one-worker game-serial project (every lease on pool user 1).
// A lapsed member (phase-03 plan §12.3 `review-lapsed.spec.ts`, §11.1, owner decision P3-Q1): the leased
// `review-lapsed` persona (subscription ended 10 days ago, one reviewed game).
// - review-lapsed-read off (the default, the main run): the review and the archive redirect to pricing; A1 and G1
//   answer 402 `expired`.
// - review-lapsed-read on (`--project=lapsed-read`, its own server with the flag on; tag @lapsed-read-on): the review
//   and the archive render (GETs only); Share and every write go to pricing / answer 402.
import type { Page } from "@playwright/test";
import { dataOf, DEVICES, expect, gotoOk, openReview, test } from "../_lib/review";

async function personaGameRef(page: Page): Promise<string> {
  const me = await dataOf<{ user: { ref: string } }>(await page.request.get("/api/me"));
  const { seededRef } = await import("@repo/db/seed/builders");
  return seededRef("GAME", me.user.ref);
}

async function errorOf(res: { status(): number; json(): Promise<unknown> }) {
  return { status: res.status(), body: (await res.json()) as { error: { code: string; details?: { reason?: string } } } };
}

test.describe("lapsed member", { tag: ["@p3"] }, () => {
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test("review-lapsed-read off: pricing redirects, 402 expired", async ({ page, persona }) => {
    test.setTimeout(240_000);
    await persona("review-lapsed");
    const ref = await personaGameRef(page);
    for (const path of [`/review/${ref}`, "/games"]) {
      await page.goto(path, { timeout: 180_000 });
      await expect(page, path).toHaveURL(/\/pricing\?reason=ended/, { timeout: 60_000 });
    }
    for (const path of [`/api/review/${ref}`, "/api/me/games"]) {
      const { status, body } = await errorOf(await page.request.get(path));
      expect(status, path).toBe(402);
      expect(body.error.details?.reason, path).toBe("expired");
    }
  });

  test(
    "review-lapsed-read on: the review and /games render; Share and writes → pricing / 402",
    { tag: ["@lapsed-read-on", "@state:V3ReviewSummary.summary"] },
    async ({ page, persona }) => {
      test.setTimeout(240_000);
      await persona("review-lapsed");
      const ref = await personaGameRef(page);
      await openReview(page, ref);
      await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done");
      await expect(page.getByTestId("review-summary")).toBeVisible();
      expect((await page.request.get(`/api/review/${ref}`)).status()).toBe(200);

      await gotoOk(page, "/games");
      await expect(page.locator(`[data-testid="games-row"][data-ref="${ref}"]`)).toBeVisible({ timeout: 60_000 });

      // Writes stay paid: A10 (share), A3 (analyse), A5 (progress).
      const share = await errorOf(await page.request.post(`/api/review/${ref}/share`, { data: { showUsername: true }, headers: { "Idempotency-Key": crypto.randomUUID() } }));
      expect(share.status).toBe(402);
      expect(share.body.error.details?.reason).toBe("expired");
      expect((await page.request.post(`/api/review/${ref}/analyse`, { data: {} })).status()).toBe(402);

      // The menu's Share item goes to pricing.
      await openReview(page, ref);
      await page.locator('[data-testid="review-menu"]:visible, [data-testid="review-menu-bar"]:visible').first().click();
      await page.getByTestId("menu-share").click();
      await expect(page).toHaveURL(/\/pricing/, { timeout: 60_000 });
    },
  );
});
