// The profile's layout on real data at the sizes the P6 UI review broke (FIX-1; phase-06 plan §4.3 "one viewport",
// hit targets, §4.6 row anatomy). Persona `weak-member` (§6.8: 54 real CC0 games graded by the e2e worker, its bank, the
// READY profile the worker computed). @p6
//
//   1280 × 800     See all, then Show fewer and the drill config, are clickable: the Top-weaknesses column scrolls with
//                  the week plan inside it (they were squeezed under the week plan, the click intercepted)
//   1152 × 720     (1440 at 125 %) the inline config stacks: the CTA keeps its whole text
//   262 × 568      (iPhone at 150 %) nothing in the frame runs past the viewport ("Drill · n in bank" wraps)
//   iPhone, iPad P no layout shift of the page after the first paint (the phone SubNav was hidden after hydration)
//   any            the time-pressure row writes its unit ("under 1 min") under its bars
import type { Page } from "@playwright/test";
import { DEVICES, expect, openWeakness, test, tr5 } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });

async function noHorizontalOverflow(page: Page, what: string) {
  const o = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-testid="weakness-frame"]')!;
    const off = [...frame.querySelectorAll<HTMLElement>("*")]
      .filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > window.innerWidth + 0.5)
      // A horizontally scrolling tablist may hold tabs off screen (its own scroller).
      .filter((e) => !e.closest('[role="tablist"]'))
      .map((e) => `${e.tagName}[${e.getAttribute("data-testid") ?? ""}] ${Math.round(e.getBoundingClientRect().right)}`);
    return { scroll: frame.scrollWidth, client: frame.clientWidth, off: off.slice(0, 5) };
  });
  expect(o.off, `${what}: nothing past the viewport`).toEqual([]);
  expect(o.scroll, `${what}: the frame does not scroll sideways`).toBeLessThanOrEqual(o.client);
}

test.describe("weakness profile layout · 1280×800", { tag: ["@p6"] }, () => {
  test.use({ ...DEVICES["desktop-1440"], viewport: { width: 1280, height: 800 }, timezoneId: "UTC" });

  test("regression: weakness-week-plan-covers-list — See all / Show fewer and the config are clickable; the column scrolls", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    expect(p.more.length, "the member has rows 4–5").toBeGreaterThan(0);
    await openWeakness(page, "ready");
    await page.getByTestId("weakness-see-all").click();
    // Playwright's click fails when another element would receive it (the week plan used to).
    const fewer = page.getByTestId("weakness-see-all");
    await fewer.scrollIntoViewIfNeeded();
    const plan = await page.getByTestId("weakness-week-plan").boundingBox();
    const last = await page.getByTestId("weakness-row").last().boundingBox();
    expect(plan && last && plan.y >= last.y + last.height - 1, "the week plan sits below the last row").toBe(true);
    const col = await page.getByTestId("weakness-list").evaluate((el) => {
      const c = el.parentElement!;
      return { scroll: c.scrollHeight, client: c.clientHeight };
    });
    expect(col.scroll, "the column scrolls instead of squeezing the list").toBeGreaterThan(col.client);
    await fewer.click();
    await expect(page.getByTestId("weakness-row")).toHaveCount(p.top.length);
    const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
    await page.goto(`/train/weakness/${row.slug}`, { waitUntil: "domcontentloaded" });
    const start = page.getByTestId("weakness-drill-start");
    await expect(start).toBeVisible({ timeout: 120_000 });
    await start.scrollIntoViewIfNeeded();
    await start.click({ trial: true });
  });
});

test.describe("weakness profile layout · 1152×720 (1440 at 125 %)", { tag: ["@p6"] }, () => {
  test.use({ ...DEVICES["desktop-1440"], viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1.25, timezoneId: "UTC" });

  test("regression: weakness-drill-cta-clipped — the inline config stacks and the CTA keeps its text", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
    await page.goto(`/train/weakness/${row.slug}`, { waitUntil: "domcontentloaded" });
    const start = page.getByTestId("weakness-drill-start");
    await expect(start).toHaveText(/^Start drill · \d+ positions · ~\d+ min$/, { timeout: 120_000 });
    const fit = await start.evaluate((b) => ({ scroll: b.scrollWidth, client: b.clientWidth }));
    expect(fit.scroll, "the CTA's text fits its button").toBeLessThanOrEqual(fit.client);
    for (const radio of await page.getByTestId("weakness-drill-size").getByRole("radio").all()) {
      // CSS px at a 1.25 device scale come back as 43.99998: compare to the device-pixel rounding.
      expect(Math.round((await radio.boundingBox())!.height), "44 px hit targets on a fine pointer too").toBeGreaterThanOrEqual(44);
    }
    await noHorizontalOverflow(page, "1152 drill");
  });
});

