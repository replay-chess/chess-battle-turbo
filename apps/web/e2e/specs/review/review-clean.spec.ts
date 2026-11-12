// A clean game (phase-03 plan §12.3 `review-clean.spec.ts`; owner test T7): member A's seeded CLEAN game (the Opera
// Game against Engine 1200, no key moment) opens in `clean` with the best-decision note → See Your Best Move opens the
// Moves tab at 16.Qb8+ with the Brilliant badge → Done → Review complete `nothing`. The spec owns CLEAN's walkthrough
// state and clears it first.
import type { Page } from "@playwright/test";
import { clickUntil, control, reviewStateTags, DEVICES, expect, noDocumentScroll, openReview, test } from "./_lib/review";

async function clean(page: Page, ref: string, phone: boolean) {
  await openReview(page, ref);
  const screen = page.getByTestId("review-screen");
  await expect(screen).toHaveAttribute("data-status", "done");
  await expect(screen).toHaveAttribute("data-phase", "done");
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-clean", "");
  await expect(page.getByTestId("clean-note")).toContainText("16.Qb8+");
  await expect(page.getByTestId("start-review")).toHaveCount(0);
  await noDocumentScroll(page);

  // The viewed ply becomes 16.Qb8+ (White's 16th move, 0-based ply 30) on the Moves tab, with the Brilliant label.
  const board = page.getByTestId("review-board");
  await expect(board).toHaveAttribute("data-ply", "32"); // the final position (17.Rd8#) first
  if (phone) {
    // Phones keep the summary's side buttons out of the docked sheet; the move strip carries the badge instead.
    await clickUntil(page.getByRole("button", { name: /^16\.Qb8\+, Brilliant$/ }).filter({ visible: true }).first(), () =>
      expect(board).toHaveAttribute("data-ply", "30", { timeout: 2_000 }),
    );
  } else {
    await clickUntil(control(page, "see-best-move"), () => expect(board).toHaveAttribute("data-ply", "30", { timeout: 2_000 }));
  }
  await expect(page.getByTestId("current-move").filter({ visible: true }).first()).toContainText("16.Qb8+ · Brilliant");

  // Done sits in the Coach tab's summary on desktop and in the action bar on phones.
  if (!(await control(page, "review-done").isVisible())) await page.getByTestId("tab-coach").click();
  await control(page, "review-done").click();
  await page.waitForURL(new RegExp(`/review/${ref}/complete`), { timeout: 60_000 });
  const complete = page.getByTestId("review-complete");
  await expect(complete).toHaveAttribute("data-state", "nothing", { timeout: 60_000 });
  await expect(page.getByTestId("complete-title")).toHaveText("Clean game");
  await expect(page.getByTestId("complete-lead")).toContainText("16.Qb8+");
  await expect(page.getByTestId("complete-review-again")).toHaveCount(0);
  await noDocumentScroll(page);
}

test.describe("clean game", { tag: ["@p3", ...reviewStateTags("clean"), "@state:V3RvCompleteClean.nothing", "@state:V3RvComplete.nothing"] }, () => {
  test.describe.configure({ mode: "serial" });

  test.describe("desktop-1440@100", () => {
    test.use(DEVICES["desktop-1440"]);
    test("clean → See Your Best Move (16.Qb8+, Brilliant) → Done → complete nothing", async ({ member, page, resetProgress, seeded }) => {
      test.setTimeout(240_000);
      await resetProgress(seeded.CLEAN);
      await member("A");
      await clean(page, seeded.CLEAN, false);
    });
  });

  test.describe("android@100", { tag: ["@state:V3AndroidReview.clean"] }, () => {
    test.use(DEVICES.android);
    test("the same on Android with the action bar", async ({ member, page, resetProgress, seeded }) => {
      test.setTimeout(240_000);
      await resetProgress(seeded.CLEAN);
      await member("A");
      await clean(page, seeded.CLEAN, true);
    });
  });
});
