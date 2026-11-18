// S4 on a phone: the drill config is a bottom sheet (phase-06 plan §12.4 `drill-sheet.spec.ts`, §4.7, §4.11). Persona
// `weak-member` (§6.8: 54 real CC0 games graded by the e2e worker, the bank and the READY profile). iPhone at 100 % and
// at 125 % zoom (P1's device × zoom matrix): Drill opens the sheet; Back closes it; Esc and the close control give the
// focus back to the row (FIX-2); Start opens the runner; the sheet stays inside the viewport. @p6
import { baseDevice, zoomed } from "../../devices/matrix";
import { expect, inViewport, noDocumentScroll, openWeakness, test, tr5, waitForSession, weakStateTags } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });

/** The matrix project's context options without its browser (a describe group cannot switch the worker's browser). */
function iphoneAt(zoom: number) {
  const { viewport, screen, deviceScaleFactor, isMobile, hasTouch, userAgent } = zoomed(baseDevice("iphone"), zoom).use;
  return { viewport, screen, deviceScaleFactor, isMobile, hasTouch, ...(userAgent ? { userAgent } : {}) };
}

for (const zoom of [1, 1.25] as const) {
  test.describe(`weakness drill sheet · iphone@${zoom * 100}`, { tag: ["@p6", ...weakStateTags("drill"), "@state:V3iPhoneWeaknessProfile.default"] }, () => {
    test.use({ ...iphoneAt(zoom), timezoneId: "UTC" });

    test("Drill opens the sheet, Back closes it, Start opens the runner", async ({ page, weak }) => {
      test.setTimeout(600_000);
      await weak("weak-member");
      const p = await tr5(page.request);
      const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
      expect(row, "a matchable row with own positions").toBeTruthy();
      await openWeakness(page, "ready");
      await noDocumentScroll(page, "profile");
      await expect(page.getByTestId("weakness-tab-str"), "phones show Strengths as a tab").toBeVisible();
      const r = page.locator(`[data-testid="weakness-row"][data-pattern="${row.pattern}"]`).first();
      if ((await r.getAttribute("data-open")) === null) await r.getByTestId("weakness-row-head").click();
      await r.getByText(`Drill · ${row.inBank} in bank`).click();
      const sheet = page.getByTestId("weakness-drill-sheet");
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      const start = page.getByTestId("weakness-drill-start").filter({ visible: true }).first();
      // The sheet slides in: measure once it has settled.
      await expect
        .poll(async () => {
          const b = await start.boundingBox();
          return b ? Math.round(b.y + b.height) : Infinity;
        })
        .toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      // The Start button can be inside the viewport while the sheet's own bottom edge is still sliding up: wait for the
      // sheet's slide (its CSS animations and transitions, the subtree included) to finish before measuring the sheet
      // (regression: drill-sheet-mid-slide; chromium iphone@100 measured the sheet's bottom at 856.6 > 853 mid-slide).
      await sheet.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
      await inViewport(page, sheet, "the sheet");
      await noDocumentScroll(page, "the sheet");
      await page.goBack();
      await expect(sheet).toHaveCount(0);
      await expect(page).toHaveURL(/\/train\/weakness(\?|$)/);
      // regression: weakness-sheet-focus-lost (FIX-2, WCAG 2.4.3): Esc and the close control return the focus to the
      // row's Drill link (Radix returns it to a trigger the sheet does not have), never to <body>.
      const drillLink = r.getByText(`Drill · ${row.inBank} in bank`);
      const focusedPattern = () =>
        page.evaluate(() => (document.activeElement?.closest("[data-testid=weakness-row]") as HTMLElement | null)?.dataset.pattern ?? document.activeElement?.tagName);
      for (const close of ["Escape", "button"] as const) {
        await drillLink.focus();
        await page.keyboard.press("Enter");
        await expect(sheet).toBeVisible({ timeout: 30_000 });
        if (close === "Escape") await page.keyboard.press("Escape");
        else await sheet.getByRole("button", { name: /close/i }).click();
        await expect(sheet).toHaveCount(0);
        await expect.poll(focusedPattern, { message: `focus after closing with ${close}` }).toBe(row.pattern);
      }
      await r.getByText(`Drill · ${row.inBank} in bank`).click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("weakness-drill-start").filter({ visible: true }).first().click();
      await waitForSession(page);
      await expect(page.getByTestId("trainer-board")).toHaveAttribute("data-input", "", { timeout: 60_000 });
      await inViewport(page, page.getByTestId("trainer-board").filter({ visible: true }).first(), "the runner's board");
    });
  });
}
