// Review keys on real data (phase-03 plan §12.3 `review-keyboard.spec.ts`, §4.1; owner test T3): the `?` sheet lists
// the "In a Review" group (Share with review-share on); ←/→ step plies, Home/End jump, M/C switch tabs, F flips, Space
// plays/pauses the coach, Enter starts the walkthrough, Shift+→/← move between moments, L shows the line after a reveal,
// S opens Share; nothing fires while typing in an input. Member A's analysed archive-03 (three moments; no other spec writes its
// walkthrough state; the spec clears it first).
import { blur, DEVICES, expect, openReview, retryUntil, test } from "./_lib/review";

test.describe("review keys · desktop-1440@100", { tag: ["@p3"] }, () => {
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test("the ? sheet, plies, ends, tabs, flip, narration, moments, line, share; inputs swallow keys", { tag: ["@state:V3ReviewSummary.summary"] }, async ({ member, page, resetProgress, seeded }) => {
    test.setTimeout(240_000);
    const ref = seeded.archive(3);
    await resetProgress(ref);
    await member("A");
    await openReview(page, ref);
    const screen = page.getByTestId("review-screen");
    await expect(screen).toHaveAttribute("data-status", "done");
    const board = page.getByTestId("review-board");
    const last = Number(await board.getAttribute("data-ply"));
    expect(last).toBeGreaterThan(10);

    // ? lists the review group (hydration-safe: retried until the dialog opens).
    await blur(page);
    await retryUntil(
      () => page.keyboard.press("Shift+Slash"),
      () => expect(page.getByTestId("shortcuts-dialog")).toBeVisible({ timeout: 2_000 }),
    );
    const dialog = page.getByTestId("shortcuts-dialog");
    await expect(dialog).toContainText("In a Review");
    for (const row of ["Previous or next move", "Flip the board", "Moves or Coach tab", "Show the best line", "Share the review"]) {
      await expect(dialog).toContainText(row);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await blur(page);

    // Plies and ends.
    await page.keyboard.press("ArrowLeft");
    await expect(board).toHaveAttribute("data-ply", String(last - 1));
    await page.keyboard.press("Home");
    await expect(board).toHaveAttribute("data-ply", "-1");
    await page.keyboard.press("ArrowRight");
    await expect(board).toHaveAttribute("data-ply", "0");
    await page.keyboard.press("End");
    await expect(board).toHaveAttribute("data-ply", String(last));

    // Tabs, flip, narration.
    await page.keyboard.press("m");
    await expect(page.getByTestId("tab-moves")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("c");
    await expect(page.getByTestId("tab-coach")).toHaveAttribute("aria-selected", "true");
    const evalbar = page.getByTestId("review-evalbar");
    const flipped = (await evalbar.getAttribute("data-flip")) !== null;
    const isFlipped = async () => (await evalbar.getAttribute("data-flip")) !== null;
    await page.keyboard.press("f");
    await expect.poll(isFlipped, { message: "F flips the board" }).toBe(!flipped);
    await page.keyboard.press("f");
    await expect.poll(isFlipped).toBe(flipped);
    await page.keyboard.press(" ");
    await expect(page.getByTestId("narration-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
    await page.keyboard.press(" ");
    await expect(page.getByTestId("narration-toggle")).toHaveAttribute("aria-pressed", "false", { timeout: 5_000 });

    // Enter starts the walkthrough; Shift+→ / Shift+← move between moments; L after a reveal shows the line.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("moment-header")).toContainText(/^Moment 1 of \d/);
    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.getByTestId("moment-header")).toContainText(/^Moment 2 of \d/);
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.getByTestId("moment-header")).toContainText(/^Moment 1 of \d/);
    await page.keyboard.press("Enter"); // reveal
    await expect(page.getByTestId("moment-answer")).toBeVisible();
    await page.keyboard.press("l");
    await expect(page.getByTestId("moment-line").locator("[data-on]").first()).toBeVisible({ timeout: 10_000 });

    // S opens Share.
    await page.keyboard.press("s");
    await page.waitForURL(new RegExp(`/review/${ref}/share`), { timeout: 60_000 });

    // Keys typed in an input do nothing on the review.
    await openReview(page, ref);
    const plyBefore = await board.getAttribute("data-ply");
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "e2e-typing";
      input.setAttribute("aria-label", "typing probe");
      document.body.append(input);
    });
    await page.locator("#e2e-typing").focus();
    await page.keyboard.type("fmcls ");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Home");
    await expect(board).toHaveAttribute("data-ply", plyBefore ?? "");
    await expect(page).toHaveURL(new RegExp(`/review/${ref}$`));
    await expect(page.getByTestId("tab-coach")).toHaveAttribute("aria-selected", "true");
  });
});
