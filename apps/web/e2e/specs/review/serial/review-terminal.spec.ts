// In review/serial/: leasing specs run in the one-worker game-serial project (every lease on pool user 1).
// A terminal failure (phase-03 plan §12.3 `review-terminal.spec.ts`): the leased `review-terminal` persona's only game
// failed for good (30 plies graded, out of attempts) → the `failed` card has no Retry and links Report a Problem; the
// graded half of the game is still browsable.
import { dataOf, DEVICES, reviewStateTags, expect, openReview, test } from "../_lib/review";

test.describe("terminal failure", { tag: ["@p3"] }, () => {
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test("no Retry; Report a Problem", { tag: reviewStateTags("failed") }, async ({ page, persona }) => {
    test.setTimeout(240_000);
    await persona("review-terminal");
    const me = await dataOf<{ user: { ref: string } }>(await page.request.get("/api/me"));
    const { seededRef } = await import("@repo/db/seed/builders");
    const ref = seededRef("TERMINAL", me.user.ref);
    await openReview(page, ref);
    await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "failed");
    const failed = page.getByTestId("failed-card");
    await expect(failed).toHaveAttribute("data-substate", "terminal");
    await expect(failed).toContainText("We couldn’t analyse this game. Your moves are still here.");
    await expect(page.getByTestId("retry-analysis")).toHaveCount(0);
    await expect(failed.getByRole("link", { name: "Report a Problem" })).toHaveAttribute("href", "/help#contact");
    // A4 refuses a retry of a terminal job (410 gone).
    const retry = await page.request.post(`/api/review/${ref}/retry`, { data: {} });
    expect(retry.status()).toBe(410);
  });
});
