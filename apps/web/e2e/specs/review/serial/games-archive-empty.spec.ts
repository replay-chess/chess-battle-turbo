// The empty archive (phase-03 plan §12.3 `games-archive.spec.ts`, the leased `review-empty` persona; owner test T12).
// In review/serial/ with the other leasing specs: the game-serial project runs one worker, so every lease lands on pool
// user 1 (personas need provisioned pool users, e2e/fixtures/lease.ts).
import { DEVICES, expect, gotoOk, test } from "../_lib/review";

test.describe("games archive · empty", { tag: ["@p3"] }, () => {
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test("the leased review-empty persona sees `empty`", { tag: ["V3GamesArchive", "V3GamesArchiveEmpty", "V3GamesArchiveFilters"].map((b) => `@state:${b}.empty`) }, async ({ page, persona }) => {
    test.setTimeout(240_000);
    await persona("review-empty");
    await gotoOk(page, "/games");
    await expect(page.locator('[data-testid="games-archive"][data-state="empty"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("games-empty-play")).toHaveAttribute("href", "/play");
  });
});
