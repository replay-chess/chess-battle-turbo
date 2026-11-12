// The lab performance gates of the review (phase-03 plan §9.1: "the lab measurements (Playwright traces in CI) are the
// gate"; AP-35), on desktop-1440 and iPhone:
//   - /review/[ref] TTFB ≤ 400 ms (navigation responseStart), LCP ≤ 2.5 s, CLS ≤ 0.05 (the real route, member A's
//     seeded GAME, read-only: the summary of a done review);
//   - the INP proxy ≤ 200 ms: the longest Event Timing entry while stepping through the moves and switching tabs;
//   - board interaction in a key moment, tap → highlight ≤ 50 ms: the `rv:tap-highlight` measure the moment board
//     records from the move handed to the walkthrough to the first paint of its result (ReviewBoardColumn TAP_MEASURE),
//     on the moment demo so the shared GAME walkthrough (review-walkthrough.spec.ts) is not touched.
// CLS at every zoom of the device matrix is the devices suite's review.perf.spec.ts.
// The numbers mean something only against a production build: CI runs `next start`; locally set E2E_PERF_GATES=1
// with a test build (a `next dev` server compiles on first request). Chromium only (LCP, layout-shift and Event Timing
// entries; the webkit project runs @smoke only).
// regression: review-lab-perf-gates (FIX-1): none of these gates existed.
import type { Page } from "@playwright/test";
import { clickMove, control, DEVICES, expect, gotoOk, openReview, test } from "./_lib/review";

const GATES = Boolean(process.env.CI) || process.env.E2E_PERF_GATES === "1";

const REVIEW_LAB_BUDGET = { ttfbMs: 400, lcpMs: 2_500, cls: 0.05, inpProxyMs: 200, tapHighlightMs: 50 } as const;

/** Installs the observers before the page's own scripts run (LCP, layout shifts, event timing). */
async function observe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __rcPerf: { lcp: number; cls: number; events: number[] } };
    w.__rcPerf = { lcp: 0, cls: 0, events: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__rcPerf.lcp = Math.max(w.__rcPerf.lcp, e.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!e.hadRecentInput) w.__rcPerf.cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__rcPerf.events.push(e.duration);
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    } catch {
      // An engine without these entry types: the test is skipped on it.
    }
  });
}

async function perf(page: Page): Promise<{ lcp: number; cls: number; events: number[]; ttfb: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __rcPerf: { lcp: number; cls: number; events: number[] } };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return { ...w.__rcPerf, ttfb: nav ? nav.responseStart - nav.startTime : Number.NaN };
  });
}

for (const device of ["desktop-1440", "iphone"] as const) {
  test.describe(`review lab performance (${device})`, { tag: ["@p3", "@perf"] }, () => {
    test.use(DEVICES[device]);
    test.skip(!GATES, "lab gates need a production build: CI, or E2E_PERF_GATES=1 against `next start`");

    test("the real /review/<ref>: TTFB ≤ 400 ms, LCP ≤ 2.5 s, CLS ≤ 0.05, INP proxy ≤ 200 ms", async ({ member, page, seeded, browserName }) => {
      test.skip(browserName !== "chromium", "LCP, layout-shift and Event Timing entries are Chromium's");
      test.setTimeout(180_000);
      await member("A");
      // Warm the route once (the first request of a fresh server builds caches the gate is not about).
      await openReview(page, seeded.GAME);
      await observe(page);
      await openReview(page, seeded.GAME);
      await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done");
      await expect(page.getByTestId("review-summary")).toBeVisible();
      // Let the page settle: late shifts count, and LCP is final after the first input.
      await page.waitForTimeout(1_500);
      const load = await perf(page);
      expect(load.ttfb, "TTFB").toBeLessThanOrEqual(REVIEW_LAB_BUDGET.ttfbMs);
      expect(load.lcp, "LCP").toBeGreaterThan(0);
      expect(load.lcp, "LCP").toBeLessThanOrEqual(REVIEW_LAB_BUDGET.lcpMs);
      expect(load.cls, "CLS").toBeLessThanOrEqual(REVIEW_LAB_BUDGET.cls);

      // Interactions: step through the moves with the keyboard and the controls, switch tabs.
      await page.getByTestId("review-board").click({ position: { x: 4, y: 4 } });
      for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Home");
      await page.keyboard.press("End");
      if (device === "desktop-1440") {
        await page.getByRole("tab", { name: /Moves/ }).click();
        await page.getByRole("tab", { name: /Coach/ }).click();
      } else {
        await control(page, "bar-prev").click();
        await control(page, "bar-next").click();
      }
      await page.waitForTimeout(500);
      const after = await perf(page);
      expect(after.events.length, "interactions were timed").toBeGreaterThan(0);
      expect(Math.max(...after.events), "INP proxy (longest event)").toBeLessThanOrEqual(REVIEW_LAB_BUDGET.inpProxyMs);
      expect(after.cls, "CLS after the interactions").toBeLessThanOrEqual(REVIEW_LAB_BUDGET.cls);
    });

    test("a key moment: tap → highlight ≤ 50 ms", async ({ page }) => {
      test.setTimeout(120_000);
      await gotoOk(page, "/dev/ui/review?state=moment&phase=ask");
      await expect(page.getByTestId("moment-panel")).toHaveAttribute("data-phase", "ask");
      await expect(page.getByTestId("review-board")).toHaveAttribute("data-input", "");
      // m1 of the GAME fixture (move 17, White to play): Nd5 is a wrong try (rings), Qc1 the engine's move.
      await clickMove(page, "c3", "d5");
      await expect(page.getByTestId("moment-panel")).toHaveAttribute("data-phase", "tried");
      await clickMove(page, "d1", "c1");
      await expect(page.getByTestId("moment-found")).toBeVisible();
      // The measure lands at the paint after the result shows (two animation frames).
      const taps = () => page.evaluate(() => performance.getEntriesByName("rv:tap-highlight").map((e) => e.duration));
      await expect.poll(async () => (await taps()).length, { message: "both moves were measured" }).toBe(2);
      for (const ms of await taps()) expect(ms, "tap → highlight").toBeLessThanOrEqual(REVIEW_LAB_BUDGET.tapHighlightMs);
    });
  });
}
