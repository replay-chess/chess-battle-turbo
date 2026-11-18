// The profile on every device board, real data (phase-06 plan §12.4 device boards, §4.3, §1.2 T9; DR V3iPhone-, V3Android-,
// V3iPadP- and V3iPadLWeaknessProfile). Persona `weak-member` (§6.8: 54 real CC0 games graded by the e2e worker). The
// main suite's chromium project with each device's viewport, scale, touch and user agent (P1's matrix at 100 %): one
// viewport (no document scroll), the header and headline, the first row's header inside the viewport, Strengths as a
// tab on phones and iPad, the drill config inline on iPad landscape, a bottom sheet elsewhere. The `loading` boards are
// demo-only (no route skeleton under /train: docs/qa/design-states.overrides.json). @p6
import { DEVICES, expect, inViewport, noDocumentScroll, openWeakness, PROFILE_BOARD, test, tr5, type DeviceName } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });

const CASES: { device: Exclude<DeviceName, "desktop-1440">; sheet: boolean }[] = [
  { device: "iphone", sheet: true },
  { device: "android", sheet: true },
  { device: "ipad-portrait", sheet: true },
  { device: "ipad-landscape", sheet: false },
];

for (const c of CASES) {
  test.describe(`weakness profile · ${c.device}@100`, { tag: ["@p6", `@state:${PROFILE_BOARD[c.device]}.default`] }, () => {
    test.use({ ...DEVICES[c.device], timezoneId: "UTC" });

    test("one viewport, the rows, the tabs and the drill config", async ({ page, weak }) => {
      test.setTimeout(600_000);
      await weak("weak-member");
      const p = await tr5(page.request);
      expect(p.status).toBe("ready");
      await openWeakness(page, "ready");
      await noDocumentScroll(page, `${c.device} profile`);
      // The page's header on the rail and the desktop; in the tab-bar form the shell's top bar carries the title.
      const tabbar = await page.locator("[data-rc-tabbar]").isVisible();
      if (tabbar) await expect(page.getByTestId("shell-topbar-title")).toContainText(/weakness profile/i);
      else await expect(page.getByTestId("weakness-header")).toBeVisible();
      await expect(page.getByTestId("weakness-headline")).toBeVisible();
      await inViewport(page, page.getByTestId("weakness-row-head").first(), "the first row's header");
      await expect(page.getByTestId("weakness-tab-str"), "Strengths is a tab here").toBeVisible();
      const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
      const r = page.locator(`[data-testid="weakness-row"][data-pattern="${row.pattern}"]`).first();
      if ((await r.getAttribute("data-open")) === null) await r.getByTestId("weakness-row-head").click();
      await r.getByText(`Drill · ${row.inBank} in bank`).click();
      const start = page.getByTestId("weakness-drill-start").filter({ visible: true }).first();
      await expect(start).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("weakness-drill-sheet").filter({ visible: true })).toHaveCount(c.sheet ? 1 : 0);
      await expect
        .poll(async () => {
          const b = await start.boundingBox();
          return b ? Math.round(b.y + b.height) : Infinity;
        })
        .toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      await noDocumentScroll(page, `${c.device} drill config`);
    });
  });
}
