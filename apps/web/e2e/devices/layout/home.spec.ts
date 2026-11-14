// Home in the device × zoom suite (phase-05 plan §12.4 `e2e/devices/layout/home.spec.ts`; §4.1; TST X9). @p5
//
// Tiered by playwright.devices.config.ts (PR: 4 projects; nightly: all 40 on `next start`).
//   demo routes  /dev/ui/home in every state (the real HomeView on contract fixtures): lock mode, the document never
//                scrolls and nothing escapes the viewport (phones scroll inside the page's own region), the primary
//                action of the state is in view, tap-target floors. `stress=1` (the longest names, 4-digit counts, a
//                9,999-game import) runs at 150 %. A CLS gate (≤ 0.05, as the other app lists) on the populated state.
//   real route   leased `dev-member` (the `bank-member` state under its own name, so this file and train.spec.ts
//                never lease one persona from two files) on the real-route projects: /home populated, the same checks.
// The Home boards are desktop-only (V3Home, V3HomeNewUser, V3HomeLoading): the desktop family carries their @demo tags.
import type { Page, TestInfo } from "@playwright/test";
import { expectTapTargets, isChromium } from "../helpers";
import { familyOf } from "../game/families";
import { expectOneViewport } from "./assertions";
import { expect, gotoStable, hasInsets, test, waitForStable } from "./fixtures";
import { HOME_DEMO_STATES } from "../../../app/dev/ui/_fixtures/train";

const STRESS_ZOOM = 1.5;
/** The real-route projects (as routes.real.ts and train.spec.ts). */
const REAL_PROJECTS = new Set(["desktop-1440@100", "desktop-1440@150", "iphone@100", "iphone@125", "ipad-portrait@100"]);
const CLS_BUDGET = 0.05;
const BOARDS = ["V3Home", "V3HomeNewUser", "V3HomeLoading"];
/** The board enum (populated | new_user | loading | import_running | payment_failed | trial). */
const DESIGNED = new Set(["populated", "new_user", "loading", "import_running", "payment_failed", "trial"]);

/** The primary of each state (the first visible one counts). */
const PRIMARY: Record<string, string> = {
  populated: '[data-testid="home-start-review"]',
  new_user: '[data-testid="home-start-legend"]',
  import_running: '[data-testid="home-import"]',
  trial: '[data-testid="home-start-review"]',
  payment_failed: '[data-testid="home-start-review"]',
  analysing: '[data-testid="home-continue"]',
  clean: '[data-testid="home-continue"]',
  nothing_due: '[data-testid="home-bank-cta"]',
};

async function inViewport(page: Page, selector: string, what: string): Promise<void> {
  const el = page.locator(selector).filter({ visible: true }).first();
  await expect(el, `${what} visible`).toBeVisible();
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x >= -1 && b.x + b.width <= vp.width + 1, `${what} inside the viewport horizontally`).toBe(true);
  // Phones scroll Home inside its own region: the primary is reachable there; on wider screens it is in view.
  const scroller = await el.evaluate((n) => {
    for (let a = n.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && a.scrollHeight > a.clientHeight + 1) return true;
    }
    return false;
  });
  if (!scroller) expect(b.y >= -1 && b.y + b.height <= vp.height + 1, `${what} inside the viewport`).toBe(true);
}

/**
 * FIX-2: nothing of Home is out of reach. Where the content is taller than the page's region (iPad portrait with an
 * import banner, 110–125 % zoom), the region scrolls; it never clips (it was `overflow: hidden` there).
 */
async function nothingClipped(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const hm = document.querySelector<HTMLElement>(".hm-root > .hm");
    if (!hm) return null;
    return { sh: hm.scrollHeight, ch: hm.clientHeight, oy: getComputedStyle(hm).overflowY };
  });
  if (!m || m.sh <= m.ch + 1) return;
  expect(["auto", "scroll"], `Home is ${m.sh} px in a ${m.ch} px region: it must scroll`).toContain(m.oy);
}

