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

/** A 1×1 transparent GIF. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * The marketing pages carry ~100 third-party directory badges (/about: 106 images on 40 hosts), and these tests wait for
 * `load`, which waits for every one of them: a slow badge host held a WebKit `load` past the 60 s test timeout under a
 * busy run (REGRESSION-5, webkit-iphone "is retried, then reported"). Third-party images answer a local pixel here, so
 * the tests measure the registration, not the badge hosts. Scripts and fetches (Clerk) pass through.
 */
async function localBadges(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => /^https?:$/.test(url.protocol) && !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => (route.request().resourceType() === "image" ? route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL }) : route.fallback()),
  );
}

// @prod-build: /sw.js exists only in a production build (next-pwa is off under `next dev`; playwright.config.ts).
test.describe("service worker registration @p1 @smoke @public @prod-build", () => {
  test.beforeEach(async ({ context }) => {
    await localBadges(context);
  });

  test("a navigation that cancels the registration is not a page error", async ({ context, page }) => {
    test.setTimeout(180_000);
    const sw = await holdServiceWorker(context);
    // Each page is left only once it is quiet, with its registration waiting on the held /sw.js: every navigation
    // below cancels one registration and nothing else.
    for (const path of ["/about", "/privacy", "/terms", "/about"]) {
      await page.goto(path, { waitUntil: "load" });
      await settled(page);
      await expect.poll(sw.seen, { message: "the registration is waiting for the held /sw.js" }).toBeGreaterThan(0);
    }
    // The last page registers for real once the script is let through.
    await sw.release();
    await expect
      .poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/"))), { timeout: 30_000 })
      .toBe(true);
  });

  test.describe("a retry due while a navigation waits for the next page", () => {
    // WebKit refuses any load the old document starts between the start of a navigation and the commit of the next
    // page, and logs "Cannot load …/sw.js due to access control checks." as a JavaScript error even though the app
    // handles the register() rejection (CI run 43200912012, bot-game on webkit-iphone: "[pageerror]
    // /localhost:3000/sw.js due to access control checks."). Here the first attempt fails (404), so a retry is due
    // 2 s later (SW_RETRY_DELAYS_MS), and the next document is held for 3 s from 0.8 s after the failure: the retry
    // falls inside the navigation. It must not start (no second /sw.js request before the next page commits), and
    // nothing may reach the console guard.
    const allow = [/^A bad HTTP response code \(404\) was received when fetching the script\.$/];
    test.use({ allowConsole: [allow, { scope: "test" }] });
    test("is not started", async ({ context, page }) => {
      test.setTimeout(60_000);
      let seen = 0;
      await context.route(SW, async (route) => {
        seen++;
        if (seen === 1) await route.fulfill({ status: 404, body: "" });
        else await route.continue().catch(() => undefined);
      });
      await page.goto("/about", { waitUntil: "load" });
      await expect.poll(() => seen, { message: "the first attempt", timeout: 30_000 }).toBe(1);
      await page.waitForTimeout(800);
      let seenAtCommit = -1;
      await page.route("**/privacy", async (route) => {
        if (!route.request().isNavigationRequest()) return route.fallback();
        await new Promise((r) => setTimeout(r, 3_000)); // past the 2 s retry
        seenAtCommit = seen;
        await route.continue();
      });
      // Only the commit matters here; the next page's own registration is covered above.
      await page.goto("/privacy", { waitUntil: "domcontentloaded", timeout: 30_000 });
      expect(seenAtCommit, "no attempt was started by the page being left").toBe(1);
    });
  });

  test.describe("a broken /sw.js", () => {
    // The provoked failure: our report, and Chrome's own line for each failed attempt. WebKit logs each attempt as
    // "Failed to load resource: the server responded with a status of 404 (Not Found)", which the guard already
    // leaves to its response rule; its report reads "… TypeError: Script …/sw.js load failed". The array goes in a
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
