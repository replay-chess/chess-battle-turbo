// Live analysis (phase-03 plan §12.3 `review-live.spec.ts` @smoke; owner tests T1, T2):
// 1. a bot game played to resignation → the game-over primary is the disabled `Analysing · nn%` → done: the coach line,
//    the accuracy eyebrow and See What the Coach Thinks → the review `summary`; `review_opened{source:"game_over"}`;
// 2. a second game (finished through the API) opened from /games while it analyses: the top row says Analysing, the
//    review opens in `analysing`, badges fill in, it auto-advances to the summary within 60 s, and the row flips to its
//    headline.
// The worker must not finish before the page looks: each game arms a one-shot `pause_at:writing` through the signed test
// kick (honoured by the CI worker, APP_ENV=test). A dev-branch worker (APP_ENV=dev, the real engine) ignores kick faults;
// run it with E2E_WORKER_FAULT=pause_at:writing:5000 for this spec (e2e/README.md).
import type { Page } from "@playwright/test";
import { ChessBoardHelper } from "../../fixtures/chess-board";
import { gameTags } from "../game/tags";
import { completeBotGame, createBotGame, kickWorker } from "./_lib/games";
import { DEVICES, expect, gotoOk, noDocumentScroll, reviewStateTags, test } from "./_lib/review";

const board = (p: Page) => p.locator('[data-testid="game-board-container"]');

/** Plays `n` own moves against the in-browser engine (the member is White). */
async function playMoves(page: Page, n: number) {
  const helper = new ChessBoardHelper(page);
  for (let k = 0; k < n; k++) {
    await expect(board(page)).toHaveAttribute("data-current-turn", "w", { timeout: 90_000 });
    const before = Number(await board(page).getAttribute("data-ply"));
    await helper.playValidMove("w");
    await expect.poll(async () => Number(await board(page).getAttribute("data-ply")), { timeout: 90_000 }).toBeGreaterThan(before);
  }
  await expect(board(page)).toHaveAttribute("data-current-turn", "w", { timeout: 90_000 });
}

async function resign(page: Page) {
  const menu = page.locator('[data-testid="game-menu-button"]:visible, [data-testid="game-menu-button-bar"]:visible').first();
  if (await menu.count()) await menu.click();
  await page.locator('[data-testid="resign-button"]:visible, [data-testid="resign-button-bar"]:visible').first().click();
  await page.locator('[data-testid="confirm-resign-button"]').click();
}

test.describe("live analysis", { tag: ["@p3", "@smoke", "@local-only"] }, () => {
  // Both tests finish games as member E, and analysis_queued is counted per user: never in parallel.
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test(
    "game over: Analysing · nn% → coach line → See What the Coach Thinks → summary",
    { tag: [...gameTags("state", ["over_analysing"]), "@state:V3GameOverLegend.over_analysing"] },
    async ({ member, page, telemetry }) => {
      test.setTimeout(420_000);
      await member("E");
      const ref = await createBotGame(page);
      await kickWorker({ watch: ref, fault: "pause_at:writing:4000" });
      await gotoOk(page, `/game/${ref}`);
      await expect(board(page)).toHaveAttribute("data-phase", "bot", { timeout: 120_000 });
      await playMoves(page, 6);
      await resign(page);

      const analysing = page.getByTestId("review-analysing").filter({ visible: true });
      await expect(analysing).toBeVisible({ timeout: 60_000 });
      await expect(analysing).toBeDisabled();
      await expect(analysing).toHaveText(/Analysing · \d+%/);

      const cta = page.getByTestId("review-coach-cta").filter({ visible: true });
      await expect(cta).toBeVisible({ timeout: 180_000 });
      await expect(cta).toHaveText(/See What the Coach Thinks/);
      await expect(page.getByTestId("review-coach-line").filter({ visible: true })).toBeVisible();
      await expect(page.getByTestId("review-accuracy").filter({ visible: true })).toContainText(/Accuracy \d+/i);
      await cta.click();
      await telemetry.expect("game_over_review_clicked", { status_at_click: "done", has_coach_line: true }, { source: "client" });
      await page.waitForURL(new RegExp(`/review/${ref}`), { timeout: 60_000 });
      await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
      await expect(page.getByTestId("review-summary")).toBeVisible();
      await noDocumentScroll(page);
      // Last, the events of plan §10.1: the open's source after a client-side navigation from the game-over card, and
      // the server's analysis_queued for the finished game (once per dedupeKey).
      await telemetry.expect("review_opened", { source: "game_over", status: "done" }, { source: "client" });
      // The sink is shared by every parallel test: only member E's events count (regression: analysis-queued-once).
      const me = (await (await page.request.get("/api/me")).json()) as { data: { user: { ref: string } } };
      await telemetry.expect("analysis_queued", { game_mode: "bot", reason: "bot_end" }, { source: "server", count: 1, distinctId: me.data.user.ref });
    },
  );

  test(
    "opened from /games while analysing: badges fill in, then the summary; the row flips to its headline",
    { tag: [...reviewStateTags("analysing"), ...reviewStateTags("summary"), "@state:V3GamesArchive.default"] },
    async ({ member, page, telemetry }) => {
      test.setTimeout(300_000);
      await member("E");
      const ref = await createBotGame(page);
      await kickWorker({ watch: ref, fault: "pause_at:writing:20000" });
      const seed = await completeBotGame(page, ref);
      expect(seed.status).toBe("queued");

      await gotoOk(page, "/games");
      const row = page.locator(`[data-testid="games-row"][data-ref="${ref}"]`);
      await expect(page.getByTestId("games-row").first()).toHaveAttribute("data-ref", ref, { timeout: 60_000 });
      await expect(row).toHaveAttribute("data-status", /queued|running/);
      await expect(row).toContainText("Analysing");
      await row.click();
      const open = page.getByTestId("games-open-review");
      if (await open.isVisible()) await open.click();
      await page.waitForURL(new RegExp(`/review/${ref}`), { timeout: 60_000 });

      const screen = page.getByTestId("review-screen");
      await expect(page.getByTestId("analysing-card")).toBeVisible({ timeout: 60_000 });
      // Badges appear as plies are graded, then the view auto-advances to the summary (≤ 60 s).
      const badges = page.locator(".rv-mv [data-q]");
      const counts: number[] = [];
      await expect
        .poll(
          async () => {
            counts.push(await badges.count());
            return (await screen.getAttribute("data-status")) === "done";
          },
          { timeout: 60_000, intervals: [250] },
        )
        .toBe(true);
      await expect(page.getByTestId("review-summary")).toBeVisible({ timeout: 30_000 });
      expect(Math.max(...counts), `badge counts while analysing: ${counts.join(",")}`).toBeGreaterThan(0);

      await gotoOk(page, "/games");
      await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
      await expect(row).not.toContainText("Analysing");
      // Last: the open's source (plan §10.1) after a client-side navigation from the archive.
      await telemetry.expect("review_opened", { source: "archive" }, { source: "client" });
    },
  );
});