/** FIX-2 (§4.1 phones): the primary is in the first viewport of the page's scroll region, unscrolled (at 100 %). */
async function inFirstViewport(page: Page, selector: string, what: string): Promise<void> {
  const r = await page.locator(selector).filter({ visible: true }).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hm = document.querySelector(".hm-root > .hm")!.getBoundingClientRect();
    return { bottom: b.bottom, regionBottom: hm.bottom };
  });
  expect(r.bottom, `${what} fits the first viewport`).toBeLessThanOrEqual(r.regionBottom + 1);
}

async function checkHome(page: Page, path: string, state: string, testInfo?: TestInfo): Promise<void> {
  await gotoStable(page, path);
  await expect(page.locator('[data-testid="home"], [data-testid="home-loading"]').first()).toBeVisible({ timeout: 30_000 });
  await expectOneViewport(page);
  await nothingClipped(page);
  if (PRIMARY[state]) await inViewport(page, PRIMARY[state]!, `${state}: the primary`);
  const phone = (page.viewportSize()?.width ?? 1000) <= 600;
  const zoom = Number(testInfo?.project.metadata?.zoom ?? 1);
  if (phone && zoom <= 1 && (state === "populated" || state === "trial" || state === "payment_failed")) {
    await inFirstViewport(page, PRIMARY[state]!, `${state}: Start Review`);
  }
  await expectTapTargets(page, { root: "[data-rc-main]" });
}

test.describe("home one viewport @p5", () => {
  for (const state of HOME_DEMO_STATES) {
    const path = `/dev/ui/home?state=${state}`;
    test(path, { tag: DESIGNED.has(state) ? BOARDS.map((b) => `@demo:${b}.${state}`) : [] }, async ({ page }, testInfo: TestInfo) => {
      // The @demo tags name the desktop boards: the desktop family carries them, the other families run untagged twins.
      test.skip(familyOf(testInfo) !== "desktop", "desktop family (the tagged run)");
      await checkHome(page, path, state, testInfo);
    });
    test(`${path} (devices)`, async ({ page }, testInfo: TestInfo) => {
      test.skip(familyOf(testInfo) === "desktop", "tablet and phone families");
      await checkHome(page, path, state, testInfo);
    });
    test(`${path}&stress=1`, async ({ page }, testInfo: TestInfo) => {
      test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
      await checkHome(page, `${path}&stress=1`, state, testInfo);
    });
  }

  test(`no layout shift over ${CLS_BUDGET} on load: /dev/ui/home?state=populated`, async ({ page }, testInfo) => {
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
    await gotoStable(page, "/dev/ui/home?state=populated");
    await expect(page.getByTestId("home")).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await page.evaluate(() => (window as unknown as { __rcCls: number }).__rcCls), `CLS on ${testInfo.project.name}`).toBeLessThanOrEqual(CLS_BUDGET);
  });

  test("real route: /home populated as dev-member (the bank-member state)", async ({ page }, testInfo) => {
    test.skip(!REAL_PROJECTS.has(testInfo.project.name), `real routes run on ${[...REAL_PROJECTS].join(", ")}`);
    test.setTimeout(300_000);
    const { clerkSetup } = await import("@clerk/testing/playwright");
    await clerkSetup();
    const { signIn } = await import("../../fixtures/auth");
    const { leasePersona } = await import("../../fixtures/lease");
    const { poolEmail, poolSlot } = await import("../../fixtures/users");
    await signIn(page, poolEmail(poolSlot(testInfo.parallelIndex, 1)), "");
    await leasePersona("dev-member", testInfo, 1);
    const res = await page.goto("/home", { waitUntil: "domcontentloaded", timeout: 90_000 });
    expect(res?.status()).toBe(200);
    await expect(page.locator('[data-testid="home"][data-state="populated"]')).toBeVisible({ timeout: 60_000 });
    await waitForStable(page);
    await expectOneViewport(page);
    await inViewport(page, PRIMARY.populated!, "Start Review");
  });
});
