// System screens on the UI projects (phase-01 plan §12.3, 1B·F8): /too-many-requests and the session modal fit
// the viewport at 100 % and on iphone-safari@150, every control is a 44 px target, the modal is a bottom sheet on
// phones, and axe is clean in both themes. The modal is opened with the demo state
// (`/dev/ui/data?state=session_expired`), because the device build has no test hooks.
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { expectNoAxeViolations, setTheme } from "../a11y";
import { expect, expectTapTargets, test, waitForStable } from "../helpers";
import { baseDevice, zoomed } from "../matrix";

const PAGE = "/too-many-requests?retry=30&from=/play";
const MODAL = "/dev/ui/data?state=session_expired";
const DIALOG = '[data-testid="session-expired-modal"]';

const device = (ti: TestInfo) => (ti.project.metadata?.device as string | undefined) ?? "";
const isPhone = (ti: TestInfo) => ["iphone", "iphone-safari", "android", "android-chrome"].includes(device(ti));

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(0);
}

async function expectInViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.w + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.h + 0.5);
}

async function openModal(page: Page) {
  const res = await page.goto(MODAL);
  test.skip(res?.status() === 404, "/dev/ui/data is not served by this build");
  await waitForStable(page);
  const dialog = page.getByRole("dialog", { name: "You’ve Been Signed Out" });
  await expect(dialog).toBeVisible();
  // Let the sheet/pop animation finish before measuring.
  await dialog.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return dialog;
}

async function checkPage(page: Page) {
  const res = await page.goto(PAGE);
  expect(res?.status()).toBe(200);
  await waitForStable(page);
  await expect(page.getByRole("heading", { level: 1, name: "Slow Down a Little" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, { root: "main", all44: true });
  const retry = page.getByTestId("too-many-requests-retry");
  await expect(retry).toBeInViewport();
  return retry;
}

async function checkModal(page: Page, phone: boolean) {
  const dialog = await openModal(page);
  await expect(dialog).toHaveAttribute("data-surface", phone ? "sheet" : "dialog");
  await expectInViewport(page, DIALOG);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, { root: DIALOG, all44: true });
  await expect(dialog.getByRole("button", { name: "Sign In Again" })).toBeFocused();
}

test.describe("system screens", () => {
  test("/too-many-requests fits the viewport", async ({ page }, ti) => {
    const retry = await checkPage(page);
    if (isPhone(ti)) {
      // One column; the button is a full-width 48 px block.
      const box = (await retry.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(47.5);
      const main = (await page.locator("main").boundingBox())!;
      expect(box.width).toBeGreaterThan(main.width * 0.6);
    }
  });

  test("the session modal fits the viewport (sheet on phones)", async ({ page }, ti) => {
    await checkModal(page, isPhone(ti));
  });

  test("iphone-safari@150: both fit", async ({ browser }, ti) => {
    test.skip(ti.project.name !== "ui-iphone", "runs once, on the WebKit phone project");
    const ctx = await newZoomedContext(browser, "iphone-safari", 1.5);
    const page = await ctx.newPage();
    try {
      await checkPage(page);
      await checkModal(page, true);
    } finally {
      await ctx.close();
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`a11y system ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(PAGE);
      await waitForStable(page);
      // Scoped to main: the legacy marketing Navbar's link contrast is the marketing chrome's (P11), not this page's.
      await expectNoAxeViolations(page, { theme, include: "main" });

      // The modal blocks the gallery's theme switch, so pick the theme first, then open it.
      const res = await page.goto("/dev/ui/data");
      test.skip(res?.status() === 404, "/dev/ui/data is not served by this build");
      await waitForStable(page);
      await setTheme(page, theme);
      await openModal(page);
      await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .include(DIALOG)
        .analyze();
      const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
      expect(summary, `axe violations in the session modal (${theme})`).toEqual([]);
    });
  }
});

async function newZoomedContext(browser: Browser, id: string, zoom: number) {
  const z = zoomed(baseDevice(id), zoom);
  const { browserName: _browserName, ...use } = z.use;
  void _browserName;
  return browser.newContext({ ...use, reducedMotion: "reduce", serviceWorkers: "block", baseURL: test.info().project.use.baseURL });
}
