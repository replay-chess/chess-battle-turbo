// Compare with the legend on the demo route (/dev/ui/compare, plan §4.6, §4.10): every design state, the keys, the
// tables, the narration and the pending-evals compute. No server, no sign-in (WP-H: e2e/specs/review/, `@demo`).
import { blur, boardInView, DEVICES, expect, isPhone, noDocumentScroll, openDemo, retryUntil, test, visible } from "./_demo";

test.use(DEVICES["desktop-1440"]);

const STATES = ["default", "loading", "no_explanation", "audio_failed", "error", "followed", "opponent_left", "pending_evals"] as const;

test.describe("compare demo", { tag: ["@p3"] }, () => {
  for (const state of STATES) {
    const board = ["default", "loading", "no_explanation", "audio_failed"].includes(state) ? [`@demo:V3LegendCompare.state=${state}`] : [];
    const quick = state === "default" || state === "loading" || state === "error" ? [`@demo:V3TryCompare.${state}`] : [];
    test(`${state}: one viewport, board in view`, { tag: [...board, ...quick] }, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await openDemo(page, `/dev/ui/compare?state=${state}`, "compare-screen");
      await boardInView(page, "compare-board");
      await noDocumentScroll(page);
      expect(errors).toEqual([]);
    });
  }

  test("default: the split view, the summary, both arrows", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=default", "compare-screen");
    await expect(page.getByTestId("compare-summary")).toHaveText("You matched 2 of 3 moves, then left his path with 12.Ba4.");
    await expect(page.getByTestId("compare-board")).toHaveAttribute("data-split", "");
    await expect(page.getByTestId("compare-pos-label")).toHaveText("Move 11…Nbd7");
    await expect(page.getByTestId("compare-eval")).toHaveText("Win chances after the split: you 41% · Morphy 78%");
    await expect(page.getByTestId("compare-paragraph")).toContainText("On move 12 you played Ba4; Morphy played O-O-O.");
  });

  test(
    "keys 1–4 switch the tabs; ←/→ step the line; ↑/↓ its ends",
    { tag: ["explanation", "your_moves", "legend_moves", "practice"].map((t) => `@demo:V3LegendCompare.tab=${t}`) },
    async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=default", "compare-screen");
    await blur(page);
    const screen = page.getByTestId("compare-screen");
    await page.keyboard.press("2");
    await expect(screen).toHaveAttribute("data-tab", "your_moves");
    await expect(page.getByTestId("compare-your-table")).toBeVisible();
    await expect(page.getByTestId("compare-split-divider").first()).toHaveText("Paths split here");
    await page.keyboard.press("3");
    await expect(screen).toHaveAttribute("data-tab", "legend_moves");
    await expect(screen).toHaveAttribute("data-line", "legend");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("compare-pos-label")).toHaveText("Move 12.O-O-O");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("compare-pos-label")).toHaveText("Move 17.Rd8#");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("compare-pos-label")).toHaveText("Start");
    await page.keyboard.press("4");
    await expect(page.getByTestId("compare-practice-from")).toHaveText("Practice from Move 12");
    await expect(page.getByTestId("compare-practice-from")).toHaveAttribute("href", /\/practice\?game=[a-z0-9]+&ply=4&from=compare$/);
    await page.keyboard.press("1");
    await expect(screen).toHaveAttribute("data-tab", "explanation");
  });

  test("a table move puts the board on that position; Go to Move 12 returns to the split", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=default&tab=your_moves", "compare-screen");
    await page.getByTestId("compare-your-table").getByRole("button", { name: "Bb5" }).first().click();
    await expect(page.getByTestId("compare-pos-label")).toHaveText("Move 13.Bb5");
    await expect(page.getByTestId("compare-board")).not.toHaveAttribute("data-split", "");
    await page.getByTestId("compare-jump-split").click();
    await expect(page.getByTestId("compare-board")).toHaveAttribute("data-split", "");
  });

  test("the narration plays from a gesture, moves the board and follows the segments", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=default", "compare-screen");
    await expect(page.getByTestId("compare-segments").getByRole("button")).toHaveCount(5);
    await page.getByTestId("compare-segment-2").click();
    await expect(page.getByTestId("compare-board")).toHaveAttribute("data-narrating", "");
    await expect(page.getByTestId("compare-segment-2")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("compare-narration-time")).toContainText("0:51 / 2:10");
    await page.getByTestId("compare-narration-toggle").click();
    await expect(page.getByTestId("compare-narration")).toHaveAttribute("data-playing", "");
    await expect(page.getByTestId("compare-narration-time")).not.toContainText("0:51 /", { timeout: 5_000 });
    await page.getByTestId("compare-narration-toggle").click();
    await expect(page.getByTestId("compare-narration")).not.toHaveAttribute("data-playing", "");
  });

  test("an audio file that fails to load → the audio_failed banner (the text stays)", { tag: ["@demo:V3LegendCompare.state=audio_failed"] }, async ({ page }) => {
    // The demo's narration is a generated WAV behind a blob: URL (no network request to abort), so the audio URL is
    // replaced by one that cannot load: the <audio> element's `error` event is the path a real aborted file takes.
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource) =>
        obj instanceof Blob && obj.type.startsWith("audio/") ? `${location.origin}/__e2e-missing-audio.wav` : create(obj);
    });
    await openDemo(page, "/dev/ui/compare?state=default", "compare-screen");
    // A click before hydration is lost: press Play until the failed load shows (the button disables itself then).
    await retryUntil(
      () => page.getByTestId("compare-narration-toggle").click({ timeout: 3_000 }),
      () => expect(page.getByTestId("compare-audio-failed")).toBeVisible({ timeout: 3_000 }),
    );
    await expect(page.getByTestId("compare-narration-toggle")).toBeDisabled();
    await expect(page.getByTestId("compare-segments")).toBeVisible();
  });

  test("audio_failed: the banner, Play disabled, the text still there", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=audio_failed", "compare-screen");
    await expect(page.getByTestId("compare-audio-failed")).toHaveText("Audio unavailable. The text below is the same explanation.");
    await expect(page.getByTestId("compare-narration-toggle")).toBeDisabled();
    await expect(page.getByTestId("compare-segments")).toBeVisible();
  });

  test("no_explanation: the template paragraph and the P3 copy", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=no_explanation", "compare-screen");
    await expect(page.getByTestId("compare-no-explanation")).toHaveText("This position has no narrated walkthrough yet. Your moves and Morphy’s are in the other tabs.");
    await expect(page.getByTestId("compare-narration")).toHaveCount(0);
  });

  test("pending_evals: a ghost, one compute, then the evals", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=pending_evals", "compare-screen");
    await expect(page.getByTestId("compare-eval-pending")).toBeVisible();
    await expect(page.getByTestId("compare-eval")).toHaveText("Win chances after the split: you 41% · Morphy 78%", { timeout: 10_000 });
    await expect(page.getByTestId("compare-screen")).toHaveAttribute("data-status", "ready");
  });

  test("error: Couldn't load the comparison + Try Again (A9b) → ready", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=error", "compare-screen");
    await expect(page.getByTestId("compare-error")).toContainText("Couldn’t load the comparison.");
    await page.getByTestId("compare-try-again").click();
    await expect(page.getByTestId("compare-error")).toHaveCount(0, { timeout: 10_000 });
  });

  test("variants: followed and opponent_left", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=followed", "compare-screen");
    await expect(page.getByTestId("compare-summary")).toHaveText("You found every one of Morphy’s moves.");
    await expect(page.getByTestId("compare-jump-split")).toHaveCount(0);
    await openDemo(page, "/dev/ui/compare?state=opponent_left", "compare-screen");
    await expect(page.getByTestId("compare-paragraph")).toContainText("The engine left the game’s path on 11…Nfd7");
    await expect(page.getByTestId("compare-eval")).toHaveCount(0);
  });

  test("footer: Practice from Here and Share (both bars)", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=default", "compare-screen");
    const practice = isPhone(page) ? visible(page, "compare-bar-practice") : visible(page, "compare-practice-here");
    await expect(practice).toHaveAttribute("href", /\/practice\?game=[a-z0-9]+&ply=4&from=compare$/);
    await expect(isPhone(page) ? visible(page, "compare-bar-share") : visible(page, "compare-share")).toHaveAttribute("href", /\/review\/[a-z0-9]+\/share$/);
  });

  test("stress: long names and title stay in the viewport", async ({ page }) => {
    await openDemo(page, "/dev/ui/compare?state=default&stress=1", "compare-screen");
    await boardInView(page, "compare-board");
    await noDocumentScroll(page);
  });
});
