// A failed analysis and its retry (phase-03 plan §12.3 `review-failed-retry.spec.ts`; owner test T11): the one-shot
// `fail_at_ply:12` fault fails the first attempt at ply 12 → the `failed` card names the last checkpoint (ply 10, move 6) → Retry
// Analysis → the first progress frame starts at ply 10 (the last checkpoint, not 0) → the summary.
// `analysis_retry_clicked` (client) and `analysis_failed{retryable:true}` (worker) are asserted. Kick faults need the
// APP_ENV=test worker (`@worker-faults`).
import { completeBotGame, createBotGame, kickWorker } from "./_lib/games";
import { clickUntil, DEVICES, reviewStateTags, expect, openReview, test } from "./_lib/review";
import { recordSocketEvents } from "./_lib/socket-frames";

test.describe("failed → retry", { tag: ["@p3", "@worker-faults", "@local-only"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test(
    "fail_at_ply:12 → failed card → Retry Analysis resumes from the checkpoint → summary",
    { tag: [...reviewStateTags("failed"), ...reviewStateTags("analysing")] },
    async ({ member, page, telemetry }) => {
      test.setTimeout(240_000);
      await member("G");
      const ref = await createBotGame(page);
      await kickWorker({ watch: ref, fault: "fail_at_ply:12" });
      await completeBotGame(page, ref);
      const frames = recordSocketEvents(page);
      await openReview(page, ref);

      const failed = page.getByTestId("failed-card");
      await expect(failed).toHaveAttribute("data-substate", "retryable", { timeout: 90_000 });
      await expect(failed).toContainText("Couldn’t finish analysis");
      await expect(failed).toContainText(/The engine stopped at move 6 of 13\. Moves 1 to 5 are graded below\./);
      await telemetry.expect("analysis_failed", { code: "engine_failed", attempt: 1, retryable: true }, { source: "server" });

      const before = frames.length;
      await clickUntil(page.getByTestId("retry-analysis"), () => expect(page.getByTestId("failed-card")).toHaveCount(0, { timeout: 2_000 }));
      await telemetry.expect("analysis_retry_clicked", { code: "engine_failed", attempt: 1 }, { source: "client" });
      await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 90_000 });
      const progress = frames
        .slice(before)
        .filter((f) => f.event === "analysis:progress" && (f.payload as { gameRef?: string }).gameRef === ref)
        .map((f) => f.payload as { from: number; gradedPlies: number });
      expect(progress.length, "the retry streamed progress").toBeGreaterThan(0);
      expect(progress[0]!.from, `first frame after the retry: ${JSON.stringify(progress[0])}`).toBe(10);
      await expect(page.getByTestId("review-summary")).toBeVisible();
    },
  );
});
