// S3 Profile on real data (phase-06 plan §12.4 `profile.spec.ts`, §4.6, §4.11, §9.4 lab budget; §1.2 T3). Personas
// (§6.8): `weak-member` (54 real CC0 blitz/rapid games graded by the e2e worker, the bank J1 extracted from them, the
// READY profile RECOMPUTE_WEAKNESS wrote) and `noclock` (30 graded games recorded without clocks). Every row, label and
// count is the member's own TR-5 payload. @p6
//
//   accordion    row 1 open; opening row 2 closes row 1; ↓ / ↑ / Home / End move between the row headers
//   See all      the "more" rows appear, "Show fewer" hides them
//   tabs         arrow keys switch Phase → Clock → Openings with no request to the app (the ≤ 50 ms lab budget of §9.4 is
//                timed alone, in the devices lab project: e2e/devices/layout/weakness.lab.spec.ts; each switch's time
//                here is recorded as an annotation only)
//   Clock        the chart's aria-label is the payload's full sentence
//   Openings     a real table (column headers)
//   strengths    the box on the desktop
//   noclock      no Clock tab, its footnote instead
//   telemetry    weakness_viewed {status: ready, patterns}, weakness_row_expanded {pattern}, weakness_tab_changed
import type { Request } from "@playwright/test";
import { DEVICES, expect, openWeakness, PROFILE_BOARD, test, tr5 } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness profile · desktop-1440@100", { tag: ["@p6"] }, () => {
  test("rows, See all, keyboard, tabs without a request, strengths @smoke", { tag: [`@state:${PROFILE_BOARD["desktop-1440"]}.default`] }, async ({ page, weak, telemetry }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    expect(p.status).toBe("ready");
    expect(p.top.length, "a real profile has its three rows").toBe(3);
    expect(p.more.length, "and more under See all").toBeGreaterThanOrEqual(1);
    test.info().annotations.push({ type: "rows", description: [...p.top, ...p.more].map((r) => `${r.label} (${r.inBank} in bank)`).join(" | ") });
    await openWeakness(page, "ready", "?from=nav");
    await expect(page.getByTestId("weakness-headline")).toBeVisible();
    await expect(page.getByTestId("weakness-verified")).toBeVisible();

    const rows = page.getByTestId("weakness-row");
    await expect(rows).toHaveCount(3);
    for (const [i, r] of p.top.entries()) await expect(rows.nth(i)).toHaveAttribute("data-pattern", r.pattern);
    await expect(rows.nth(0)).toHaveAttribute("data-open", "");
    await expect(rows.nth(0).getByTestId("weakness-row-body")).toContainText(`Drill · ${p.top[0]!.inBank} in bank`);
    await rows.nth(2).getByTestId("weakness-row-head").click();
    await expect(rows.nth(2)).toHaveAttribute("data-open", "");
    await expect(rows.nth(0)).not.toHaveAttribute("data-open", "");
    await telemetry.expect("weakness_row_expanded", { pattern: p.top[2]!.pattern, rank: 3 }, { count: 1 });

    // WAI-ARIA accordion keys across the headers.
    const heads = page.getByTestId("weakness-row-head");
    await heads.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await expect(heads.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(heads.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(heads.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(heads.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(heads.nth(0)).toBeFocused();

    const seeAll = page.getByTestId("weakness-see-all");
    await expect(seeAll).toHaveText("See all");
    await seeAll.click();
    await expect(rows).toHaveCount(3 + p.more.length);
    await telemetry.expect("weakness_see_all_clicked", { more_count: p.more.length }, { count: 1 });
    await expect(seeAll).toHaveText("Show fewer");
    await seeAll.click();
    await expect(rows).toHaveCount(3);

    // Tabs: arrow keys, nothing to the app's origin. The paint budget (§9.4: ≤ 50 ms) is a lab gate that runs alone
    // (layout/weakness.lab.spec.ts): timed here, in the parallel suite, a WebKit switch read 64 ms with the renderer
    // waiting for a frame under load (regression: weakness-tab-lab-in-suite, the P5 move → verdict precedent).
    const origin = new URL(page.url()).origin;
    const requests: string[] = [];
    const onReq = (r: Request) => {
      if (r.url().startsWith(origin) && !r.url().includes("/_next/static/")) requests.push(r.url());
    };
    page.on("request", onReq);
    await page.getByTestId("weakness-tab-phase").click();
    for (const next of ["weakness-tab-clock", "weakness-tab-open"]) {
      const ms = await page.evaluate(async (id) => {
        const t0 = performance.now();
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        for (;;) {
          if (document.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-selected") === "true") break;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          if (performance.now() - t0 > 2_000) break;
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        return performance.now() - t0;
      }, next);
      await expect(page.getByTestId(next)).toHaveAttribute("aria-selected", "true");
      test.info().annotations.push({ type: "tab-switch-ms (suite, not gated)", description: `${next} ${ms.toFixed(1)}` });
    }
    await page.waitForTimeout(800);
    page.off("request", onReq);
    expect(requests, "tab switches make no request").toEqual([]);
    await telemetry.expect("weakness_tab_changed", { tab: "open" });

    // The Clock chart reads its whole sentence; the openings are a table.
    await page.getByTestId("weakness-tab-clock").click();
    expect(p.breakdown?.clock, "the member's games carry clocks").not.toBeNull();
    await expect(page.getByTestId("weakness-clock").locator('[role="img"]').first()).toHaveAttribute("aria-label", p.breakdown!.clock!.ariaLabel);
    await page.getByTestId("weakness-tab-open").click();
    const table = page.getByTestId("weakness-openings");
    await expect(table.getByRole("columnheader").first()).toBeVisible();
    await expect(page.getByTestId("weakness-strengths-box")).toBeVisible();
    await telemetry.expect("weakness_viewed", { status: "ready", patterns: p.top.length + p.more.length, top_pattern: p.top[0]!.pattern, entry: "nav", has_clock: true }, { count: 1 });
  });

  test("noclock: no Clock tab, the footnote instead", { tag: [`@state:${PROFILE_BOARD["desktop-1440"]}.default`] }, async ({ page, weak, telemetry }) => {
    test.setTimeout(600_000);
    await weak("noclock");
    const p = await tr5(page.request);
    expect(p.status).toBe("ready");
    expect(p.breakdown?.clock ?? null, "no clock data").toBeNull();
    await openWeakness(page, "ready");
    await expect(page.getByTestId("weakness-tab-phase")).toBeVisible();
    await expect(page.getByTestId("weakness-tab-clock")).toHaveCount(0);
    await expect(page.getByTestId("weakness-no-clock")).toHaveText("These games have no clock data, so there is no Clock tab.");
    await telemetry.expect("weakness_viewed", { status: "ready", has_clock: false }, { count: 1 });
  });
});
