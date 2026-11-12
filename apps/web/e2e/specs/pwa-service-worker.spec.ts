// The service worker on a production build (phase-01 plan 9.3 H8; optimization plan 4.8).
//
// regression: until 2026-11 the worker never installed. A custom `workboxOptions.exclude` had replaced next-pwa's
// default excludes, so 148 `.js.map` files sat in the precache list; Sentry deletes the maps after its upload, they
// answered 404, Workbox failed the install, the browser dropped the registration and every page load registered it
// again. scripts/check-sw-precache.mjs checks the built list; this spec checks the worker in the browser:
//   - it reaches "activated" and controls the page, and the next load is controlled from the start (no new install);
//   - a deploy's new sw.js replaces the old worker without reloading the open page, and the next load is the new
//     build's document, from the network;
//   - signed-in documents, RSC payloads and /api responses never reach the worker or Cache Storage, before or after
//     sign-out;
//   - offline: the open page stays and shows the offline chip; a navigation is the browser's own network error, never
//     a cached page (the offline page is P11, phase-11 plan S19; nothing in P1 serves documents offline).
import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "../fixtures";
import { expect, test } from "../fixtures/console-guard";

const SW = /\/sw\.js(\?|$)/;

/** Waits until the registration's worker is activated and controls this page (polled: survives a redirect). */
async function activeAndControlling(
  page: Page,
): Promise<{ state: string; scope: string }> {
  const read = () =>
    page
      .evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        return {
          state: reg?.active?.state ?? "none",
          scope: reg?.scope ?? "",
          controlled: Boolean(navigator.serviceWorker.controller),
        };
      })
      .catch(() => ({ state: "navigating", scope: "", controlled: false }));
  await expect
    .poll(
      async () => {
        const r = await read();
        return r.state === "activated" && r.controlled;
      },
      {
        message: "an activated service worker controls the page",
        timeout: 30_000,
      },
    )
    .toBe(true);
  const { state, scope } = await read();
  return { state, scope };
}

/** Every URL in Cache Storage, by cache. */
async function cachedUrls(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys())
      out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
    return out;
  });
}

/** Cache Storage holds static assets only: hashed build output, image files, the hashed engine. */
function expectStaticOnly(urls: Record<string, string[]>, what: string) {
  for (const [cache, list] of Object.entries(urls)) {
    for (const u of list) {
      const { pathname, search } = new URL(u);
      const ok =
        pathname.startsWith("/_next/static/") ||
        pathname === "/_next/image" ||
        /\/sf18-[0-9a-f]{12}\//.test(pathname) ||
        (/\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?)$/i.test(pathname) &&
          !pathname.startsWith("/api/"));
      expect(ok, `${what}: ${cache} holds ${pathname}${search}`).toBe(true);
    }
  }
}

/** Counts navigations whose document the service worker answered (it must never answer one). */
function watchDocuments(context: BrowserContext) {
  const fromWorker: string[] = [];
  context.on("response", (r) => {
    if (r.request().resourceType() === "document" && r.fromServiceWorker())
      fromWorker.push(r.url());
  });
  return fromWorker;
}

