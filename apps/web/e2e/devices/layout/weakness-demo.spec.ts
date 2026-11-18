// The P6 Weakness Profile demo layer in the device × zoom suite (phase-06 plan §4.3, §12.4 "For each demo state";
// TE X8, X9). @p6
//
// /dev/ui/weakness renders the real WeaknessView on WP1's payload fixtures (the real buildPayload). For each state —
// insufficient (preliminary, few, zero, bullet offer), computing (progress, stalled, orphaned), ready (default, See all,
// each tab, updating, few patterns, none eligible, no band, no clock), the drill config (default, size 20, mix off,
// time pressure, zero own, empty, starting, rate limited), failed (again, rate limited), the ready flash and loading —
// normal and `stress=1` (at 150 %): the document never scrolls (only the content panels do), the header or the top
// bar title and the headline are visible, the first row header is in the viewport, the desktop tabs are visible
// without scrolling the page, phones keep the tab bar and the sheet inside the viewport, touch targets hold, axe has no
// violations (light and dark, at 100 %). The interactions run where they are designed: the accordion and its keys,
// See all, tabs by keyboard with no network request, the drill config / sheet. Real-route tags (`@state:`) come from
// WP8's persona specs; these are the demo tags of the same boards (WP6 hand-back).
//
// Each test belongs to one device family and skips on the others, so its @demo tags name exactly the boards that ran.
import type { Page, Request, TestInfo } from "@playwright/test";
import { WEAKNESS_DEMO_STATES, type WeaknessDemoState } from "../../../components/train/weakness/demo-state-names";
import { expectNoAxeViolations } from "../a11y";
import { familyOf, type DeviceFamily } from "../game/families";
import { expectTapTargets } from "../helpers";
import { expectOneViewport } from "./assertions";
import { expect, gotoStable, test } from "./fixtures";

const STRESS_ZOOM = 1.5;
const PROFILE_BOARD: Record<DeviceFamily, string> = {
  desktop: "V3WeaknessProfile",
  iphone: "V3iPhoneWeaknessProfile",
  android: "V3AndroidWeaknessProfile",
  "ipad-portrait": "V3iPadPWeaknessProfile",
  "ipad-landscape": "V3iPadLWeaknessProfile",
};
/** The shared DCLogic of the three desktop boards (`insufficient · computing · drill`). */
const DESKTOP_TRIO = ["V3WeaknessInsufficient", "V3WeaknessComputing", "V3WeaknessDrill"];

function tagsFor(family: DeviceFamily, state: WeaknessDemoState): string[] {
  const tags: string[] = [];
  if (state === "ready") tags.push(`@demo:${PROFILE_BOARD[family]}.default`);
  if (state === "loading") tags.push(`@demo:${PROFILE_BOARD[family]}.loading`);
  if (family === "desktop") {
    const trio = state === "insufficient" ? "insufficient" : state === "computing" ? "computing" : state === "drill" ? "drill" : null;
    if (trio) for (const b of DESKTOP_TRIO) tags.push(`@demo:${b}.${trio}`);
  }
  return tags;
}

const isReady = (s: WeaknessDemoState) =>
  ["ready", "ready_updating", "few_patterns", "none_eligible", "no_band", "no_clock", "see_all"].includes(s) || s.startsWith("tab_") || s.startsWith("drill");

async function visibleInViewport(page: Page, selector: string, what: string): Promise<void> {
  const el = page.locator(selector).filter({ visible: true }).first();
  await expect(el, `${what} visible`).toBeVisible();
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1, `${what} inside the viewport`).toBe(true);
}

async function checkState(page: Page, state: WeaknessDemoState, family: DeviceFamily, stress: boolean): Promise<void> {
  await gotoStable(page, `/dev/ui/weakness?state=${state}${stress ? "&stress=1" : ""}`);
  await expect(page.getByTestId("weakness")).toBeVisible({ timeout: 30_000 });
  await expectOneViewport(page);
  const phone = family === "iphone" || family === "android" || family === "ipad-portrait";
  if (phone) await visibleInViewport(page, '[data-testid="shell-topbar-title"]', "the top bar title");
  else if (state !== "loading") await visibleInViewport(page, '[data-testid="weakness-header"] h1', "the h1");
  if (isReady(state)) {
    await visibleInViewport(page, '[data-testid="weakness-headline"]', "the headline");
    await visibleInViewport(page, '[data-testid="weakness-row-head"]', "the first row header");
    if (!phone) await visibleInViewport(page, '[data-testid="weakness-breakdown"] [role="tablist"]', "the tabs");
  }
  if (phone) await visibleInViewport(page, "[data-rc-tabbar]", "the tab bar");
  if (state.startsWith("drill") && phone) await visibleInViewport(page, '[data-testid="weakness-drill-start"]', "the sheet's CTA");
  if (state.startsWith("drill") && !phone) await expect(page.getByTestId("weakness-drill-config")).toBeVisible();
  // A long opening name is cut with an ellipsis and keeps its full text in `title` (stress=1).
  if (stress && state === "tab_openings") await expect(page.locator('[data-testid="weakness-openings"] td span[title]').first()).toHaveAttribute("title", /Najdorf/);
  await expectTapTargets(page, { root: "[data-rc-main]" });
}

