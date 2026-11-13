// The activation screens on every device × zoom (phase-04 plan §12.4 "Device × zoom layout specs", §4.7, §4.9). @p4
//
// /dev/ui/activating?kind=checkout|onboarding&state=polling|success|stalled|failed (the shared ActivationCard as
// /checkout/activating and the onboarding panel use it): the document never scrolls, the card and its primary action
// are inside the viewport, the controls meet the tap-target floors; `stress=1` at 150 %. The CLS gate (plan §9.1,
// CLS ≤ 0.05 for the checkout return) on the Chromium projects. @demo tags: DR/V3CheckoutActivating (desktop family);
// the onboarding activating boards are tagged by onboarding.spec.ts (the step's own demo).
import type { Page, TestInfo } from "@playwright/test";
import { expectTapTargets, isChromium } from "../helpers";
import { expect, gotoStable, hasInsets, test } from "./fixtures";

const STATES = ["polling", "success", "stalled", "failed"] as const;
const KINDS = ["checkout", "onboarding"] as const;
const STRESS_ZOOM = 1.5;
const CLS_BUDGET = 0.05;

async function check(page: Page, path: string, state: string): Promise<void> {
  await gotoStable(page, path);
  const card = page.getByTestId("activation-card");
  await expect(card).toHaveAttribute("data-state", state, { timeout: 30_000 });
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
  }));
  expect(m.sh, "the document does not scroll vertically").toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, "no horizontal page scroll").toBeLessThanOrEqual(m.iw + 1);
  // regression: activating-card-top-cut (FIX-1): the main area scrolls; nothing may sit above its scroll origin (a
  // `justify-center` flex box pushed the eyebrow and the title above scrollTop 0 on small phones and at zoom).
  const cut = await page.evaluate(() => {
    const main = document.querySelector('[data-testid="activating-demo"] main') as HTMLElement;
    main.scrollTop = 0;
    const top = main.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(main).paddingTop) - 1;
    return [...main.children].map((c) => Math.round((top - c.getBoundingClientRect().top) * 10) / 10).filter((d) => d > 0);
  });
  expect(cut, "no content above the scroll area's top").toEqual([]);
  const primary = card.locator("a:visible, button:visible").first();
  if (await primary.count()) {
    await primary.scrollIntoViewIfNeeded();
    const box = (await primary.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.y >= -1 && box.y + box.height <= vp.height + 1, "the card's primary action inside the viewport").toBe(true);
  }
  await expectTapTargets(page, { root: '[data-testid="activating-demo"]' });
  // regression: activating-topnav-touch-targets (FIX-1): on touch screens the top nav's Play and avatar are 44 px.
  if (path.includes("kind=checkout") && (await page.evaluate(() => matchMedia("(pointer: coarse)").matches))) {
    await expectTapTargets(page, { root: '[data-testid="activating-demo"] header', all44: true });
  }
}

test.describe("activating one viewport @p4", () => {
  for (const kind of KINDS) {
    for (const state of STATES) {
      const path = `/dev/ui/activating?kind=${kind}&state=${state}`;
      const tags = kind === "checkout" ? [`@demo:V3CheckoutActivating.${state}`] : [];
      test(path, { tag: tags }, async ({ page }) => {
        await check(page, path, state);
      });
      test(`${path}&stress=1`, async ({ page }, testInfo: TestInfo) => {
        test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
        await check(page, `${path}&stress=1`, state);
      });
    }
  }

  for (const state of ["polling", "success"] as const) {
    test(`no layout shift over ${CLS_BUDGET} on load: checkout ${state}`, async ({ page }, testInfo) => {
      test.skip(!isChromium(testInfo), "layout-shift entries are Chromium-only");
      test.skip(hasInsets(testInfo), "projects without insets only");
      await page.addInitScript(() => {
        const w = window as unknown as { __rcCls: number };
        w.__rcCls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!e.hadRecentInput) w.__rcCls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await gotoStable(page, `/dev/ui/activating?kind=checkout&state=${state}`);
      await expect(page.getByTestId("activation-card")).toBeVisible();
      await page.waitForTimeout(1_500);
      const cls = await page.evaluate(() => (window as unknown as { __rcCls: number }).__rcCls);
      expect(cls, `cumulative layout shift on ${testInfo.project.name}`).toBeLessThanOrEqual(CLS_BUDGET);
    });
  }
});
