// Visual baselines of the P5 screens (phase-05 plan §12.4 `e2e/visual/{train,home}.spec.ts`, testing X10). @p5 @visual
//
// The plan names e2e/visual/{train,home}.spec.ts; the devices config matches layout/** on the layout projects (P3's review.visual.spec.ts
// and P4's p04.visual.spec.ts live here for the same reason), so the file sits beside them.
//
// The drill solving and graded (the grade bar), a correct puzzle, the hub, the Mistake Bank (phones: with the filter
// sheet open), Home populated and Home for a new user, on desktop-1440, desktop-1280, iPad landscape and portrait,
// iPhone and Android at 100 %, light and dark; desktop-1440 also at 125 % and 150 %. Reduced motion (the devices
// config), a fixed browser clock, `[data-vr-mask]` masked, maxDiffPixelRatio 0.002 (the config).
//
// Made and compared only in the official Playwright image (fonts and rasterisation must match). From the repo root,
// with the app on the host's :3100 (or :3000), through a loopback proxy inside the container so the page origin stays
// http://localhost (a secure context, as in CI):
//   docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":"$PWD" -w "$PWD/apps/web" \
//     -e DEVICES_BASE_URL=http://localhost:3100 mcr.microsoft.com/playwright:v1.58.2-noble \
//     bash -c 'node e2e/devices/loopback-proxy.mjs 3100 host.docker.internal:3100 & \
//       npx playwright test -c playwright.devices.config.ts layout/p05.visual.spec.ts --update-snapshots'
// Baselines change only through the `update-snapshots` label (.github/workflows/update-snapshots.yml).
import { setTheme } from "../a11y";
import { familyOf } from "../game/families";
import { expect, test, waitForStable } from "../helpers";

const OFFICIAL_IMAGE = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright";
const RUN = OFFICIAL_IMAGE || process.env.VISUAL === "1";
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const THEME_STORAGE_KEY = "chess-battle-theme";
const PROJECTS = new Set([
  "desktop-1440@100",
  "desktop-1440@125",
  "desktop-1440@150",
  "desktop-1280@100",
  "ipad-landscape@100",
  "ipad-portrait@100",
  "iphone@100",
  "android@100",
]);

type Shot = { id: string; path: (phone: boolean) => string; ready: string };

const P5_SHOTS: Shot[] = [
  { id: "drill-solve", path: () => "/dev/ui/train/runner?state=solve", ready: '[data-testid="trainer-board"][data-input]' },
  { id: "drill-graded", path: () => "/dev/ui/train/runner?state=correct", ready: '[data-testid="trainer-grades"]' },
  { id: "puzzle-correct", path: () => "/dev/ui/train/puzzles?state=correct", ready: '[data-testid="trainer-grades"]' },
  { id: "hub-default", path: () => "/dev/ui/train/hub?state=default", ready: '[data-testid="train-hub"][data-state="default"]' },
  {
    id: "bank-default",
    path: (phone) => (phone ? "/dev/ui/train/bank?state=default&open=1" : "/dev/ui/train/bank?state=default"),
    ready: '[data-testid="train-bank"]',
  },
  { id: "home-populated", path: () => "/dev/ui/home?state=populated", ready: '[data-testid="home"][data-state="populated"]' },
  { id: "home-new-user", path: () => "/dev/ui/home?state=new_user", ready: '[data-testid="home"][data-state="new_user"]' },
];

test.describe("P5 visual @p5 @visual", () => {
  test.skip(!RUN, "visual baselines run only in the official Playwright image (or with VISUAL=1)");
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!PROJECTS.has(testInfo.project.name), "the plan's visual projects only");
  });

  for (const shot of P5_SHOTS) {
    for (const theme of ["light", "dark"] as const) {
      test(`${shot.id} ${theme}`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const phone = familyOf(testInfo) === "iphone" || familyOf(testInfo) === "android";
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
        const res = await page.goto(shot.path(phone));
        expect(res?.status()).toBe(200);
        await expect(page.locator(shot.ready).first()).toBeVisible({ timeout: 60_000 });
        if (phone && shot.id === "bank-default") await expect(page.getByTestId("bank-filter-panel")).toBeVisible();
        await waitForStable(page);
        await setTheme(page, theme);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(page).toHaveScreenshot(`${shot.id}-${theme}.png`, { mask: [page.locator("[data-vr-mask]")] });
      });
    }
  }
});
