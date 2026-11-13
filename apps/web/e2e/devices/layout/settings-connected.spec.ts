// Connected accounts on every device × zoom (phase-04 plan §12.4 "Device × zoom layout specs", §4.10). @p4
//
// /dev/ui/connected?state= in each of the 10 states of DR/V4SettingsConnected (and its Error twin), inside the real app
// shell: no sideways scroll anywhere; the panel is the scroller (a phone may scroll the panel, never the document);
// the cards and their primary controls are reachable inside the viewport; the controls meet the tap-target floors.
// `stress=1` (20-character usernames, five-digit counts) runs at 150 %. Tiered by playwright.devices.config.ts.
// The @demo tags are on the desktop family (the boards are desktop drawings).
import type { Page, TestInfo } from "@playwright/test";
import { expectTapTargets } from "../helpers";
import { familyOf } from "../game/families";
import { expect, gotoStable, test } from "./fixtures";

const STATES = [
  "default",
  "syncing",
  "sync_failed",
  "rate_limited",
  "not_found",
  "private_games",
  "li_connecting",
  "li_denied",
  "both_linked",
  "none_linked",
] as const;

const STRESS_ZOOM = 1.5;

async function check(page: Page, path: string, state: string): Promise<void> {
  await gotoStable(page, path);
  const panel = page.getByTestId("settings-connected");
  await expect(panel).toHaveAttribute("data-state", state, { timeout: 30_000 });
  const m = await page.evaluate(() => ({
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
  }));
  expect(m.sw, "no horizontal page scroll").toBeLessThanOrEqual(m.iw + 1);
  expect(m.sh, "the document does not scroll (the panel does)").toBeLessThanOrEqual(m.ih + 1);
  // Every card's first action is reachable: scroll it into view inside the panel, then it is in the viewport.
  const cards = page.locator('[data-testid^="account-card-"]:visible');
  expect(await cards.count(), "both provider cards").toBe(2);
  for (const card of await cards.all()) {
    const action = card.locator("button:visible, a:visible").first();
    await action.scrollIntoViewIfNeeded();
    const box = (await action.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.y + box.height, "the card's first action inside the viewport").toBeLessThanOrEqual(vp.height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  }
  await expectTapTargets(page, { root: '[data-testid="settings-connected"]' });
}

// regression: connected-skeleton-header-shift (FIX-2, UI review round 2): the loading state registered no Back, so the
// tab-bar top bar showed the logo + title while loading (overlapping at iPhone 125 %, 314 px) and then switched to
// "‹ Profile": the skeleton now shows the loaded page's top bar, and nothing in the top bar overlaps.
async function checkLoading(page: Page): Promise<void> {
  await gotoStable(page, "/dev/ui/connected?state=loading");
  await expect(page.getByText("Loading your linked accounts…")).toBeAttached({ timeout: 30_000 });
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: document.documentElement.clientWidth }));
  expect(m.sw, "no horizontal page scroll").toBeLessThanOrEqual(m.iw + 1);
  const topbar = page.getByTestId("shell-topbar");
  if (!(await topbar.isVisible())) {
    // Desktop chrome: the page header carries the profile link instead.
    await expect(page.getByTestId("settings-connected-profile")).toBeVisible();
    return;
  }
  await expect(page.getByTestId("shell-back"), "the loaded page's Back, while loading").toBeVisible();
  const boxes = await topbar.evaluate((bar) =>
    [...bar.querySelectorAll<HTMLElement>("a, button, [data-testid='shell-topbar-title']")]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { what: el.getAttribute("data-testid") ?? el.tagName, l: r.left, r: r.right };
      }),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(Math.min(a.r, b.r) - Math.max(a.l, b.l), `${a.what} and ${b.what} overlap in the top bar`).toBeLessThanOrEqual(1);
    }
  }
}

test("/dev/ui/connected?state=loading: the loaded page's top bar, nothing overlapping", async ({ page }) => {
  await checkLoading(page);
});

test.describe("connected accounts one viewport @p4", () => {
  for (const state of STATES) {
    const path = `/dev/ui/connected?state=${state}`;
    test(path, { tag: [`@demo:V4SettingsConnected.${state}`, `@demo:V4SettingsConnectedError.${state}`] }, async ({ page }, testInfo: TestInfo) => {
      test.skip(familyOf(testInfo) !== "desktop", "the @demo tags belong to the desktop boards; the other families run below");
      await check(page, path, state);
    });
    test(`${path} (phones and tablets)`, async ({ page }, testInfo: TestInfo) => {
      test.skip(familyOf(testInfo) === "desktop", "desktop runs above");
      await check(page, path, state);
    });
    test(`${path}&stress=1`, async ({ page }, testInfo: TestInfo) => {
      test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
      await check(page, `${path}&stress=1`, state);
    });
  }
});
