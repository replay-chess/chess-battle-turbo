// Review walkthrough on real data (phase-03 plan §12.3 `review-walkthrough.spec.ts` @smoke; owner tests T3–T6).
// Member A's seeded GAME (54 plies vs tal_fan_77, three key moments at moves 17, 19 and 21): summary → the Coach tab's
// three sentences → Start Review → m1: drag Nd5 (wrong, rings + status) then Qc1 (found) → m2: Reveal (green arrow) →
// Show Line (three SAN in aria-live) → m3: pick Trade (feedback), then Ne2 (found) → Finish Review → complete `default` (3 cards). A
// reload of `?m=2` restores moment 2. The spec owns GAME's walkthrough state and clears it first.
import { blur, clickUntil, control, reviewStateTags, dragSquare, clickMove, expect, openReview, test, noDocumentScroll, visible, DEVICES } from "./_lib/review";

const TAGS = ["@p3", "@smoke", ...reviewStateTags("summary"), ...reviewStateTags("moment"), "@state:V3RvComplete.default", "@state:V3RvCompleteClean.default"];

async function walk(
  page: import("@playwright/test").Page,
  ref: string,
  telemetry: import("../../fixtures/telemetry").Telemetry,
  phone: boolean,
) {
  await openReview(page, ref);
  const screen = page.getByTestId("review-screen");
  await expect(screen).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await telemetry.expect("review_opened", { status: "done" }, { source: "client" });
  await telemetry.expect("review_summary_viewed", { moments: 3, is_clean: false }, { source: "client" });

  // The Coach tab: the narrated summary, three sentences.
  const coach = page.getByTestId("coach-line");
  await expect(coach).toBeVisible();
  // summary[] (plan §8.7, CA text/summary.ts): accuracy, the optional strongest phase (GAME's opening is 96 against
  // 78), the turning point, the close.
  // Each sentence span ends with the space that joins it to the next.
  await expect(coach.locator(".rv-sent")).toHaveText([
    /^You played at \d+ accuracy; your opponent at \d+\.\s*$/,
    /^Your opening was the strongest part \(96\)\.\s*$/,
    /^The game turned on move 19, when Qd2 missed Rxf5\.\s*$/,
    /^3 moments are worth a second look\.\s*$/,
  ]);
  await noDocumentScroll(page);

  await clickUntil(control(page, "start-review"), () => expect(page.getByTestId("moment-panel")).toBeVisible({ timeout: 2_000 }));
  await telemetry.expect("review_started", { moments: 3 }, { source: "client" });
  await expect(page.getByTestId("moment-header")).toHaveText("Moment 1 of 3 · Move 17");
  await expect(page).toHaveURL(/[?&]m=1\b/);
  await telemetry.expect("moment_viewed", { idx: 0 }, { source: "client" });

  // m1: Nd5 is wrong (dragged), Qc1 is right (clicked).
  if (phone) await clickMove(page, "c3", "d5");
  else await dragSquare(page, "c3", "d5");
  await expect(page.getByTestId("moment-tried")).toHaveText("Not quite: Nd5 isn’t the move here. Try again, or reveal the answer.");
  await expect(page.getByTestId("moment-panel")).toHaveAttribute("data-phase", "tried");
  await expect(page.locator('[data-square="d5"] [data-mark="ring"]').filter({ visible: true })).toHaveCount(1);
  await telemetry.expect("moment_attempt", { idx: 0, correct: false, attempt_no: 1 }, { source: "client" });
  await clickMove(page, "d1", "c1");
  await expect(page.getByTestId("moment-found")).toHaveText("You found it: Qc1 is the engine’s move. In the game you played b3.");
  await telemetry.expect("moment_attempt", { idx: 0, correct: true, attempt_no: 2 }, { source: "client" });

  // m2: Reveal → the played move, the best move as an arrow → Show Line (three SAN, announced politely).
  await control(page, "next-moment").click();
  await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19");
  await control(page, "reveal-answer").click();
  await expect(page.getByTestId("moment-rows")).toContainText("You played 19.Qd2 · Miss");
  await expect(page.getByTestId("moment-rows")).toContainText("Best was Rxf5 · green arrow");
  await expect(page.locator("[data-arrow]").filter({ visible: true }).first()).toBeVisible();
  await telemetry.expect("moment_revealed", { idx: 1 }, { source: "client" });
  await visible(page, "show-line").click();
  const line = page.getByTestId("moment-line");
  await expect(line).toHaveAttribute("aria-live", "polite");
  await expect(line.locator("[data-on]")).toHaveCount(3, { timeout: 10_000 });
  await expect(line).toHaveText(/Rxf5\s*Bh2\+\s*Kh1/);
  await telemetry.expect("moment_show_line", { idx: 1 }, { source: "client" });

  // m3: a plan chip and its feedback, then Finish Review.
  await control(page, "next-moment").click();
  await expect(page.getByTestId("moment-header")).toHaveText("Moment 3 of 3 · Move 21");
  await page.getByTestId("plan-chip-trade").click();
  await expect(page.getByTestId("plan-chip-trade")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("plan-feedback")).toHaveText(/^You were thinking: trade\./);
  await telemetry.expect("moment_plan_picked", { idx: 2, chip: "trade", matched_intent: false }, { source: "client" });
  // Then the engine's move on the first try (the feedback names it: Ne2), so m3 counts as found.
  await clickMove(page, "c3", "e2");
  await expect(page.getByTestId("moment-found")).toContainText("You found it: Ne2");
  await telemetry.expect("moment_attempt", { idx: 2, correct: true, attempt_no: 1 }, { source: "client" });
  await control(page, "finish-review").click();

  await page.waitForURL(new RegExp(`/review/${ref}/complete`), { timeout: 60_000 });
  const complete = page.getByTestId("review-complete");
  await expect(complete).toHaveAttribute("data-state", "default", { timeout: 60_000 });
  await expect(page.getByTestId("complete-moment")).toHaveCount(3);
  await expect(page.getByTestId("complete-title")).toHaveText("Review complete");
  await telemetry.expect("review_completed", { moments: 3, found: 1, found_retry: 1, revealed: 1 }, { source: "client", count: 1 });
  await noDocumentScroll(page);

  // A deep link to moment 2 restores it after a reload.
  await openReview(page, ref, "?m=2");
  await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19");
  await page.reload();
  await expect(page.getByTestId("moment-header")).toHaveText("Moment 2 of 3 · Move 19", { timeout: 60_000 });

  // No move a member typed or played ever reaches telemetry.
  telemetry.forbid("Nd5");
  telemetry.forbid("Qc1");
  await blur(page);
}

// One serial group: both devices walk the same seeded game, so they never run at the same time.
test.describe("review walkthrough", { tag: TAGS }, () => {
  test.describe.configure({ mode: "serial" });

  test.describe("desktop-1440@100", () => {
    test.use(DEVICES["desktop-1440"]);
    test("summary → moments (wrong, found, reveal + line, chip) → complete; ?m=2 restores", async ({ member, seeded, resetProgress, telemetry, page }) => {
      test.setTimeout(300_000);
      await resetProgress(seeded.GAME);
      await member("A");
      await walk(page, seeded.GAME, telemetry, false);
    });
  });

  test.describe("iphone@100", { tag: ["@state:V3iPhoneReview.summary", "@state:V3iPhoneReview.moment"] }, () => {
    test.use(DEVICES.iphone);
    test("the same walkthrough with the phone action bar", async ({ member, seeded, resetProgress, telemetry, page }) => {
      test.setTimeout(300_000);
      await resetProgress(seeded.GAME);
      await member("A");
      await walk(page, seeded.GAME, telemetry, true);
    });
  });
});
