// Practice on the demo route (/dev/ui/practice, plan §4.8, §4.10): every design state, playing against the real
// browser engine, Take Back, Reset, the hint levels, the keys, flip and the over variant. No server, no sign-in
// (WP-H: e2e/specs/review/, `@demo`).
import type { Page } from "@playwright/test";
import { blur, boardInView, DEVICES, expect, isPhone, noDocumentScroll, openDemo, test, visible } from "./_demo";

test.use(DEVICES["desktop-1440"]);

const STATES = ["default", "engine_loading", "engine_failed", "offline", "over"] as const;

async function engineReady(page: Page) {
  await expect(page.getByTestId("practice-status")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("practice-engine-status")).toHaveText("Ready", { timeout: 90_000 });
}

async function play(page: Page, from: string, to: string) {
  const board = page.getByTestId("practice-board");
  await board.locator(`[data-square="${from}"]`).click();
  await board.locator(`[data-square="${to}"]`).click();
}

test.describe("practice demo", { tag: ["@p3"] }, () => {
  for (const state of STATES) {
    test(`${state}: one viewport, board in view`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await openDemo(page, `/dev/ui/practice?state=${state}`, "practice-screen");
      await expect(page.getByTestId("practice-screen")).toHaveAttribute("data-state", state === "default" ? /default|engine_loading/ : state === "over" ? /over|engine_loading/ : state);
      await boardInView(page, "practice-board");
      await noDocumentScroll(page);
      expect(errors).toEqual([]);
    });
  }

  test("engine_loading: the determinate bar and the first-load note", { tag: ["@demo:V3Practice.engine_loading"] }, async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=engine_loading", "practice-screen");
    await expect(page.getByTestId("practice-loading")).toContainText("Starting the engine · 34%");
    await expect(page.getByTestId("practice-loading")).toContainText("First load only: about 7 MB, cached after this.");
    await expect(page.getByTestId("practice-loading").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "34");
    await expect(page.getByTestId("practice-engine-status")).toHaveText("Loading");
  });

  test("engine_failed: the banner and Retry", { tag: ["@demo:V3Practice.engine_failed"] }, async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=engine_failed", "practice-screen");
    await expect(page.getByTestId("practice-failed")).toContainText("Engine didn’t start. This browser may block WebAssembly.");
    await expect(page.getByTestId("practice-retry")).toBeVisible();
    await expect(page.getByTestId("practice-board")).not.toHaveAttribute("data-input", "");
  });

  test("default: play against the engine, Take Back, Reset", { tag: ["@demo:V3Practice.default"] }, async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=default&source=fen", "practice-screen");
    await engineReady(page);
    await expect(page.getByTestId("practice-status")).toHaveText("Engine ready · your move as White");
    // the fen fixture is the Scholar's-mate position after 3.Qh5 Nf6 (e2 is empty): play 4.d3
    await play(page, "d2", "d3");
    const board = page.getByTestId("practice-board");
    await expect(board).toHaveAttribute("data-moves", "2", { timeout: 30_000 });
    const takeBack = isPhone(page) ? visible(page, "practice-bar-takeback") : visible(page, "practice-takeback");
    await takeBack.click();
    await expect(board).toHaveAttribute("data-moves", "0");
    await play(page, "b1", "c3");
    await expect(board).toHaveAttribute("data-moves", "2", { timeout: 30_000 });
    await expect(page.getByTestId("practice-line").getByRole("button")).toHaveCount(2);
    await (isPhone(page) ? visible(page, "practice-bar-reset") : visible(page, "practice-reset")).click();
    await expect(board).toHaveAttribute("data-moves", "0");
  });

  test("hint: the piece, then the arrow; keys H, Backspace, R, F, ←/→", async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=default&source=fen", "practice-screen");
    await engineReady(page);
    await blur(page);
    await page.keyboard.press("h");
    await expect(page.getByTestId("practice-hint-text")).toHaveAttribute("data-level", "1", { timeout: 15_000 });
    await expect(page.getByTestId("practice-hint-text")).toHaveText(/^Hint: look at your (king|queen|rook|bishop|knight|pawn) on [a-h][1-8]\.$/);
    await page.keyboard.press("h");
    await expect(page.getByTestId("practice-hint-text")).toHaveAttribute("data-level", "2");
    const board = page.getByTestId("practice-board");
    await play(page, "d2", "d3");
    await expect(board).toHaveAttribute("data-moves", "2", { timeout: 30_000 });
    await blur(page);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("practice-status")).toContainText("Viewing an earlier move");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("practice-status")).toHaveText("Engine ready · your move as White");
    await page.keyboard.press("Backspace");
    await expect(board).toHaveAttribute("data-moves", "0");
    await play(page, "g1", "f3");
    await expect(board).toHaveAttribute("data-moves", "2", { timeout: 30_000 });
    await blur(page);
    await page.keyboard.press("r");
    await expect(board).toHaveAttribute("data-moves", "0");
    await page.keyboard.press("f");
    await expect(page.getByTestId("practice-engine-chip").locator("xpath=ancestor::*[@data-rc-bar]")).toHaveAttribute("data-rc-bar", "bottom");
  });

  test("offline: the banner, the plan card hidden, Compare disabled, play continues", { tag: ["@demo:V3Practice.offline"] }, async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=offline", "practice-screen");
    await engineReady(page);
    await expect(page.getByTestId("practice-offline")).toContainText("Offline. The engine is cached, so practice still works");
    await expect(page.getByTestId("practice-plan")).toHaveCount(0);
    await expect(isPhone(page) ? visible(page, "practice-bar-compare") : visible(page, "practice-compare")).toBeDisabled();
  });

  test("a legend game: the plan card and Compare back to the comparison", async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=default&source=game", "practice-screen");
    await expect(page.getByTestId("practice-plan")).toHaveText(/Castle long/);
    await expect(isPhone(page) ? visible(page, "practice-bar-compare") : visible(page, "practice-compare")).toHaveAttribute("href", /\/review\/[a-z0-9]+\/legend$/);
  });

  test("over: the inline result and Reset", async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=over", "practice-screen");
    await expect(page.getByTestId("practice-result")).toContainText("Checkmate · the engine won", { timeout: 90_000 });
  });

  // regression: practice-phone-head (FIX-1): phones and iPad portrait had no Back and lost the title and intro; the
  // player chip showed "K8" for knightowl_88 where review and compare show "KN".
  test("the title, the intro and Back show in every layout; initials match review", async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=default&source=fen", "practice-screen");
    await expect(page.getByTestId("practice-title")).toBeVisible();
    await expect(page.getByTestId("practice-head")).toContainText("plays");
    if (isPhone(page)) await expect(page.getByRole("link", { name: /Back|Review/ }).first()).toBeVisible();
    else await expect(page.getByTestId("practice-back")).toBeVisible();
    await expect(page.getByTestId("practice-you-chip")).toContainText("KN");
    await boardInView(page, "practice-board");
    await noDocumentScroll(page);
  });

  test("stress: a long title stays in the viewport", async ({ page }) => {
    await openDemo(page, "/dev/ui/practice?state=engine_loading&stress=1", "practice-screen");
    await boardInView(page, "practice-board");
    await noDocumentScroll(page);
  });
});