// @prod-build: /sw.js exists only in a production build (next-pwa is off under `next dev`; playwright.config.ts).
test.describe("service worker @p1 @smoke @prod-build", () => {
  test("installs, activates and controls the page; the next load does not install again @public", async ({
    context,
    page,
  }) => {
    let scriptFetches = 0;
    context.on("request", (r) => {
      if (SW.test(new URL(r.url()).pathname)) scriptFetches++;
    });
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    expect(await activeAndControlling(page)).toEqual({
      state: "activated",
      scope: new URL("/", page.url()).href,
    });
    // Nothing is precached (next.config.js PRECACHE_KEEP), and the precache a failed install left is gone.
    await expect
      .poll(async () =>
        Object.keys(await cachedUrls(page)).filter((k) =>
          k.startsWith("workbox-precache"),
        ),
      )
      .toEqual([]);

    await page.reload({ waitUntil: "domcontentloaded" });
    // Controlled from the first script of the new document: the registration survived, nothing was installed.
    const second = await page.evaluate(async () => {
      const controlledAtStart = Boolean(navigator.serviceWorker.controller);
      const reg = await navigator.serviceWorker.getRegistration("/");
      return {
        controlledAtStart,
        active: reg?.active?.state ?? null,
        installing: Boolean(reg?.installing),
        waiting: Boolean(reg?.waiting),
      };
    });
    expect(second).toEqual({
      controlledAtStart: true,
      active: "activated",
      installing: false,
      waiting: false,
    });
    await page.waitForLoadState("load");
    await page.waitForTimeout(2_000); // the registration call of this load has run (it starts after `load`)
    expect(
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        return {
          installing: Boolean(reg?.installing),
          waiting: Boolean(reg?.waiting),
        };
      }),
    ).toEqual({ installing: false, waiting: false });
    // One fetch per install at most; the browser may also check for an update (byte-identical, so no install).
    expect(scriptFetches, "sw.js fetches").toBeLessThanOrEqual(2);
    expectStaticOnly(await cachedUrls(page), "signed out");
  });

  test("a deploy's new worker replaces the old one; the open page is not reloaded and moves on its next load @public", async ({
    context,
    page,
  }) => {
    const documentsFromWorker = watchDocuments(context);
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    await activeAndControlling(page);
    const controllerScript = () =>
      page.evaluate(
        () =>
          new URL(
            navigator.serviceWorker.controller?.scriptURL ?? "about:blank",
          ).href,
      );
    expect(new URL(await controllerScript()).pathname).toBe("/sw.js");

    // The next deploy's worker. The browser installs a new worker when the script it gets for the registration differs
    // (a deploy changes sw.js's bytes; here the script URL differs, `?deploy=next`, because a test cannot change what
    // the shared server sends, and browsers do not let Playwright intercept their worker update checks). Installing,
    // skipWaiting and clientsClaim are the same either way.
    await page.evaluate(() => {
      (window as unknown as { __rcSamePage: boolean }).__rcSamePage = true;
    });
    await page.evaluate(async () => {
      const switched = new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
      await navigator.serviceWorker.register("/sw.js?deploy=next", {
        scope: "/",
      });
      await Promise.race([
        switched,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("no controllerchange in 30 s")),
            30_000,
          ),
        ),
      ]);
    });
    expect(
      new URL(await controllerScript()).search,
      "the new worker controls the open page",
    ).toBe("?deploy=next");
    expect(
      await page.evaluate(
        () => (window as unknown as { __rcSamePage?: boolean }).__rcSamePage,
      ),
      "the open page was not reloaded",
    ).toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration("/");
            return {
              active: reg?.active?.state,
              installing: Boolean(reg?.installing),
              waiting: Boolean(reg?.waiting),
            };
          }),
        { message: "one worker: the old one is gone, none is left waiting" },
      )
      .toEqual({ active: "activated", installing: false, waiting: false });

    // The next load: its document comes from the network (the worker never answers documents), and the build that
    // document belongs to registers its own sw.js, which takes over again.
    const doc = await page.reload({ waitUntil: "load" });
    expect(
      doc?.fromServiceWorker(),
      "the next document comes from the network",
    ).toBe(false);
    expect(
      await page.evaluate(
        () => (window as unknown as { __rcSamePage?: boolean }).__rcSamePage,
      ),
    ).toBeUndefined();
    await expect
      .poll(async () => new URL(await controllerScript()).search, {
        timeout: 30_000,
      })
      .toBe("");
    expect(new URL(await controllerScript()).pathname).toBe("/sw.js");
    expect(documentsFromWorker).toEqual([]);
  });

  test.describe("signed in", () => {
    // These tests sign out and go offline on purpose. WebKit reports every request a navigation cuts (the page's
    // /api reads, RSC prefetches, Clerk's Frontend API and chunks) as an uncaught "… due to access control checks."
    // error, and the signed-out home page carries third-party badges; none of that is about the service worker, so
    // the guard reports here instead of failing. The signed-out tests above keep it enforced.
    test.use({ consoleGuard: "report" });

    test("signed-in pages, RSC and /api never reach the worker or Cache Storage, and sign-out leaves none", async ({
      context,
      page,
    }) => {
      test.setTimeout(240_000);
      const documentsFromWorker = watchDocuments(context);
      const apiFromWorker: string[] = [];
      context.on("response", (r) => {
        const u = new URL(r.url());
        if (
          (u.pathname.startsWith("/api/") ||
            u.searchParams.has("_rsc") ||
            r.request().headers()["rsc"] === "1") &&
          r.fromServiceWorker()
        )
          apiFromWorker.push(u.pathname);
      });
      await signIn(
        page,
        process.env.E2E_USER_A_EMAIL!,
        process.env.E2E_USER_A_PASSWORD!,
      );
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await activeAndControlling(page);
      // A reload, an RSC payload (what a soft navigation fetches) and an /api read, all while controlled.
      await page.reload({ waitUntil: "load" });
      await page.evaluate(() =>
        fetch("/legends?_rsc=e2e", { headers: { RSC: "1" } }).then((r) =>
          r.text(),
        ),
      );
      const me = await page.evaluate(() =>
        fetch("/api/me", { credentials: "same-origin" }).then((r) => r.json()),
      );
      const email = (me as { data: { user: { email: string } } }).data.user
        .email;
      expect(email).toBeTruthy();
      // The account menu: the sidebar button on desktop, the top-bar avatar (a sheet) on the phone.
      const account = page
        .locator(
          '[data-testid="shell-account-button"]:visible, [data-testid="shell-account-avatar"]:visible',
        )
        .first();
      await account.waitFor();
      expectStaticOnly(await cachedUrls(page), "signed in");

      await account.click();
      await page
        .locator('[data-testid="account-item-signout"]:visible')
        .click();
      // signOutEverywhere() sends the browser to "/". On the phone (WebKit) it can end on /sign-in?redirect_url=/play
      // instead, with or without a service worker (seen with serviceWorkers: "block" too): either is signed out.
      await page.waitForURL(
        (u) => u.pathname === "/" || u.pathname.startsWith("/sign-in"),
        // Not "load": the marketing home page's third-party badges and media can hold it back.
        { timeout: 30_000, waitUntil: "domcontentloaded" },
      );
      expectStaticOnly(await cachedUrls(page), "after sign-out");

      // The member page is the server's answer for a signed-out visitor, never the signed-in copy.
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      expect(await page.content()).not.toContain(email);
      expect(
        new URL(page.url()).pathname,
        "a signed-out /play goes to sign-in",
      ).not.toBe("/play");
      expect(documentsFromWorker).toEqual([]);
      expect(apiFromWorker).toEqual([]);
    });

    test.describe("offline", () => {
      test("the open page stays with the offline chip; a navigation is a network error, not a cached page", async ({
        context,
        page,
      }) => {
        test.setTimeout(240_000);
        const documentsFromWorker = watchDocuments(context);
        await signIn(
          page,
          process.env.E2E_USER_A_EMAIL!,
          process.env.E2E_USER_A_PASSWORD!,
        );
        await page.goto("/play", { waitUntil: "load" });
        await activeAndControlling(page);
        await page.goto("/legends", { waitUntil: "load" }); // visited once online, so a cache could hold it
        await context.setOffline(true);
        // Floating on desktop, inline in the banner slot on the phone (OnlineChip); the other one is hidden.
        await expect(
          page.locator('[data-testid^="shell-online-chip"]:visible', {
            hasText: /Offline/,
          }),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
          page.goto("/play", {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          }),
        ).rejects.toThrow();
        await context.setOffline(false);
        await page.goto("/play", { waitUntil: "domcontentloaded" });
        await expect(
          page
            .locator(
              '[data-testid="shell-account-button"]:visible, [data-testid="shell-account-avatar"]:visible',
            )
            .first(),
        ).toBeVisible({
          timeout: 30_000,
        });
        expect(documentsFromWorker).toEqual([]);
      });
    });
  });
});
