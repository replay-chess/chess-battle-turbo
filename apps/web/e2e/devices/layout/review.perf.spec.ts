// CLS ≤ 0.05 on the review at every zoom of the device matrix (phase-03 plan §9.1 "/review/[ref] LCP / INP / CLS … CLS
// ≤ 0.05 at every zoom of the device matrix (a lab gate; field data cannot segment by zoom, AP-35)"). Runs on every
// layout project of the tier (PR: 4 projects; nightly: all 40, so every zoom), on the production build the devices suite
// serves. The demo states render the real ReviewScreen with fixture data: the summary, a key moment, the analysing
// view and Compare. Chromium only (layout-shift entries). The real route's TTFB/LCP/INP gates are the main suite's
// e2e/specs/review/review-perf.spec.ts.
// regression: review-lab-perf-gates (FIX-1): no review spec measured layout shifts.
import { isChromium } from "../helpers";
import { expect, gotoStable, hasInsets, test } from "./fixtures";

const CLS_BUDGET = 0.05;

const ROUTES = [
  { path: "/dev/ui/review?state=summary", ready: "review-summary" },
  { path: "/dev/ui/review?state=moment&phase=ask", ready: "moment-panel" },
  { path: "/dev/ui/review?state=analysing", ready: "review-screen" },
  { path: "/dev/ui/compare?state=default&tab=explanation", ready: "compare-screen" },
] as const;

for (const route of ROUTES) {
  test(`no layout shift over ${CLS_BUDGET} on load: ${route.path} @p3`, async ({ page }, testInfo) => {
    test.skip(!isChromium(testInfo), "layout-shift entries are Chromium-only");
    test.skip(hasInsets(testInfo), "projects without insets only (the inset emulation re-lays out the page once)");
    await page.addInitScript(() => {
      const w = window as unknown as { __rcCls: number };
      w.__rcCls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!e.hadRecentInput) w.__rcCls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await gotoStable(page, route.path);
    await expect(page.getByTestId(route.ready).filter({ visible: true }).first()).toBeVisible();
    // Late shifts count too: fonts, the lazy chunks (narration, the menu) and the eval graph settle in this window.
    await page.waitForTimeout(1_500);
    const cls = await page.evaluate(() => (window as unknown as { __rcCls: number }).__rcCls);
    expect(cls, `cumulative layout shift on ${testInfo.project.name}`).toBeLessThanOrEqual(CLS_BUDGET);
  });
}