test.describe("weakness profile layout · 1152×720: the selected row stays in view (FIX-2)", { tag: ["@p6"] }, () => {
  test.use({ ...DEVICES["desktop-1440"], viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1.25, timezoneId: "UTC" });

  test("regression: weakness-drill-row-clipped — opening the drill keeps the selected row's header (and border) in view", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
    await openWeakness(page, "ready");
    const r = page.locator(`[data-testid="weakness-row"][data-pattern="${row.pattern}"]`).first();
    if ((await r.getAttribute("data-open")) === null) await r.getByTestId("weakness-row-head").click();
    await r.getByText(`Drill · ${row.inBank} in bank`).click();
    await expect(page.getByTestId("weakness-drill-config")).toBeFocused();
    await page.waitForTimeout(300);
    const gap = await r.evaluate((el) => {
      let p = el.parentElement;
      while (p && !(["auto", "scroll"].includes(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)) p = p.parentElement;
      const top = p ? p.getBoundingClientRect().top : 0;
      return el.getBoundingClientRect().top - top;
    });
    expect(gap, "the row's top edge is inside its scroll box").toBeGreaterThanOrEqual(-0.5);
  });
});

test.describe("weakness profile layout · 262×568 (iPhone at 150 %)", { tag: ["@p6"] }, () => {
  test.use({ ...DEVICES.iphone, viewport: { width: 262, height: 568 }, timezoneId: "UTC" });

  test("regression: weakness-drill-button-overflow — nothing runs past a narrow phone's edge", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    await tr5(page.request);
    await openWeakness(page, "ready");
    await expect(page.getByTestId("weakness-row").first()).toHaveAttribute("data-open", "");
    await noHorizontalOverflow(page, "262 profile");
  });
});

for (const device of ["iphone", "ipad-portrait"] as const) {
  test.describe(`weakness profile layout · ${device}`, { tag: ["@p6"] }, () => {
    test.use({ ...DEVICES[device], timezoneId: "UTC" });

    test("regression: weakness-phone-layout-shift — the page does not move after its first paint; the time-pressure unit shows", async ({ page, weak }) => {
      test.setTimeout(600_000);
      await weak("weak-member");
      const p = await tr5(page.request);
      await page.addInitScript(() => {
        const w = window as unknown as { __rcShift: number };
        w.__rcShift = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__rcShift += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      await openWeakness(page, "ready");
      await page.waitForTimeout(2_500);
      const shift = await page.evaluate(() => (window as unknown as { __rcShift: number }).__rcShift);
      expect(shift, "cumulative layout shift of the profile").toBeLessThan(0.01);
      const tp = [...p.top, ...p.more].find((r) => r.pattern === "rc:timePressure");
      if (tp) {
        const row = page.locator('[data-testid="weakness-row"][data-pattern="rc:timePressure"]').first();
        if ((await row.count()) === 0) await page.getByTestId("weakness-see-all").click();
        await expect(row.getByTestId("weakness-rate-unit")).toHaveText("under 1 min");
      }
    });
  });
}

for (const device of ["desktop-1440", "iphone"] as const) {
  test.describe(`weakness profile clock · ${device} (FIX-2)`, { tag: ["@p6"] }, () => {
    test.use({ ...DEVICES[device], timezoneId: "UTC" });

    test("regression: weakness-clock-bars-squeezed — each bar's height is its value over the largest one", async ({ page, weak }) => {
      test.setTimeout(600_000);
      await weak("weak-member");
      const p = await tr5(page.request);
      const buckets = p.breakdown?.clock?.buckets ?? [];
      expect(buckets.filter((b) => b.per100 !== null).length, "the member has a Clock tab").toBeGreaterThanOrEqual(2);
      await openWeakness(page, "ready");
      await page.getByTestId("weakness-tab-clock").click();
      const bars = page.getByTestId("weakness-clock-bar");
      await expect(bars).toHaveCount(4);
      const heights = await bars.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      const tracks = await page.getByTestId("weakness-clock-track").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      const max = Math.max(...buckets.map((b) => b.per100 ?? 0));
      buckets.forEach((b, i) => {
        if (b.per100 === null) return;
        const want = Math.max(2, Math.round((b.per100 / max) * 100)) / 100;
        expect(Math.abs(heights[i]! / tracks[i]! - want), `${b.key}: ${b.per100} of ${max}`).toBeLessThanOrEqual(0.02);
      });
    });
  });
}

test.describe("weakness profile tabs · desktop-1440 keyboard (FIX-2)", { tag: ["@p6"] }, () => {
  test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

  test("regression: weakness-tablist-tab-stop — after mouse clicks on tabs, Tab never stops on the tab list itself", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    await tr5(page.request);
    await openWeakness(page, "ready");
    await page.getByTestId("weakness-tab-clock").click();
    await page.getByTestId("weakness-tab-phase").click();
    await page.getByTestId("weakness-tab-phase").click();
    await page.getByTestId("weakness-see-all").focus();
    const stops: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      stops.push(await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("role") ?? ""}`));
      if (stops.at(-1) === "BUTTON:tab") break;
    }
    expect(stops, "the tab list hands the focus to its active tab").not.toContain("DIV:tablist");
    expect(stops.at(-1)).toBe("BUTTON:tab");
  });
});