const FAMILIES: DeviceFamily[] = ["desktop", "ipad-landscape", "ipad-portrait", "iphone", "android"];

for (const family of FAMILIES) {
  test.describe(`weakness demo one viewport · ${family} @p6`, () => {
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(familyOf(testInfo) !== family, `${family} test`);
    });
    for (const state of WEAKNESS_DEMO_STATES) {
      test(`/dev/ui/weakness?state=${state}`, { tag: tagsFor(family, state) }, async ({ page }) => {
        await checkState(page, state, family, false);
      });
      test(`/dev/ui/weakness?state=${state}&stress=1`, async ({ page }, testInfo: TestInfo) => {
        test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
        await checkState(page, state, family, true);
      });
    }

    test("axe: every status, light and dark (100 %)", async ({ page }, testInfo) => {
      // 9 pages × 2 themes, each a full axe pass: more than the suite's 30 s per test.
      test.setTimeout(150_000);
      test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== 1, "axe runs at 100 %");
      for (const state of ["ready", "insufficient", "bullet_offer", "computing", "drill", "failed_again", "ready_flash", "loading", "tab_openings"] as const) {
        await gotoStable(page, `/dev/ui/weakness?state=${state}`);
        await expect(page.getByTestId("weakness")).toBeVisible();
        for (const theme of ["light", "dark"] as const) await expectNoAxeViolations(page, { include: "[data-rc-main]", theme });
      }
    });

    test("accordion, See all and tabs make no request; the keys move between headers and tabs", async ({ page }, testInfo) => {
      test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== 1, "interactions run at 100 %");
      await gotoStable(page, "/dev/ui/weakness?state=ready");
      const requests: string[] = [];
      const onRequest = (r: Request) => {
        if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
      };
      page.on("request", onRequest);
      const heads = page.getByTestId("weakness-row-head");
      await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "true");
      await heads.nth(1).click();
      await expect(heads.nth(1)).toHaveAttribute("aria-expanded", "true");
      await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "false");
      await heads.nth(1).focus();
      await page.keyboard.press("ArrowDown");
      await expect(heads.nth(2)).toBeFocused();
      await page.keyboard.press("Home");
      await expect(heads.nth(0)).toBeFocused();
      await page.keyboard.press("End");
      await expect(heads.nth(2)).toBeFocused();
      await page.getByTestId("weakness-see-all").click();
      await expect(page.getByTestId("weakness-row")).toHaveCount(5);
      await expect(heads.nth(3)).toBeFocused();
      await expect(page.getByTestId("weakness-see-all")).toHaveText("Show fewer");
      await page.getByTestId("weakness-tab-phase").click();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("weakness-tab-clock")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("weakness-clock").getByRole("img")).toHaveAttribute(
        "aria-label",
        "Blunders per 100 moves: over 5 minutes 0.8, 2 to 5 minutes 1.1, 1 to 2 minutes 2.6, under 1 minute 4.0",
      );
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("weakness-tab-open")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("weakness-openings").getByRole("columnheader")).toHaveText(["Family", "Games", "Score"]);
      page.off("request", onRequest);
      expect(requests, "tabs, accordion and See all make no /api request").toEqual([]);
    });

    test("the drill opens inline (desktop, iPad L) or as a sheet (phones, iPad P), with size and mix", async ({ page }, testInfo) => {
      test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== 1, "interactions run at 100 %");
      await gotoStable(page, "/dev/ui/weakness?state=ready");
      await page.getByTestId("weakness-drill").first().click();
      const config = page.getByTestId("weakness-drill-config").filter({ visible: true });
      await expect(config).toBeVisible();
      const sheet = family === "iphone" || family === "android" || family === "ipad-portrait";
      if (sheet) await expect(page.getByTestId("weakness-drill-sheet")).toBeVisible();
      else await expect(page.getByTestId("weakness-drill-sheet")).toHaveCount(0);
      await expect(config.getByTestId("weakness-drill-mixline")).toHaveText("6 from your games + 4 matched Lichess puzzles near 1512");
      await expect(config.getByTestId("weakness-drill-start")).toHaveText("Start drill · 10 positions · ~5 min");
      await config.getByRole("radio", { name: "20 positions" }).click();
      await expect(config.getByTestId("weakness-drill-mixline")).toHaveText("12 from your games + 8 matched Lichess puzzles near 1512");
      await expect(config.getByTestId("weakness-drill-start")).toHaveText("Start drill · 20 positions · ~10 min");
      await config.getByText("Fill with matched Lichess puzzles").click();
      await expect(config.getByTestId("weakness-drill-mixline")).toHaveText("12 from your games only (12 in your bank)");
      if (sheet) {
        const box = (await page.getByTestId("weakness-drill-sheet").boundingBox())!;
        const vp = page.viewportSize()!;
        expect(box.y + box.height, "the sheet ends inside the viewport").toBeLessThanOrEqual(vp.height + 1);
        expect(box.height, "the sheet is at most 70 % of the viewport").toBeLessThanOrEqual(vp.height * 0.7 + 1);
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("weakness-drill-config").filter({ visible: true })).toHaveCount(0);
    });
  });
}
