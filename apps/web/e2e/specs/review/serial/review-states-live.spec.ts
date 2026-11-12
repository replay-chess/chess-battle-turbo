// Analysing sub-states with real data (phase-03 plan §12.3 `review-states-live.spec.ts`): the `hold_queue` fault holds
// the worker, so a finished game's review shows `analysing.queued` ("Waiting for the engine…"); a release kick lets it
// run. Released with a one-shot `pause_at:writing`, a game waits in its final write while its open review shows
// "Finding your key moments…" (the live `analysis:writing` event).
// `hold_queue` holds every claim of the e2e worker, so this file lives in review/serial/ (the game-serial project: one
// worker, after every other project). Kick faults need the APP_ENV=test worker (`@worker-faults`, CI and Docker runs).
import { finishedBotGame, kickWorker } from "../_lib/games";
import { DEVICES, expect, openReview, reviewStateTags, test } from "../_lib/review";

test.describe("analysing sub-states", { tag: ["@p3", "@worker-faults", "@local-only"] }, () => {
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test(
    "hold_queue → queued; the release kick → done",
    { tag: reviewStateTags("analysing") },
    async ({ member, page }) => {
      test.setTimeout(240_000);
      await member("F");
      await kickWorker({ fault: "hold_queue" });
      try {
        const { ref, analysis } = await finishedBotGame(page);
        expect(analysis.status).toBe("queued");
        await openReview(page, ref);
        const card = page.getByTestId("analysing-card");
        await expect(card).toHaveAttribute("data-substate", "queued", { timeout: 30_000 });
        await expect(card).toContainText("Waiting for the engine");
        await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "queued");
        // Still queued a few seconds later: the worker claims nothing while held.
        await page.waitForTimeout(3_000);
        await expect(card).toHaveAttribute("data-substate", "queued");

        await kickWorker({ watch: ref });
        await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 90_000 });
        await expect(page.getByTestId("review-summary").or(page.getByTestId("moment-panel")).first()).toBeVisible();
      } finally {
        // Never leave the shared e2e worker held.
        await kickWorker({});
      }
    },
  );

  test(
    "pause_at:writing → Finding your key moments… → done",
    { tag: reviewStateTags("analysing") },
    async ({ member, page }) => {
      test.setTimeout(240_000);
      await member("F");
      // The writing sub-state comes from the live `analysis:writing` event (A1 cannot tell running from writing), so the
      // page must be open before the run reaches it: hold the worker, open the queued review, then release the hold
      // with a one-shot `pause_at:writing` for this game.
      await kickWorker({ fault: "hold_queue" });
      try {
        const { ref } = await finishedBotGame(page);
        await openReview(page, ref);
        await expect(page.getByTestId("analysing-card")).toHaveAttribute("data-substate", "queued", { timeout: 30_000 });
        await kickWorker({ watch: ref, fault: "pause_at:writing:8000" });
        const card = page.getByTestId("analysing-card");
        await expect(card).toHaveAttribute("data-substate", "writing", { timeout: 60_000 });
        await expect(card).toContainText("Finding your key moments…");
        await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 90_000 });
      } finally {
        await kickWorker({});
      }
    },
  );
});
