// Share analysis on /dev/ui/review/share (phase-03 plan §4.3, F6): every state and the local actions (the network half
// is WP-H's review-share.spec.ts). @demo:V3RvShare.generating @demo:V3RvShare.ready
import { DEVICES, expect, noDocumentScroll, openDemo, test } from "./_demo";

test.use(DEVICES["desktop-1440"]);

test.describe("review-share demo", { tag: ["@p3"] }, () => {
  test("generating: the card spinner, link actions off, Copy PGN on @demo:V3RvShare.generating", async ({ page }) => {
    await openDemo(page, "/dev/ui/review/share?state=generating", "share-screen");
    await expect(page.getByTestId("share-generating")).toHaveText(/GENERATING/);
    await expect(page.getByTestId("share-copy")).toBeDisabled();
    await expect(page.getByTestId("share-download")).toBeDisabled();
    await expect(page.getByTestId("share-post-x")).toBeDisabled();
    await expect(page.getByTestId("share-copy-pgn")).toBeEnabled();
  });

  test("ready: Copy Link, the username toggle masks the card, Stop Sharing → revoked → a new link @demo:V3RvShare.ready", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDemo(page, "/dev/ui/review/share?state=ready", "share-screen");
    await expect(page.getByTestId("share-link")).toHaveValue("playchess.tech/r/k7m2x9qa");
    await expect(page.getByTestId("share-preview-title")).toHaveText("knightowl_88 vs Opponent (1203)");
    await expect(page.getByTestId("share-preview")).toContainText("Key moment: 19.Qd2. Rxf5 wins the bishop on f5.");
    await page.getByTestId("share-copy").click();
    await expect(page.getByTestId("share-copied")).toHaveText("COPIED · LINK WORKS FOR 30 DAYS");
    await expect(page.getByTestId("share-copy")).toHaveText(/Link Copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://playchess.tech/r/k7m2x9qa");
    await expect(page.getByTestId("share-copy")).toHaveText(/Copy Link/, { timeout: 4_000 });
    await expect(page.getByTestId("share-download")).toHaveAttribute("href", "https://playchess.tech/r/k7m2x9qa/og?v=1&download=1");
    await page.getByTestId("share-show-username").click();
    await expect(page.getByTestId("share-preview-title")).toHaveText("A Replay Chess player vs Opponent (1203)");
    await page.getByTestId("share-stop").click();
    await expect(page.getByTestId("share-revoked")).toContainText("Link turned off. Anyone opening it now sees an expired page.");
    await page.getByTestId("share-create-new").click();
    await expect(page.getByTestId("share-screen")).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
    await noDocumentScroll(page);
  });

  test("error, rate_limited and revoked states", async ({ page }) => {
    await openDemo(page, "/dev/ui/review/share?state=error", "share-screen");
    await expect(page.getByTestId("share-error")).toContainText("Couldn’t create the link. Try again.");
    await expect(page.getByTestId("share-try-again")).toBeVisible();
    await openDemo(page, "/dev/ui/review/share?state=rate_limited", "share-screen");
    await expect(page.getByTestId("share-rate-limited")).toHaveText("You’ve made a lot of links today. Try again in 3 h.");
    await expect(page.getByTestId("share-copy-bar").or(page.getByTestId("share-copy")).filter({ visible: true })).toBeDisabled();
    await openDemo(page, "/dev/ui/review/share?state=revoked", "share-screen");
    await expect(page.getByTestId("share-create-new")).toBeVisible();
  });

  test.describe("iphone@100", () => {
    test.use(DEVICES.iphone);

    test("phones: Copy Link pinned at the bottom, one scroller", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
      await openDemo(page, "/dev/ui/review/share?state=ready", "share-screen");
      await expect(page.getByTestId("share-copy")).toBeHidden();
      await expect(page.getByTestId("share-copy-bar")).toBeInViewport();
      await noDocumentScroll(page);
    });
  });
});
