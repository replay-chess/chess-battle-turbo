// axe on every P4 demo state, light and dark (phase-04 plan §12.4 "Accessibility"; testing P4). @p4
//
// P1's expectNoAxeViolations (WCAG 2.0/2.1 A and AA: contrast, names, ARIA, landmarks) on every
// /dev/ui/onboarding/[step]?state=, every /dev/ui/connected?state= and every /dev/ui/activating?kind=&state=, in both
// themes, on desktop-1440@100 (ui-desktop) and iphone@100 (ui-iphone). Titles are `a11y p4 <route> <theme>`.
import { expectNoAxeViolations } from "../a11y";
import { test, waitForStable } from "../helpers";
import { ONBOARDING_DEMO_STATES } from "../layout/onboarding-states";

const PROJECTS = new Set(["ui-desktop", "ui-iphone"]);

const CONNECTED = ["default", "syncing", "sync_failed", "rate_limited", "not_found", "private_games", "li_connecting", "li_denied", "both_linked", "none_linked"];
const ACTIVATING = ["polling", "success", "stalled", "failed"];

const ROUTES: { path: string; ready: string }[] = [
  ...Object.entries(ONBOARDING_DEMO_STATES).flatMap(([step, def]) =>
    Object.keys(def.states).map((state) => ({ path: `/dev/ui/onboarding/${step}?state=${state}`, ready: ".onb-stage" })),
  ),
  ...CONNECTED.map((state) => ({ path: `/dev/ui/connected?state=${state}`, ready: `[data-testid="settings-connected"][data-state="${state}"]` })),
  ...(["checkout", "onboarding"] as const).flatMap((kind) =>
    ACTIVATING.map((state) => ({ path: `/dev/ui/activating?kind=${kind}&state=${state}`, ready: `[data-testid="activation-card"][data-state="${state}"]` })),
  ),
];

for (const route of ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`a11y p4 ${route.path} ${theme} @p4`, async ({ page }, testInfo) => {
      test.skip(!PROJECTS.has(testInfo.project.name), "ui-desktop and ui-iphone only (plan §12.4)");
      const res = await page.goto(route.path);
      test.expect(res?.status(), `${route.path} status`).toBe(200);
      await test.expect(page.locator(route.ready).first()).toBeVisible({ timeout: 30_000 });
      await waitForStable(page);
      await expectNoAxeViolations(page, { theme });
    });
  }
}
