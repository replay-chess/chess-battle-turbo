// Key moments on /dev/ui/review (phase-03 plan §4.1 `moment.*`, T4/T5, F4): the walkthrough on the design's GAME
// fixture with no server. The real-data twin is WP-H's review-walkthrough.spec.ts. @demo:V3KeyMoments.moment
import { blur, DEVICES, expect, noDocumentScroll, openDemo, retryUntil, test, visible } from "./_demo";

test.use(DEVICES["desktop-1440"]);

test.describe("review-moments demo", { tag: ["@p3"] }, () => {
  test("Start → wrong try → right try → reveal + line → chip → Finish (complete default) @demo:V3KeyMoments.moment", async ({ page }) => {
    await openDemo(page, "/dev/ui/review?state=summary", "review-screen");
    // Desktop: the summary's Start Review; phones: the action bar's.
    await page.getByTestId("start-review").or(page.getByTestId("bar-start-review")).filter({ visible: true }).first().click();
    await expect(page.getByTestId("moment-header")).toHaveText("Moment 1 of 3 · Move 17");
    await expect(page).toHaveURL(/[?&]m=1\b/);
    const board = page.getByTestId("review-board");
    await expect(board).toHaveAttribute("data-input", "");

    // m1: Nd5 is wrong (rings + status), Qc1 is right.
    await page.locator('[data-square="c3"]').click();
    await page.locator('[data-square="d5"]').click();
    await expect(page.getByTestId("moment-tried")).toHaveText("Not quite: Nd5 isn’t the move here. Try again, or reveal the answer.");
    await expect(page.locator('[data-square="c3"] [data-mark="ring"]')).toHaveCount(1);
    await expect(page.locator('[data-square="d5"] [data-mark="ring"]')).toHaveCount(1);
    await page.locator('[data-square="d1"]').click();
    await page.locator('[data-square="c1"]').click();
    await expect(page.getByTestId("moment-found")).toHaveText("You found it: Qc1 is the engine’s move. In the game you played b3.");
    await expect(page.getByTestId("review-position-label")).toHaveText("You found Qc1");
    await expect(board).not.toHaveAttribute("data-input", "");

    // m2: Reveal → the played move with its badge and the green arrow → Show Line (3 SAN, aria-live).
    await visible(page, "bar-next-moment").click();
    await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19");
    await visible(page, "bar-reveal-answer").click();
    await expect(page.getByTestId("moment-rows")).toContainText("You played 19.Qd2 · Miss");
    await expect(page.getByTestId("moment-rows")).toContainText("Best was Rxf5 · green arrow");
    await expect(page.getByTestId("review-position-label")).toHaveText("After 19.Qd2 · arrow shows Rxf5");
    await page.getByTestId("show-line").click();
    const line = page.getByTestId("moment-line");
    await expect(line).toHaveAttribute("aria-live", "polite");
    await expect(line.locator("[data-on]")).toHaveCount(3, { timeout: 5_000 });
    await expect(line).toHaveText(/Rxf5\s*Bh2\+\s*Kh1/);
    await expect(page.getByTestId("review-position-label")).toHaveText("Best line · Rxf5 Bh2+ Kh1");

    // m3: a plan chip shows its precomputed feedback; Reveal; Finish Review → the complete page.
    await visible(page, "bar-next-moment").click();
    await page.getByTestId("plan-chip-trade").click();
    await expect(page.getByTestId("plan-chip-trade")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("plan-feedback")).toHaveText(/^You were thinking: trade\. The engine’s idea here was to defend: Ne2/);
    await visible(page, "bar-reveal-answer").click();
    await visible(page, "bar-finish-review").click();
    await expect(page).toHaveURL(/\/dev\/ui\/review\/complete\?state=default/);
    await expect(page.getByTestId("complete-moment")).toHaveCount(3);
    await noDocumentScroll(page);
  });

  test("a reload keeps the moment (?m=2) @demo:V3KeyMoments.moment", async ({ page }) => {
    await openDemo(page, "/dev/ui/review?state=summary&m=2", "moment-panel");
    await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19");
    await page.reload();
    await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19", { timeout: 60_000 });
  });

  test("every moment sub-state renders on the demo route @demo:V3KeyMoments.moment", async ({ page }) => {
    const cases: [string, string][] = [
      ["ask", "Before move 17 · White to move"],
      ["tried", "Before move 17 · White to move"],
      ["pickLine", "Before move 17 · White to move"],
      ["found", "You found Qc1"],
      ["found_retry", "You found Qc1"],
      ["reveal", "After 17.b3 · arrow shows Qc1"],
      ["line", "Best line · Qc1 Nxe3 Qxe3"],
    ];
    for (const [phase, label] of cases) {
      await openDemo(page, `/dev/ui/review?state=moment&phase=${phase}`, "moment-panel");
      await expect(page.getByTestId("moment-panel")).toHaveAttribute("data-phase", phase);
      await expect(page.getByTestId("review-position-label")).toHaveText(label);
      await noDocumentScroll(page);
    }
  });

  test("keys: Enter is the primary, 1–5 pick a chip, L shows the line, Shift+arrows step moments, arrows do not move the board", async ({ page }) => {
    await openDemo(page, "/dev/ui/review?state=summary", "review-screen");
    await blur(page);
    // The key listener attaches at hydration: retry the first Enter until the walkthrough starts.
    await retryUntil(
      async () => {
        await blur(page);
        await page.keyboard.press("Enter");
      },
      () => expect(page.getByTestId("moment-header")).toHaveText("Moment 1 of 3 · Move 17", { timeout: 2_000 }),
    );
    const ply = await page.getByTestId("review-board").getAttribute("data-ply");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("review-board")).toHaveAttribute("data-ply", ply ?? "");
    await page.keyboard.press("3");
    await expect(page.getByTestId("plan-chip-trade")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("l");
    await expect(page.getByTestId("show-line")).toHaveCount(0);
    await blur(page);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("moment-answer")).toBeVisible();
    await page.keyboard.press("l");
    await expect(page.getByTestId("moment-line").locator("[data-on]")).toHaveCount(3, { timeout: 5_000 });
    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.getByTestId("review-panel")).toHaveAttribute("data-mode", "moves");
  });
});
