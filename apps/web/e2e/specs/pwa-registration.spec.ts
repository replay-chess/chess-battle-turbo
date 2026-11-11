// The service worker is registered by the app (lib/pwa/registerServiceWorker.ts), not by next-pwa's auto-registration,
// whose unhandled `workbox.register()` rejection failed paywall-game on webkit-iphone (CI run 43037495714:
// "[pageerror] SecurityError: Script http://localhost:3000/sw.js load failed" when the seat's page navigated while
// /sw.js was still loading). Here /sw.js is held until the test releases it, so every navigation leaves a
// registration in flight (WebKit cancels it: the old auto-registration failed this test with one page error per
// navigation); the console guard fails the test on any page error. A real failure (sw.js missing) still reaches the
// console.
import type { BrowserContext, ConsoleMessage, Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";
import { test } from "../fixtures/console-guard";

const SW = /\/sw\.js(\?|$)/;

/** Holds every /sw.js request until `release()`; counts the requests seen. */
async function holdServiceWorker(context: BrowserContext): Promise<{ seen(): number; release(): Promise<void> }> {
  const waiting: Route[] = [];
  let seen = 0;
  let released = false;
  await context.route(SW, async (route: Route) => {
    seen++;
    if (released) await route.continue().catch(() => undefined);
    else waiting.push(route);
  });
  return {
    seen: () => seen,
    release: async () => {
      released = true;
      for (const r of waiting.splice(0)) await r.continue().catch(() => undefined); // a cancelled one is gone
    },
  };
}

/** The page is loaded and quiet: WebKit also reports Clerk's own requests cut by a navigation as page errors. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, {
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

test.describe("service worker registration @p1 @smoke @public", () => {
  test("a navigation that cancels the registration is not a page error", async ({ context, page }) => {
    test.setTimeout(120_000);
    const sw = await holdServiceWorker(context);
    for (const [from, to] of [
      ["/about", "/privacy"],
      ["/terms", "/about"],
    ]) {
      await page.goto(from!, { waitUntil: "load" });
      await settled(page);
      await expect.poll(sw.seen, { message: "the registration is waiting for the held /sw.js" }).toBeGreaterThan(0);
      await page.goto(to!, { waitUntil: "load" });
    }
    // The last page registers for real once the script is let through.
    await settled(page);
    await sw.release();
    await expect
      .poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/"))), { timeout: 30_000 })
      .toBe(true);
  });

  test.describe("a broken /sw.js", () => {
    // The provoked failure: our report, and Chrome's own line for each failed attempt. The array goes in a
    // `[value, { scope }]` tuple: Playwright reads a bare two-item array whose second item is an object as one.
    const allow = [
      /\[pwa\] service worker registration failed/,
      /^A bad HTTP response code \(404\) was received when fetching the script\.$/,
    ];
    test.use({ allowConsole: [allow, { scope: "test" }] });
    test("is retried, then reported on the console (never thrown)", async ({ context, page }) => {
      test.setTimeout(60_000);
      await context.route(SW, (route) => route.fulfill({ status: 404, body: "" }));
      const reported: ConsoleMessage[] = [];
      page.on("console", (m) => {
        if (/\[pwa\] service worker registration failed/.test(m.text())) reported.push(m);
      });
      await page.goto("/about", { waitUntil: "load" });
      // 3 attempts: at load, then after 2 s and 10 s (SW_RETRY_DELAYS_MS).
      await expect.poll(() => reported.length, { timeout: 30_000 }).toBe(1);
      expect(reported[0]!.type()).toBe("error");
    });
  });
});
