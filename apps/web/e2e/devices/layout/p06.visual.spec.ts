// Visual baselines of the P6 Weakness Profile (phase-06 plan §12.4 "Visual regression", testing X10). @p6 @visual
//
// The plan names e2e/visual/weakness.visual.spec.ts; the devices config matches layout/** on the layout projects (P3's
// review.visual.spec.ts, P4's and P5's pNN.visual.spec.ts live here for the same reason), so the file sits beside them.
//
// V3WeaknessProfile (ready), the drill config, insufficient and computing, on desktop-1440, iPad landscape and portrait,
// iPhone and Android at 100 %, light and dark; desktop-1440 also at 125 % and 150 %. The design states come from the
// /dev/ui/weakness demo (the real WeaknessView on WP1's payload fixtures, so the pixels never depend on the day a run
// happens); every one of them is also reached on real data by e2e/specs/weakness/** (@state: tags). Reduced motion (the
// devices config), a fixed browser clock, `[data-vr-mask]` masked, maxDiffPixelRatio 0.002 (the config).
//
// Made and compared only in the official Playwright image (fonts and rasterisation must match). From the repo root,
// with the app on the host's :3100 (or another port), through a loopback proxy inside the container so the page origin
// stays http://localhost (a secure context, as in CI):
//   docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":"$PWD" -w "$PWD/apps/web" \
//     -e DEVICES_BASE_URL=http://localhost:3100 mcr.microsoft.com/playwright:v1.58.2-noble \
//     bash -c 'node e2e/devices/loopback-proxy.mjs 3100 host.docker.internal:3100 & \
//       npx playwright test -c playwright.devices.config.ts layout/p06.visual.spec.ts --update-snapshots'
// Baselines change only through the `update-snapshots` label (.github/workflows/update-snapshots.yml).
import { setTheme } from "../a11y";
import { expect, test, waitForStable } from "../helpers";

const OFFICIAL_IMAGE = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright";
const RUN = OFFICIAL_IMAGE || process.env.VISUAL === "1";
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const THEME_STORAGE_KEY = "chess-battle-theme";
const PROJECTS = new Set(["desktop-1440@100", "desktop-1440@125", "desktop-1440@150", "ipad-landscape@100", "ipad-portrait@100", "iphone@100", "android@100"]);

const P6_SHOTS = [
  { id: "weakness-profile", path: "/dev/ui/weakness?state=ready", ready: '[data-testid="weakness"][data-status="ready"]' },
  { id: "weakness-drill", path: "/dev/ui/weakness?state=drill", ready: '[data-testid="weakness-drill-start"]' },
  { id: "weakness-insufficient", path: "/dev/ui/weakness?state=insufficient", ready: '[data-testid="weakness-insufficient"]' },
  { id: "weakness-computing", path: "/dev/ui/weakness?state=computing", ready: '[data-testid="weakness-computing"]' },
] as const;

test.describe("P6 visual @p6 @visual", () => {
  test.skip(!RUN, "visual baselines run only in the official Playwright image (or with VISUAL=1)");
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!PROJECTS.has(testInfo.project.name), "the plan's visual projects only");
  });

  for (const shot of P6_SHOTS) {
    for (const theme of ["light", "dark"] as const) {
      test(`${shot.id} ${theme}`, async ({ page }) => {
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
        await expect(page.locator(shot.ready).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
        await waitForStable(page);
        await setTheme(page, theme);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(page).toHaveScreenshot(`${shot.id}-${theme}.png`, { mask: [page.locator("[data-vr-mask]")] });
      });
    }
  }
});
