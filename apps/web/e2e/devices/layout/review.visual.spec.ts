// Visual baselines of the P3 screens (phase-03 plan §12.3 "Visual regression", TST X10). @p3 @visual
//
// Ten demo states (summary, a revealed moment, the clean game, Review complete, Share ready, the archive, Compare's
// Explanation tab, Practice, the game-over card done and legend) on desktop-1440@100 and iphone@100, light and dark,
// reduced motion (the devices config), a fixed browser clock. Made and compared only in the official Playwright image
// (see ../ui/visual.spec.ts for the reasons and the Docker command), e.g. from the repo root with the devices server on
// the host (:3100):
//   docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":"$PWD" -w "$PWD/apps/web" \
//     -e DEVICES_BASE_URL=http://host.docker.internal:3100 mcr.microsoft.com/playwright:v1.58.2-noble \
//     npx playwright test -c playwright.devices.config.ts layout/review.visual.spec.ts --update-snapshots
import { setTheme } from "../a11y";
import { familyOf } from "../game/families";
import { expect, test, waitForStable } from "../helpers";

const OFFICIAL_IMAGE = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright";
const RUN = OFFICIAL_IMAGE || process.env.VISUAL === "1";
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const THEME_STORAGE_KEY = "chess-battle-theme";
const PROJECTS = new Set(["desktop-1440@100", "iphone@100"]);

/** `ready`: the selector that proves the state rendered. */
const SHOTS: { id: string; path: string; ready: string; tags: (family: string) => string[] }[] = [
  { id: "review-summary", path: "/dev/ui/review?state=summary", ready: '[data-testid="review-summary"]', tags: (f) => (f === "iphone" ? ["@demo:V3iPhoneReview.summary"] : ["@demo:V3ReviewSummary.summary"]) },
  { id: "review-moment-reveal", path: "/dev/ui/review?state=moment&phase=reveal", ready: '[data-testid="moment-answer"]', tags: (f) => (f === "iphone" ? ["@demo:V3iPhoneReview.moment"] : ["@demo:V3KeyMoments.moment"]) },
  { id: "review-clean", path: "/dev/ui/review?state=clean", ready: '[data-testid="clean-note"]', tags: (f) => (f === "iphone" ? ["@demo:V3iPhoneReview.clean"] : ["@demo:V3ReviewClean.clean"]) },
  { id: "complete", path: "/dev/ui/review/complete?state=default", ready: '[data-testid="review-complete"]', tags: () => ["@demo:V3RvComplete.default"] },
  { id: "share-ready", path: "/dev/ui/review/share?state=ready", ready: '[data-testid="share-screen"]', tags: () => ["@demo:V3RvShare.ready"] },
  { id: "archive", path: "/dev/ui/games?state=default", ready: '[data-testid="games-archive"]', tags: () => ["@demo:V3GamesArchive.default"] },
  { id: "compare-explanation", path: "/dev/ui/compare?state=default&tab=explanation", ready: '[data-testid="compare-screen"]', tags: () => ["@demo:V3LegendCompare.tab=explanation"] },
  { id: "practice", path: "/dev/ui/practice?state=default", ready: '[data-testid="practice-screen"][data-state="default"]', tags: () => ["@demo:V3Practice.default"] },
  { id: "game-over-done", path: "/dev/ui/game-over?slot=done", ready: '[data-testid="game-over-demo"]', tags: () => [] },
  { id: "game-over-legend", path: "/dev/ui/game-over?slot=legend", ready: '[data-testid="game-over-demo"]', tags: () => ["@demo:V3GameOverLegend.over_legend"] },
];

test.describe("review visual @p3 @visual", () => {
  test.skip(!RUN, "visual baselines run only in the official Playwright image (or with VISUAL=1)");
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!PROJECTS.has(testInfo.project.name), "desktop-1440@100 and iphone@100 only");
  });

  for (const family of ["desktop", "iphone"] as const) {
    for (const shot of SHOTS) {
      for (const theme of ["light", "dark"] as const) {
        test(`${family} ${shot.id} ${theme}`, { tag: shot.tags(family) }, async ({ page }, testInfo) => {
          test.skip(familyOf(testInfo) !== family, `${family} baseline`);
          test.setTimeout(90_000);
          await page.clock.install({ time: FIXED_NOW });
          await page.addInitScript(
            ({ key, value }) => {
              try {
                localStorage.setItem(key, value);
              } catch {
                // storage blocked: setTheme() still switches the class
              }
            },
            { key: THEME_STORAGE_KEY, value: theme },
          );
          const res = await page.goto(shot.path);
          expect(res?.status()).toBe(200);
          await expect(page.locator(shot.ready).first()).toBeVisible({ timeout: 60_000 });
          await waitForStable(page);
          await setTheme(page, theme);
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await expect(page).toHaveScreenshot(`${family}-${shot.id}-${theme}.png`, {
            mask: [page.locator("[data-vr-mask]")],
          });
        });
      }
    }
  }
});
