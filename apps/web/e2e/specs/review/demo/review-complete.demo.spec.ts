// Review complete on /dev/ui/review/complete (phase-03 plan §4.2, F5): the four states, links and keys.
// @demo:V3RvComplete.default @demo:V3RvCompleteClean.nothing
import { blur, DEVICES, expect, noDocumentScroll, openDemo, test } from "./_demo";

test.use(DEVICES["desktop-1440"]);

test.describe("review-complete demo", { tag: ["@p3"] }, () => {
  test("default: three moments, Accuracy · Moments · Found, Play Again + the rows @demo:V3RvComplete.default", async ({ page }) => {
    await openDemo(page, "/dev/ui/review/complete?state=default", "review-complete");
    await expect(page.getByTestId("complete-title")).toHaveText("Review complete");
    await expect(page.getByTestId("complete-lead")).toHaveText("3 moments reviewed.");
    await expect(page.getByTestId("complete-stats")).toContainText("85");
    await expect(page.getByTestId("stat-found")).toContainText("2");
    await expect(page.getByTestId("complete-moment")).toHaveCount(3);
    await expect(page.getByTestId("complete-moment").first()).toContainText("You played 17.b3 · best was Qc1");
    await expect(page.getByTestId("complete-moment").first()).toContainText("Inaccuracy · you found it on retry");
    await expect(page.getByTestId("complete-primary")).toHaveText("Play Again");
    await expect(page.getByTestId("complete-share")).toBeVisible();
    await expect(page.getByTestId("complete-review-again")).toBeVisible();
    await expect(page.getByTestId("complete-games")).toHaveText(/Back to My Games/);
    // regression: complete-back-row (FIX-1): the back row has its chevron only, no forward arrow.
    await expect(page.getByTestId("complete-games").locator(".rvc-row__go")).toHaveCount(0);
    await noDocumentScroll(page);
    await page.getByRole("link", { name: /Open moment 2: 19\.Qd2/ }).click();
    await expect(page).toHaveURL(/state=moment&m=2/);
  });

  test("nothing: the clean game's best decision, standouts and the best-this-month line @demo:V3RvCompleteClean.nothing", async ({ page }) => {
    await openDemo(page, "/dev/ui/review/complete?state=nothing", "review-complete");
    await expect(page.getByTestId("complete-title")).toHaveText("Clean game");
    await expect(page.getByTestId("complete-lead")).toHaveText("Your best decision was 16.Qb8+, a sacrifice that forced mate.");
    await expect(page.getByTestId("stat-brilliant")).toContainText("1");
    await expect(page.getByTestId("stat-best-month")).toBeVisible();
    await expect(page.getByTestId("complete-standout")).toHaveCount(3);
    await expect(page.getByTestId("complete-best-month")).toHaveText("Accuracy 97 is your best this month.");
    await expect(page.getByTestId("complete-review-again")).toHaveCount(0);
  });

  test("partial and noMoments @demo:V3RvComplete.default", async ({ page }) => {
    await openDemo(page, "/dev/ui/review/complete?state=partial", "review-complete");
    await expect(page.getByTestId("complete-lead")).toHaveText("2 of 3 moments reviewed.");
    await expect(page.getByTestId("complete-finish-last")).toHaveText(/Finish the Last Moment/);
    await expect(page.getByTestId("complete-finish-last")).toHaveAttribute("href", /m=3/);
    await openDemo(page, "/dev/ui/review/complete?state=noMoments", "review-complete");
    await expect(page.getByTestId("complete-title")).toHaveText("No turning points in this game.");
    await expect(page.getByTestId("complete-moment")).toHaveCount(0);
    await noDocumentScroll(page);
  });

  test("Enter = Play Again, Esc = back to the review", async ({ page }) => {
    await openDemo(page, "/dev/ui/review/complete?state=default", "review-complete");
    await blur(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/dev\/ui\/review\?state=summary$/);
    await openDemo(page, "/dev/ui/review/complete?state=default", "review-complete");
    await blur(page);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dev\/ui\/review\?state=summary$/);
  });
});
