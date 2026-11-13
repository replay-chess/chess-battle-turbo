// Onboarding on every device × zoom (phase-04 plan §12.4 "Device × zoom layout specs", §4.0, §9.1; testing X9). @p4
//
// Each step in each of its demo states (/dev/ui/onboarding/[step]?state=, the real step components on fixtures): the
// document never scrolls (the step body scrolls inside the panel when it must), the primary button, the header (the
// desktop bar or the phone header) and the aside board (when rendered) are inside the viewport, and the controls meet
// the tap-target floors. `stress=1` (20-character names, 80-character openings, five-digit counts) runs at 150 %.
// Tiered by playwright.devices.config.ts: PR = desktop-1440@100, desktop-1280@125, iphone@100, ipad-portrait@100;
// nightly = all 40 projects. The CLS gate (plan §9.1: CLS ≤ 0.05 for onboarding, a lab gate at every zoom) runs on
// the Chromium projects of the tier.
//
// Each test belongs to one device family and skips on the others, so its @demo tags name exactly the boards that ran.
import type { Page, TestInfo } from "@playwright/test";
import { expectTapTargets, isChromium } from "../helpers";
import { familyOf, type DeviceFamily } from "../game/families";
import { expect, gotoStable, hasInsets, test } from "./fixtures";

import { ONBOARDING_DEMO_STATES as STEPS, type OnbDemoStep as Step } from "./onboarding-states";

/** The onboarding boards each family was drawn for (iPad landscape and Android lay out as desktop / phone). */
const PREFIX: Partial<Record<DeviceFamily, string>> = { desktop: "V3", iphone: "V3iPhone", "ipad-portrait": "V3iPad" };

function tagsFor(family: DeviceFamily, step: Step, state: string): string[] {
  const prefix = PREFIX[family];
  if (!prefix) return [];
  return STEPS[step].states[state]!.map((v) => `@demo:${prefix}${STEPS[step].board}.${v}`);
}

const STRESS_ZOOM = 1.5;
const CLS_BUDGET = 0.05;

async function inViewport(page: Page, locator: ReturnType<Page["locator"]>, what: string): Promise<void> {
  await expect(locator, `${what} visible`).toBeVisible();
  const box = (await locator.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(
    box.x >= -1 && box.y >= -1 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1,
    `${what} inside the viewport (${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)} in ${vp.width}×${vp.height})`,
  ).toBe(true);
}

async function checkStep(page: Page, path: string): Promise<void> {
  await gotoStable(page, path);
  await expect(page.locator(".onb-stage").first()).toBeVisible({ timeout: 30_000 });
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
  }));
  expect(m.sh, "the document does not scroll vertically").toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, "no horizontal page scroll").toBeLessThanOrEqual(m.iw + 1);
  // The footer's main action: its last control (the primary; on Activating's `polling` the only one is "Continue in
  // Background", styled secondary).
  await inViewport(page, page.locator(".onb-foot :is(button, a):visible").last(), "the footer's main action");
  await inViewport(page, page.locator('[data-testid="onb-header"]:visible, [data-testid="onb-mobile-header"]:visible').first(), "the header");
  const asideBoard = page.locator(".onb-aside .onb-ab:visible").first();
  if (await asideBoard.count()) await inViewport(page, asideBoard, "the aside board");
  await expectInlineExemptTapTargets(page, ".onb-stage");
  // regression: link-lichess-column-collapse (FIX-2, UI review round 2): at iPhone 125 % (314 px) the Lichess card kept
  // "Connect Lichess" beside its text and squeezed the hint and the error into a 78 px column of single words; the
  // button now wraps under the text before that happens.
  const liText = page.locator(".onb-li__text:visible");
  if (await liText.count()) {
    const w = (await liText.first().boundingBox())!.width;
    expect(w, "the Lichess card's text column keeps room for its copy").toBeGreaterThanOrEqual(130);
  }
  // regression: onb-skip-touch-target (FIX-1): the footer's "Skip" is a full 44 × 44 target on touch screens.
  const skip = page.locator('[data-testid="onb-skip"]:visible');
  if ((await skip.count()) && (await page.evaluate(() => matchMedia("(pointer: coarse)").matches))) {
    const box = (await skip.first().boundingBox())!;
    expect(Math.min(box.width, box.height), "Skip is 44 px both ways").toBeGreaterThanOrEqual(43.5);
  }
}

/**
 * P1's tap-target floors with WCAG 2.5.8's "Inline" exception: a link inside a sentence ("contact us", "Settings ·
 * Connected accounts" in a hint) is sized by the line of text; it is hidden from the check while it runs.
 */
async function expectInlineExemptTapTargets(page: Page, root: string): Promise<void> {
  const inline = page.locator(`${root} :is(p, li, .onb-msg span) a`);
  await inline.evaluateAll((els) => els.forEach((el) => el.setAttribute("aria-hidden", "true")));
  try {
    await expectTapTargets(page, { root });
  } finally {
    await inline.evaluateAll((els) => els.forEach((el) => el.removeAttribute("aria-hidden")));
  }
}

const FAMILIES: DeviceFamily[] = ["desktop", "ipad-landscape", "ipad-portrait", "iphone", "android"];

for (const family of FAMILIES) {
  test.describe(`onboarding one viewport · ${family} @p4`, () => {
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(familyOf(testInfo) !== family, `${family} test`);
    });
    for (const step of Object.keys(STEPS) as Step[]) {
      for (const state of Object.keys(STEPS[step].states)) {
        const path = `/dev/ui/onboarding/${step}?state=${state}`;
        test(path, { tag: tagsFor(family, step, state) }, async ({ page }) => {
          await checkStep(page, path);
        });
        test(`${path}&stress=1`, async ({ page }, testInfo: TestInfo) => {
          test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
          await checkStep(page, `${path}&stress=1`);
        });
      }
    }
  });
}

for (const step of Object.keys(STEPS) as Step[]) {
  const state = Object.keys(STEPS[step].states)[0]!;
  test(`no layout shift over ${CLS_BUDGET} on load: /dev/ui/onboarding/${step}?state=${state} @p4`, async ({ page }, testInfo) => {
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
    await gotoStable(page, `/dev/ui/onboarding/${step}?state=${state}`);
    await expect(page.locator(".onb-stage").first()).toBeVisible();
    await page.waitForTimeout(1_500);
    const cls = await page.evaluate(() => (window as unknown as { __rcCls: number }).__rcCls);
    expect(cls, `cumulative layout shift on ${testInfo.project.name}`).toBeLessThanOrEqual(CLS_BUDGET);
  });
}
