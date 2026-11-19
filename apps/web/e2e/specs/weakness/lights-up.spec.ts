// P6 lights up on real data (phase-06 plan §12.4 `lights-up.spec.ts`, §1.2 T10; WP7): the leased `weak-member`
// persona (WP8's persona writer: 54 real CC0 games graded by the e2e worker, the bank J1 extracted from them and the
// READY snapshot RECOMPUTE_WEAKNESS wrote; e2e/specs/weakness/_lib/weakness.ts `weak`) with the
// `weakness` flag on (FLAGS_OVERRIDE, as on dev). @p6
//
//   hub     "All training" shows "Weakness drills · {label} · {n} in your bank" linking the top pattern's drill; today's
//           plan is "Built from your last 20 games."; Theme mastery links the profile; the Train sections list
//           "Weakness Profile"
//   home    the bank card reads "{label} is your top weakness ({n} in bank)." for a band comparison, else "{label} is
//           your most common mistake ({n} in bank)." (FIX-4, D-P6-FIX4-1: the profile's own list mode decides)
//   ⌘K      "Weakness Profile" (G then W) opens /train/weakness?from=palette
//   g w     the chord opens /train/weakness?from=chord
// Every value is cross-checked with the member's own TR-5 payload (the profile page's rows), never hard-coded.
// The flag-off half (hub and Home equal P5's) is the `flags-off` project's (plan §12.4, TE X11).
import type { Page } from "@playwright/test";
import { DEVICES, expect, gotoOk, serverClock, test, waitHydrated } from "./_lib/weakness";

type Row = { pattern: string; slug: string; label: string; inBank: number; matchable: boolean };

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

async function topRow(page: Page): Promise<Row & { listMode: string }> {
  const res = await page.request.get("/api/train/weakness");
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { data: { status: string; listMode: string; top: Row[] } };
  expect(body.data.status).toBe("ready");
  return { ...body.data.top[0]!, listMode: body.data.listMode };
}

test.describe("weakness lights up · desktop-1440@100", { tag: ["@p6"] }, () => {
  test("hub row, plan footnote, mastery link and the Train section", async ({ weak, page }) => {
    test.setTimeout(300_000);
    await weak("weak-member");
    const top = await topRow(page);
    await gotoOk(page, "/train");
    const row = page.getByTestId("train-all-weakness");
    await expect(row).toBeVisible({ timeout: 120_000 });
    await expect(row).toContainText("Weakness drills");
    await expect(page.getByTestId("train-all-weakness-sub")).toHaveText(`${top.label} · ${top.inBank} in your bank`);
    await expect(row).toHaveAttribute("href", `/train/weakness/${top.slug}?from=hub`);
    // Today's plan (R1, the hub's own query) is built from the games.
    const today = (await (await page.request.get("/api/train/today")).json()) as { data: { plan: { basis: string; footnote: string } } };
    expect(today.data.plan.basis).toBe("games20");
    expect(today.data.plan.footnote).toMatch(/^Built from your last 20 games\. Daily cap: \d+ reviews?\.$/);
    const mastery = page.getByTestId("train-mastery");
    if (await mastery.isVisible()) await expect(page.getByTestId("train-mastery-weakness")).toHaveAttribute("href", "/train/weakness?from=hub");
    await expect(page.getByTestId("nav-item-weakness")).toHaveText("Weakness Profile");
    await row.click();
    await page.waitForURL(new RegExp(`/train/weakness/${top.slug}\\?from=hub$`));
  });

  test("Home: the bank card names the top weakness", async ({ weak, page, baseURL }) => {
    test.setTimeout(300_000);
    await weak("weak-member");
    const top = await topRow(page);
    // The bank's new cards are released at the member's next 08:00; while nothing is due P5's "Nothing due. Next batch
    // …" line keeps the card (WP7 decision 2). A day on (x-rc-now on the page's requests) the cards are due.
    const clock = await serverClock(page, baseURL!);
    clock.set(new Date(Date.now() + 24 * 3_600_000));
    await gotoOk(page, "/home");
    const line = page.getByTestId("home-bank-line");
    await expect(line).toBeVisible({ timeout: 120_000 });
    // FIX-4 (D-P6-FIX4-1): "top weakness" only when the profile compares with the band; otherwise "most common mistake".
    const noun = top.listMode === "vs_band" ? "top weakness" : "most common mistake";
    await expect(line).toHaveText(`${top.label} is your ${noun} (${top.inBank} in bank).`);
  });

  test("⌘K 'Weakness Profile' and the g w chord", async ({ weak, page }) => {
    test.setTimeout(300_000);
    await weak("weak-member");
    await gotoOk(page, "/home");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 120_000 });
    // The shortcuts are listened for once the shell has hydrated.
    await waitHydrated(page, '[data-testid="app-shell"] a');
    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("command-palette-input").fill("weakness");
    await expect(page.getByTestId("palette-item-weakness")).toContainText("Weakness Profile");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/train\/weakness\?from=palette$/);
    await gotoOk(page, "/home");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 120_000 });
    await waitHydrated(page, '[data-testid="app-shell"] a');
    await page.keyboard.press("g");
    await page.keyboard.press("w");
    await page.waitForURL(/\/train\/weakness\?from=chord$/);
  });
});
