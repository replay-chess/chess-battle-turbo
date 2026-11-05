// Visual baselines (phase-01 plan §12.4, CT X10; 1Q·2). @p1 @visual
//
// The five gallery sections and the shell demo, in light and dark, on the 4 UI projects (48 images in
// e2e/__screenshots__/<project>/ui/visual.spec.ts/). Design parity with the .dc.html boards stays a manual
// side-by-side in the sign-off; these catch unintended change.
//
// Fonts and rasterisation differ between machines, so the baselines are made and compared only in the
// official image (mcr.microsoft.com/playwright:v<@playwright/test version>-noble, where
// PLAYWRIGHT_BROWSERS_PATH=/ms-playwright); elsewhere every test skips. VISUAL=1 forces a run anyway.
//
// Regenerate:
// - on a PR: add the `update-snapshots` label (.github/workflows/update-snapshots.yml commits the result);
// - locally: build and start the devices server on the host (port 3100), then
//     docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD":"$PWD" -w "$PWD/apps/web" \
//       -e DEVICES_BASE_URL=http://host.docker.internal:3100 mcr.microsoft.com/playwright:v1.58.2-noble \
//       npx playwright test -c playwright.devices.config.ts ui/visual.spec.ts --update-snapshots
//   from the repo root (the repo's node_modules are reused; only the browsers come from the image).
import { setTheme } from "../a11y";
import { expect, test, waitForStable } from "../helpers";

const OFFICIAL_IMAGE = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright";
const RUN = OFFICIAL_IMAGE || process.env.VISUAL === "1";

/** A fixed clock, so anything that reads the time renders the same on every run. */
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const THEME_STORAGE_KEY = "chess-battle-theme"; // app/components/ThemeProvider.tsx (same key as a11y.ts)

// `tags`: design states the page shows (docs/qa/design-states.json), for scripts/qa/state-coverage.ts.
const PAGES: { id: string; path: string; tags?: string }[] = [
  { id: "foundations", path: "/dev/ui/sections/foundations" },
  { id: "controls", path: "/dev/ui/sections/controls", tags: " @demo:V3EmptyStates" },
  { id: "overlays", path: "/dev/ui/sections/overlays" },
  { id: "shell", path: "/dev/ui/sections/shell" },
  { id: "layout", path: "/dev/ui/sections/layout" },
  { id: "shell-demo", path: "/dev/ui/shell" },
];

test.describe("visual @p1 @visual", () => {
  test.skip(!RUN, "visual baselines run only in the official Playwright image (or with VISUAL=1)");

  for (const { id, path, tags = "" } of PAGES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${id} ${theme}${tags}`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.clock.install({ time: FIXED_NOW });
        await page.addInitScript(
          ({ key, value }) => {
            try {
              localStorage.setItem(key, value);
            } catch {
              // Storage blocked: setTheme() below still switches the class.
            }
          },
          { key: THEME_STORAGE_KEY, value: theme },
        );
        const res = await page.goto(path);
        expect(res?.status(), `${path} status`).toBe(200);
        await waitForStable(page);
        await setTheme(page, theme);
        // Hide the text caret and any focus ring left by the theme toggle.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(page).toHaveScreenshot(`${id}-${theme}.png`, {
          fullPage: true,
          // Avatars with remote images and relative dates opt in with data-vr-mask.
          mask: [page.locator("[data-vr-mask]")],
        });
      });
    }
  }
});
