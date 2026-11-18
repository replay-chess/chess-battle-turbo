// The Weakness Profile's interaction lab budget (phase-06 plan §9.4 "Tab switch, accordion, See all: ≤ 50 ms in the lab
// (no network)"): from the input to the next painted frame, timed with performance.now() and requestAnimationFrame in the
// page. It times paints, so it runs alone in the `lab-desktop-1440@100` project (playwright.devices.config.ts DEVICES_LAB;
// ci.yml devices-p5 runs the lab step after the suite, on the same build), like P5's move → verdict gate.
//
// regression: weakness-tab-lab-in-suite (REGRESSION-6). The budget was asserted inside e2e/specs/weakness/profile.spec.ts,
// in the parallel e2e suite: on webkit-iphone a Clock switch read 64 ms there, the renderer waiting a frame for the other
// workers, with no product work in the window. profile.spec keeps the functional half (arrow keys, no request) and
// records its times as annotations; the budget is gated here.
//
// The page is /dev/ui/weakness?state=ready: the real WeaknessView on the WP1 payload fixture. This is a timing gate, not
// a state proof (the real-data profile is profile.spec's and routes.real.ts's).
import type { Page } from "@playwright/test";
import { expect, gotoStable, test } from "./fixtures";

const BUDGET_MS = 50;

/** What the input must have changed before the next painted frame ends the timing. */
type Done = { selector: string; attr: string; value: string } | { selector: string; moreThan: number };

/** Dispatches `act` on `target` in the page and returns the ms until `done` holds and one more frame has painted. */
async function timed(page: Page, act: "ArrowRight" | "click", target: string, done: Done): Promise<number> {
  return page.evaluate(
    async ({ act, target, done }) => {
      const el = document.querySelector<HTMLElement>(target);
      if (!el) throw new Error(`no ${target}`);
      const ok = () =>
        "attr" in done
          ? document.querySelector(done.selector)?.getAttribute(done.attr) === done.value
          : document.querySelectorAll(done.selector).length > done.moreThan;
      const t0 = performance.now();
      if (act === "click") el.click();
      else el.dispatchEvent(new KeyboardEvent("keydown", { key: act, bubbles: true }));
      for (;;) {
        if (ok()) break;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (performance.now() - t0 > 2_000) break;
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return performance.now() - t0;
    },
    { act, target, done },
  );
}

const tid = (id: string) => `[data-testid="${id}"]`;

test("tab switch, accordion and See all paint within 50 ms, no request @p6 @lab", async ({ page }, testInfo) => {
  test.skip(testInfo.project.metadata?.lab !== true, "the lab project only (desktop-1440@100 settings, run alone: it times paints)");
  await gotoStable(page, "/dev/ui/weakness?state=ready");
  await expect(page.getByTestId("weakness")).toBeVisible();
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
  });
  const times: Record<string, number> = {};

  // Tabs: Phase is focused, then → Clock → Openings (the keyboard path of §4.11).
  await page.getByTestId("weakness-tab-phase").click();
  await expect(page.getByTestId("weakness-tab-phase")).toBeFocused();
  times["tab clock"] = await timed(page, "ArrowRight", tid("weakness-tab-phase"), { selector: tid("weakness-tab-clock"), attr: "aria-selected", value: "true" });
  await expect(page.getByTestId("weakness-tab-clock")).toBeFocused();
  times["tab openings"] = await timed(page, "ArrowRight", tid("weakness-tab-clock"), { selector: tid("weakness-tab-open"), attr: "aria-selected", value: "true" });

  // Accordion: open row 2 (row 1 closes).
  const heads = page.getByTestId("weakness-row-head");
  await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "true");
  await expect(heads.nth(1)).toHaveAttribute("aria-expanded", "false");
  // Row 2's header, marked for the in-page timer (the page has no id for it).
  await heads.nth(1).evaluate((el) => el.setAttribute("data-lab", "row2"));
  const row2 = '[data-lab="row2"]';
  times.accordion = await timed(page, "click", row2, { selector: row2, attr: "aria-expanded", value: "true" });
  await expect(heads.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(heads.nth(0)).toHaveAttribute("aria-expanded", "false");

  // See all: the "more" rows appear.
  const before = await page.getByTestId("weakness-row").count();
  times["see all"] = await timed(page, "click", tid("weakness-see-all"), { selector: tid("weakness-row"), moreThan: before });
  await expect(page.getByTestId("weakness-see-all")).toHaveText("Show fewer");
  expect(await page.getByTestId("weakness-row").count(), "See all shows the more rows").toBeGreaterThan(before);

  testInfo.annotations.push({ type: "lab ms", description: Object.entries(times).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ") });
  expect(requests, "no /api request").toEqual([]);
  for (const [what, ms] of Object.entries(times)) expect(ms, `${what}: paints within ${BUDGET_MS} ms`).toBeLessThanOrEqual(BUDGET_MS);
});
