// Visual baselines of the game screen (phase-02 plan 12.7, testing X10). @p2 @visual
//
// Eight demo states on desktop-1440@100 and iphone@100, light and dark, reduced motion (the devices config), a fixed
// browser clock (static demo states) and the demo server clock frozen (`freeze=1`); avatars masked with
// [data-vr-mask]. Made and compared only in the official Playwright image (see ../ui/visual.spec.ts), e.g.:
//   docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":"$PWD" -w "$PWD/apps/web" \
//     -e DEVICES_BASE_URL=http://host.docker.internal:3100 mcr.microsoft.com/playwright:v1.58.2-noble \
//     npx playwright test -c e2e/devices/game/game.config.ts visual.spec.ts --update-snapshots
import { setTheme } from "../a11y";
import { expect, test, waitForStable } from "../helpers";
import { demoTags, familyOf } from "./families";

const OFFICIAL_IMAGE = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright";
const RUN = OFFICIAL_IMAGE || process.env.VISUAL === "1";
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const THEME_STORAGE_KEY = "chess-battle-theme";
const PROJECTS = new Set(["desktop-1440@100", "iphone@100"]);
const STATES = ["your_move", "check", "over_checkmate_win", "promotion", "draw_received", "reconnecting", "spectate", "over_threefold"];
const MODE: Record<string, string> = { spectate: "&mode=spectate" };

test.describe("game visual @p2 @visual", () => {
  test.skip(!RUN, "visual baselines run only in the official Playwright image (or with VISUAL=1)");
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!PROJECTS.has(testInfo.project.name), "desktop-1440@100 and iphone@100 only");
  });

  for (const state of STATES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${state} ${theme}`, { tag: [...demoTags("desktop", state), ...demoTags("iphone", state)] }, async ({ page }, testInfo) => {
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
        const res = await page.goto(`/dev/ui/game?state=${state}&freeze=1${MODE[state] ?? ""}`);
        expect(res?.status()).toBe(200);
        await waitForStable(page);
        await setTheme(page, theme);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(page).toHaveScreenshot(`${familyOf(testInfo)}-${state}-${theme}.png`, {
          mask: [page.locator("[data-vr-mask]")],
        });
      });
    }
  }
});
