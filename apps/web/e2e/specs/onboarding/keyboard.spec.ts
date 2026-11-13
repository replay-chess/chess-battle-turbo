// Onboarding with the keyboard only (phase-04 plan §12.4 `onboarding/keyboard.spec.ts`; §4.0 "Shared interactions";
// testing P4 a11y). @p4 @local-only
//
// No `click()`: Tab moves through each step in order to its primary control, Enter submits every step (Enter in the
// username field looks up, then continues), focus lands on each step's h1 after a navigation, Alt+← goes back, and
// the band picker is one tab stop with a roving tabindex (arrows move the choice). Stops at Dodo. Project:
// desktop-1440.
import type { Page } from "@playwright/test";
import { DEVICES, expect, expectStep, gotoStep, test, uniqueHandle, waitHydrated } from "./_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

const activeTestId = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null);

/** Presses Tab until the element with `testId` has focus (at most `max` presses); returns the presses used. */
async function tabTo(page: Page, testId: string, max = 30): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    if ((await activeTestId(page)) === testId) return i;
  }
  throw new Error(`Tab never reached ${testId} in ${max} presses (last focus: ${await activeTestId(page)})`);
}

async function expectHeadingFocused(page: Page): Promise<void> {
  await expect(page.locator("[data-onb-h1]:visible").first()).toBeFocused({ timeout: 15_000 });
}

test("the whole onboarding with the keyboard (desktop)", { tag: ["@p4", "@local-only"] }, async ({ page, leasePersona, upstream }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
  test.setTimeout(300_000);
  const me = await leasePersona("onboarding-fresh");
  await upstream.dodoFor(me.email, { webhook: false });
  await page.route("**/dodo/pay/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Dodo</title><p>reached Dodo</p>" }));

  // Welcome: the h1 has focus on arrival; Tab reaches Get Started; Enter.
  await gotoStep(page, "");
  await expectStep(page, "welcome");
  await waitHydrated(page, '[data-testid="onb-get-started"]');
  await page.locator("[data-onb-h1]:visible").first().focus();
  await tabTo(page, "onb-get-started");
  await page.keyboard.press("Enter");

  // Link: focus on the h1; Tab to the field; type; Enter looks up; Enter again continues.
  await expectStep(page, "link");
  await expectHeadingFocused(page);
  await waitHydrated(page, '[data-testid="onb-username"]');
  await tabTo(page, "onb-username");
  await page.keyboard.type(uniqueHandle("keys", testInfo));
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="onb-found"]:visible')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="onb-username"]')).toBeFocused();
  await page.keyboard.press("Enter");

  // Confirm: Tab to That's Me; Enter.
  await expectStep(page, "confirm");
  await expectHeadingFocused(page);
  await waitHydrated(page, '[data-testid="onb-thats-me"]');
  await tabTo(page, "onb-thats-me");
  await page.keyboard.press("Enter");

  // Level: the band picker is one tab stop; arrows move the choice (roving tabindex); Tab on to Continue.
  await expectStep(page, "level");
  await expectHeadingFocused(page);
  await waitHydrated(page, '[data-testid="onb-band-picker"] [role="radio"]');
  const radios = page.locator('[data-testid="onb-band-picker"] [role="radio"]');
  await expect(radios.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.getAttribute("role") === "radio")) break;
  }
  const before = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press("ArrowRight");
  const after = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), checked: document.activeElement?.getAttribute("aria-checked") }));
  expect(after.text).not.toBe(before);
  expect(after.checked).toBe("true");
  await expect(radios.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  await tabTo(page, "onb-continue");
  await page.keyboard.press("Enter");

  // Goals: Alt+← back to Level (the choice kept), then forward again with Enter.
  await expectStep(page, "goals");
  await expectHeadingFocused(page);
  await page.keyboard.press("Alt+ArrowLeft");
  await expectStep(page, "level");
  await expect(page.locator('[data-testid="onb-band-picker"] [role="radio"][aria-checked="true"]')).toHaveText(after.text ?? "");
  await waitHydrated(page, '[data-testid="onb-continue"]');
  await page.locator("[data-onb-h1]:visible").first().focus();
  await tabTo(page, "onb-continue");
  await page.keyboard.press("Enter");
  await expectStep(page, "goals");
  await waitHydrated(page, '[data-testid="onb-continue"]');
  await tabTo(page, "onb-continue");
  await page.keyboard.press("Enter");

  // Plan: Tab to the CTA; Enter leaves for Dodo.
  await expectStep(page, "plan");
  await expectHeadingFocused(page);
  await waitHydrated(page, '[data-testid="onb-start-checkout"]');
  await tabTo(page, "onb-start-checkout");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dodo\/pay\//, { timeout: 60_000 });
});

