// Visual baselines of the P4 screens (phase-04 plan §12.4 "Visual baselines", testing X10). @p4 @visual
//
// The plan names e2e/devices/visual/p04.spec.ts; the devices config matches layout/** on the layout projects (P3's
// review.visual.spec.ts lives here for the same reason), so the file sits beside it.
//
// Nine demo states (Welcome, Confirm found, Level prefilled, Plan with the trial and trial used, Done importing,
// /checkout/activating stalled, Connected accounts default and sync_failed) on desktop-1440@100 and iphone@100, light
// and dark, reduced motion (the devices config), a fixed browser clock, `[data-vr-mask]` (relative dates) masked.
// Made and compared only in the official Playwright image (fonts and rasterisation must match), e.g. from the repo
// root with the devices server on the host (:3100):
//   docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":"$PWD" -w "$PWD/apps/web" \
//     -e DEVICES_BASE_URL=http://host.docker.internal:3100 mcr.microsoft.com/playwright:v1.58.2-noble \
//     npx playwright test -c playwright.devices.config.ts layout/p04.visual.spec.ts --update-snapshots
// The side-by-side check against the canvas boards stays manual (the sign-off record).
import { setTheme } from "../a11y";
import { familyOf } from "../game/families";
import { expect, test, waitForStable } from "../helpers";

const OFFICIAL_IMAGE = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright";
const RUN = OFFICIAL_IMAGE || process.env.VISUAL === "1";
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const THEME_STORAGE_KEY = "chess-battle-theme";
const PROJECTS = new Set(["desktop-1440@100", "iphone@100"]);

type Shot = { id: string; path: string; ready: string; tags: (family: "desktop" | "iphone") => string[] };

const onb = (family: "desktop" | "iphone", board: string, state: string) => [`@demo:${family === "iphone" ? "V3iPhone" : "V3"}${board}.${state}`];

const SHOTS: Shot[] = [
  { id: "onb-welcome", path: "/dev/ui/onboarding/welcome?state=default", ready: '[data-testid="onb-welcome"]', tags: (f) => onb(f, "OnbWelcome", "default") },
  { id: "onb-preview-found", path: "/dev/ui/onboarding/confirm?state=default", ready: '[data-testid="onb-confirm"]', tags: (f) => onb(f, "OnbPreview", "default") },
  { id: "onb-rating-prefilled", path: "/dev/ui/onboarding/level?state=prefilled", ready: '[data-testid="onb-level"]', tags: (f) => onb(f, "OnbRating", "prefilled") },
  { id: "onb-plan-trial", path: "/dev/ui/onboarding/plan?state=default", ready: '[data-testid="onb-plan"]', tags: (f) => onb(f, "OnbPlan", "default") },
  { id: "onb-plan-trial-used", path: "/dev/ui/onboarding/plan?state=trial_used", ready: '[data-testid="onb-plan"]', tags: () => [] },
  { id: "onb-done-importing", path: "/dev/ui/onboarding/done?state=importing", ready: '[data-testid="onb-done"]', tags: (f) => onb(f, "OnbDone", "importing") },
  { id: "checkout-activating-stalled", path: "/dev/ui/activating?kind=checkout&state=stalled", ready: '[data-testid="activation-card"][data-state="stalled"]', tags: () => ["@demo:V3CheckoutActivating.stalled"] },
  { id: "connected-default", path: "/dev/ui/connected?state=default", ready: '[data-testid="settings-connected"][data-state="default"]', tags: () => ["@demo:V4SettingsConnected.default"] },
  { id: "connected-sync-failed", path: "/dev/ui/connected?state=sync_failed", ready: '[data-testid="settings-connected"][data-state="sync_failed"]', tags: () => ["@demo:V4SettingsConnected.sync_failed"] },
];

test.describe("P4 visual @p4 @visual", () => {
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
