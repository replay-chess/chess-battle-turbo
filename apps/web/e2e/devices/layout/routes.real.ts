// Real-route layer (phase-01 plan §12.4, CT X9; 1Q·2). Automates owner test T1.
//
// The demo routes in routes.ts prove the layout on fixed data. This layer signs in as a shared member and
// walks the real (app) pages on five projects: desktop-1440@100/150, iphone@100/125 and ipad-portrait@100
// (playwright.devices.config.ts adds this file to those projects only). On each page it checks:
//   - the shell renders in the mode expectedShellMode() predicts for the viewport and pointer;
//   - nothing scrolls sideways (document and main);
//   - after scrolling to the end, a legacy fixed CTA bar sits above the tab bar.
// Read-only for the member: it only loads pages.
//
// Needs the member's Clerk login (.env.test, loaded by the config) and a server with the dev database:
//   cd apps/web && npx playwright test -c playwright.devices.config.ts routes.real.ts
//   (DEVICES_BASE_URL=http://localhost:3000 to reuse the shared next dev)
import { clerkSetup } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { signIn } from "../../fixtures/auth";
import { expect, shellModeFor, test, waitForStable } from "./fixtures";
import { NAV_WIDTH } from "./modes";

/** The projects that run this file (the config's REAL_ROUTE_PROJECTS mirrors it). */
const REAL_ROUTE_PROJECTS = [
  "desktop-1440@100",
  "desktop-1440@150",
  "iphone@100",
  "iphone@125",
  "ipad-portrait@100",
] as const;

const MEMBER = "A";

type EndMetrics = {
  vw: number;
  vh: number;
  scrollW: number;
  main: { sw: number; cw: number } | null;
  cta: { top: number; bottom: number } | null;
  tabbar: { top: number; bottom: number } | null;
};

/** Scrolls the document and main to the end, then measures the overflow and the fixed bars. */
async function scrollAndMeasure(page: Page): Promise<EndMetrics> {
  return page.evaluate(async () => {
    const main = document.querySelector<HTMLElement>("[data-rc-main]");
    window.scrollTo(0, document.scrollingElement!.scrollHeight);
    if (main) main.scrollTop = main.scrollHeight;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    // Legacy pages place their fixed CTA bars with bottom-[var(--rc-fixed-bottom)] (viewport.css).
    const cta = [...document.querySelectorAll('[class*="bottom-[var(--rc-fixed-bottom"]')].find(
      (el) => getComputedStyle(el).position === "fixed" && visible(el),
    );
    const tab = document.querySelector("[data-rc-tabbar]");
    const de = document.documentElement;
    return {
      vw: de.clientWidth,
      vh: de.clientHeight,
      scrollW: document.scrollingElement!.scrollWidth,
      main: main && { sw: main.scrollWidth, cw: main.clientWidth },
      cta: box(cta),
      tabbar: tab && visible(tab) ? box(tab) : null,
    };
  });
}

async function gotoReal(page: Page, path: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
      expect(res?.status(), `${path} status`).toBe(200);
      break;
    } catch (error) {
      if (attempt > 0 || !/ERR_ABORTED|frame was detached|interrupted|Timeout/i.test(String(error))) throw error;
    }
  }
  await expect(page.getByTestId("app-shell"), `${path}: the member shell`).toBeVisible({ timeout: 30_000 });
  await waitForStable(page);
}

test.describe("real routes @p1", () => {
  test.beforeAll(async () => {
    // The Clerk testing token (CLERK_FAPI / CLERK_TESTING_TOKEN) the sign-in helper needs; the main suite
    // gets it from its global setup, this config has none.
    await clerkSetup();
  });

  test("member pages: shell mode, no sideways scroll, CTA bars above the tab bar", async ({ page }) => {
    test.setTimeout(300_000);
    const project = test.info().project.name;
    test.skip(!(REAL_ROUTE_PROJECTS as readonly string[]).includes(project), `real routes run on ${REAL_ROUTE_PROJECTS.join(", ")}`);
    const email = process.env[`E2E_USER_${MEMBER}_EMAIL`];
    test.skip(!email, `E2E_USER_${MEMBER}_EMAIL is not set (.env.test)`);
    await signIn(page, email!, process.env[`E2E_USER_${MEMBER}_PASSWORD`] ?? "");

    const me = await page.request.get("/api/me", { headers: { accept: "application/json" } });
    expect(me.status(), "GET /api/me").toBe(200);
    const ref = ((await me.json()) as { data?: { user?: { ref?: string } } }).data?.user?.ref;
    expect(ref, "the member's ref from /api/me").toBeTruthy();

    for (const path of ["/play", "/tournaments", "/legends", "/openings", `/profile/${ref}`]) {
      await test.step(path, async () => {
        await gotoReal(page, path);
        const mode = await shellModeFor(page);
        if (mode === "tabbar") {
          await expect(page.locator("[data-rc-tabbar]"), `${path}: tab bar`).toBeVisible();
          await expect(page.locator("[data-rc-nav]"), `${path}: no side nav in tab-bar mode`).toBeHidden();
        } else {
          const nav = await page.locator("[data-rc-nav]").boundingBox();
          expect(nav, `${path}: ${mode} nav visible`).not.toBeNull();
          expect(Math.abs(nav!.width - NAV_WIDTH[mode]), `${path}: ${mode} nav width ${nav!.width}`).toBeLessThanOrEqual(1);
          await expect(page.locator("[data-rc-tabbar]"), `${path}: no tab bar in ${mode} mode`).toBeHidden();
        }

        // Entrance animations can hold a fixed bar inside a transformed ancestor for a moment: measure until
        // two readings 300 ms apart agree.
        let m = await scrollAndMeasure(page);
        await expect(async () => {
          const a = await scrollAndMeasure(page);
          await page.waitForTimeout(300);
          m = await scrollAndMeasure(page);
          expect(JSON.stringify(m)).toBe(JSON.stringify(a));
        }).toPass({ timeout: 20_000 });

        expect(m.scrollW, `${path}: no horizontal page scroll ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.vw + 1);
        if (m.main) expect(m.main.sw, `${path}: main has no horizontal overflow`).toBeLessThanOrEqual(m.main.cw + 1);
        test.info().annotations.push({
          type: "measured",
          description: `${path.replace(ref!, "<A>")}: ${mode}${m.cta ? ", CTA bar" : ""}${m.tabbar ? ", tab bar" : ""}`,
        });
        if (m.cta) {
          expect(m.cta.bottom, `${path}: CTA bar inside the viewport ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.vh + 1);
          if (m.tabbar) {
            expect(m.cta.bottom, `${path}: CTA bar above the tab bar ${JSON.stringify(m)}`).toBeLessThanOrEqual(
              m.tabbar.top + 1,
            );
          }
        }
      });
    }
  });
});