// regression: onb-enter-from-heading, onb-not-me-focus, segmented-arrows-select (FIX-1, the UI review's k2-enter walk):
// Enter submits each step from wherever the focus lands (the page on Welcome's first load, the h1 after every step
// navigation), Not Me (Esc) leaves the cleared username field focused, and the arrow keys SELECT in the segmented
// controls (Goals "Time a day", the Plan's billing period), not only move the focus.
test("Enter from the landing focus, Not Me focus, segmented arrows (desktop)", { tag: ["@p4", "@local-only"] }, async ({ page, leasePersona, upstream }, testInfo) => {
  test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
  test.setTimeout(300_000);
  const me = await leasePersona("onboarding-fresh");
  await upstream.dodoFor(me.email, { webhook: false });
  await page.route("**/dodo/pay/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Dodo</title><p>reached Dodo</p>" }));
  const pressFromHeading = async () => {
    await expectHeadingFocused(page);
    await page.keyboard.press("Enter");
  };

  // Welcome, first load: nothing focused (the page itself); Enter = Get Started.
  await gotoStep(page, "");
  await expectStep(page, "welcome");
  await waitHydrated(page, '[data-testid="onb-get-started"]');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Enter");

  // Link → Confirm.
  await expectStep(page, "link");
  await waitHydrated(page, '[data-testid="onb-username"]');
  const handle = uniqueHandle("enter", testInfo);
  await page.locator('[data-testid="onb-username"]').focus();
  await page.keyboard.type(handle);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="onb-found"]:visible')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Enter");
  await expectStep(page, "confirm");
  await waitHydrated(page, '[data-testid="onb-thats-me"]');

  // Not Me (Esc): back on Link, the field cleared AND focused (plan §4.3), not the h1.
  await expectHeadingFocused(page);
  await page.keyboard.press("Escape");
  await expectStep(page, "link");
  await expect(page.locator('[data-testid="onb-username"]')).toHaveValue("");
  await expect(page.locator('[data-testid="onb-username"]')).toBeFocused();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="onb-username"]')).toBeFocused({ timeout: 1_000 });
  await page.keyboard.type(handle);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="onb-found"]:visible')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Enter");

  // Confirm: Enter from the h1 = That's Me.
  await expectStep(page, "confirm");
  await waitHydrated(page, '[data-testid="onb-thats-me"]');
  await pressFromHeading();

  // Level (the band prefilled from Chess.com): Enter from the h1 = Continue.
  await expectStep(page, "level");
  await waitHydrated(page, '[data-testid="onb-continue"]');
  await expect(page.locator('[data-testid="onb-band-picker"] [role="radio"][aria-checked="true"]')).toHaveCount(1);
  await pressFromHeading();

  // Goals: ArrowRight in "Time a day" selects the next value; Enter from the h1 = Continue.
  await expectStep(page, "goals");
  await waitHydrated(page, '[data-testid="onb-continue"]');
  const minutes = page.locator('[data-testid="onb-minutes"] [role="radio"]');
  const checkedBefore = await page.locator('[data-testid="onb-minutes"] [role="radio"][aria-checked="true"]').textContent();
  await page.locator('[data-testid="onb-minutes"] [role="radio"][aria-checked="true"]').focus();
  await page.keyboard.press("ArrowRight");
  // The selection moves on the keydown; Radix moves the focus on the next tick: both end on the same item.
  const checkedNow = page.locator('[data-testid="onb-minutes"] [role="radio"][aria-checked="true"]');
  await expect(checkedNow).not.toHaveText(checkedBefore ?? "");
  await expect(checkedNow, "the arrow selected what it focused").toBeFocused();
  await expect(minutes.and(page.locator('[aria-checked="true"]'))).toHaveCount(1);
  await page.locator("[data-onb-h1]:visible").first().focus();
  await page.keyboard.press("Enter");

  // Plan: ArrowRight on the billing period switches to Yearly (the price follows); Enter from the h1 = Start.
  await expectStep(page, "plan");
  await waitHydrated(page, '[data-testid="onb-start-checkout"]');
  const price = await page.locator('[data-testid="onb-plan-price"]').textContent();
  await page.locator('[data-testid="onb-plan-period"] [role="radio"][aria-checked="true"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-testid="onb-plan-period"] [role="radio"][aria-checked="true"]')).toHaveText(/year/i);
  await expect(page.locator('[data-testid="onb-plan-price"]')).not.toHaveText(price ?? "");
  await page.locator("[data-onb-h1]:visible").first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dodo\/pay\//, { timeout: 60_000 });
});
