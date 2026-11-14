// Home during an import backlog (phase-05 plan §12.4 `home-backlog.spec.ts`; api-perf AP-10; §5.5, §9.6 "Home
// refetches during an import backlog"). @p5 @local-only
//
// Shared member D on desktop-1440 with Home open. The spec emits through the socket server's signed `/internal/emit`
// (as the worker does) to D's user room:
//   - one `mistakes:added` → the Mistake Bank card's due count changes to the payload's at once, with no request;
//   - 50 frames in 50 s (`analysis:batch` and `mistakes:added`, one per second): at most 2 `GET /api/home` while Home is
//     visible (one trailing refetch per 30 s window), and at least 1;
//   - Home hidden (a background tab), 10 more frames: no request; back in view: exactly 1.
// Read-only for D's data (the events are synthetic; the refetches read D's real Home).
import type { Page } from "@playwright/test";
import { DEVICES, emitToUser, expect, gotoOk, test, viewerRef } from "./_lib/train";

test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

const mistakesAdded = (bankDue: number) => ({ v: 1, games: 1, added: 2, cardsAdded: 2, total: 40 + bankDue, bankDue });
const batch = (bankDue: number) => ({ v: 1, done: 1, failed: 0, queued: 20, refs: [], bankAdded: 1, bankDue });

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  }, hidden);
}

test("a burst of 50 analysis/bank frames costs at most 2 Home refetches; none while hidden, 1 on return", { tag: ["@p5", "@local-only"] }, async ({ member, page }) => {
  test.setTimeout(420_000);
  await member("D");
  const ref = await viewerRef(page);
  const homeGets: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/home") homeGets.push(Date.now());
  });
  await gotoOk(page, "/home");
  await expect(page.locator('[data-testid="home"][data-state]').first()).toBeVisible({ timeout: 120_000 });
  expect(homeGets, "Home's first paint is seeded").toHaveLength(0);

  // The count comes straight from the payload (and proves the user room is connected).
  const due = page.getByTestId("home-bank-due");
  await expect(async () => {
    expect(await emitToUser(ref, "mistakes:added", mistakesAdded(37))).toBe(202);
    await expect(due).toHaveText("37 due", { timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 4_000] });
  const firstFrameAt = Date.now();

  // 50 frames, one per second.
  for (let i = 0; i < 50; i++) {
    const n = 10 + i;
    const status = i % 2 ? await emitToUser(ref, "analysis:batch", batch(n)) : await emitToUser(ref, "mistakes:added", mistakesAdded(n));
    expect(status, `frame ${i}`).toBe(202);
    await page.waitForTimeout(1_000);
  }
  // Let the last window close.
  await page.waitForTimeout(Math.max(0, firstFrameAt + 62_000 - Date.now()));
  const visible = homeGets.length;
  expect(visible, "at most one trailing Home refetch per 30 s while visible").toBeLessThanOrEqual(2);
  expect(visible, "the burst does refresh Home").toBeGreaterThanOrEqual(1);

  // Hidden: nothing until the tab is back.
  await setHidden(page, true);
  const before = homeGets.length;
  for (let i = 0; i < 10; i++) {
    expect(await emitToUser(ref, i % 2 ? "analysis:batch" : "mistakes:added", i % 2 ? batch(5) : mistakesAdded(5))).toBe(202);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(32_000);
  expect(homeGets.length - before, "no refetch while hidden").toBe(0);
  await setHidden(page, false);
  await expect.poll(() => homeGets.length - before, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(3_000);
  expect(homeGets.length - before, "exactly one on return").toBe(1);
});
