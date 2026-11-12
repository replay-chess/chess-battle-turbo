// P2's game-over card with P3's slots on /dev/ui/game-over (phase-03 plan §4.7, §4.10). The slot components are WP-E's;
// this checks the demo route reaches each slot state. @demo:V3Game.over_analysing @demo:V3GameOverLegend.over_legend
import { DEVICES, expect, openDemo, test } from "./_demo";

test.use(DEVICES["desktop-1440"]);

test.describe("game-over-slots demo", { tag: ["@p3"] }, () => {
  test("analysing → disabled primary with the percentage @demo:V3Game.over_analysing", async ({ page }) => {
    await openDemo(page, "/dev/ui/game-over?slot=analysing", "game-over-demo");
    await expect(page.getByTestId("review-analysing").filter({ visible: true }).first()).toBeDisabled({ timeout: 60_000 });
    await expect(page.getByTestId("review-analysing").filter({ visible: true }).first()).toHaveText(/Analysing · \d+%/);
  });

  test("done → the coach line and See What the Coach Thinks", async ({ page }) => {
    await openDemo(page, "/dev/ui/game-over?slot=done", "game-over-demo");
    await expect(page.getByTestId("review-coach-cta").filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("review-coach-line").filter({ visible: true }).first()).toBeVisible();
  });

  test("legend → the over_legend block with Replay and Compare @demo:V3GameOverLegend.over_legend", async ({ page }) => {
    await openDemo(page, "/dev/ui/game-over?slot=legend", "game-over-demo");
    const block = page.getByTestId("review-legend").filter({ visible: true }).first();
    await expect(block).toBeVisible({ timeout: 60_000 });
    await expect(block).toContainText("Morphy");
  });
});
