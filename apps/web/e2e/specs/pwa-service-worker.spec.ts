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
import { startSlowDocumentProxy } from "../fixtures/slow-document";
import { WEB_PORT } from "../fixtures/socket-server";

const SW = /\/sw\.js(\?|$)/;

/** Waits until the registration's worker is activated and controls this page (polled: survives a redirect). */
async function activeAndControlling(
  page: Page,
): Promise<{ state: string; scope: string }> {
  const read = () =>
    page
      .evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const w = (x?: ServiceWorker | null) => (x ? `${new URL(x.scriptURL).pathname}${new URL(x.scriptURL).search}:${x.state}` : "none");
        return {
          state: reg?.active?.state ?? "none",
          scope: reg?.scope ?? "",
          controlled: Boolean(navigator.serviceWorker.controller),
          detail: `controller=${w(navigator.serviceWorker.controller)} active=${w(reg?.active)} waiting=${w(reg?.waiting)} installing=${w(reg?.installing)} ready=${document.readyState}`,
        };
      })
      .catch(() => ({ state: "navigating", scope: "", controlled: false, detail: "navigating" }));
  // Polled as one line, so a failure shows where the registration stopped.
  await expect
    .poll(
      async () => {
        const r = await read();
        return r.state === "activated" && r.controlled ? "controlled" : r.detail;
      },
      {
        message: "an activated service worker controls the page",
        timeout: 30_000,
      },
    )
    .toBe("controlled");
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

  // regression: the page registers its worker at `load`, and `load` waits for every image, including the marketing
  // footer's third-party badges; a slow badge host kept the worker out (a first visit uncontrolled past 30 s, both
  // browsers). Now the registration starts at load or 4 s after the page starts it, whichever comes first.
  test("a third-party image that never finishes does not hold the worker back @public", async ({ context, page }) => {
    await context.route(
      (u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname),
      async (route) => {
        if (route.request().resourceType() === "image") await new Promise((r) => setTimeout(r, 60_000));
        await route.continue().catch(() => undefined);
      },
    );
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => document.readyState), "load is still held by the image").not.toBe("complete");
    await activeAndControlling(page);
  });

  test("a deploy's new worker replaces the old one; the open page is not reloaded and moves on its next load @public", async ({
    context,
    page,
  }) => {
    const documentsFromWorker = watchDocuments(context);
    // Every navigator.serviceWorker.register() the page makes, with its outcome: if the take-over below does not
    // happen, the failure says whether the reloaded page registered /sw.js at all, and what the browser answered.
    await context.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { __rcSwCalls: string[] }).__rcSwCalls = calls;
      const sw = navigator.serviceWorker;
      if (!sw) return;
      const register = sw.register.bind(sw);
      sw.register = (url: string | URL, options?: RegistrationOptions) => {
        const i = calls.push(`${String(url)} at ${Math.round(performance.now())} ms: pending`) - 1;
        const p = register(url, options);
        p.then(
          () => (calls[i] = calls[i]!.replace("pending", "resolved")),
          (e: unknown) => (calls[i] = calls[i]!.replace("pending", `rejected ${String(e)}`)),
        );
        return p;
      };
    });
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
    // Requests of the reloaded page still in flight, for the failure message below.
    const inFlight = new Set<string>();
    const done = (r: { url(): string }) => inFlight.delete(r.url());
    page.on("request", (r) => inFlight.add(r.url()));
    page.on("requestfinished", done);
    page.on("requestfailed", done);
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
    // The reloaded page's own registration (lib/pwa/registerServiceWorker.ts, after `load`) asks for /sw.js again; a
    // different script URL than the registration's makes the browser install it, and skipWaiting + clientsClaim hand
    // it the page. Polled as one line, so a failure shows which step did not happen.
    //
    // skipWaiting does not activate the new worker while the old one is still serving: Chromium waits until the
    // active worker has no fetch event in flight (a StaleWhileRevalidate route keeps its event open until the
    // revalidation ends), up to its 5-minute lame-duck limit. CI run 43264092263 failed with exactly that:
    // "controller=/sw.js?deploy=next:activated … waiting=/sw.js:installed", the page's own /sw.js registered and
    // installed, held waiting. So the take-over is measured from the moment the page's requests have settled; a
    // request that never settles fails with its URL in the message.
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
    const swState = () =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const w = (x?: ServiceWorker | null) => (x ? `${new URL(x.scriptURL).pathname}${new URL(x.scriptURL).search}:${x.state}` : "none");
        const calls = (window as unknown as { __rcSwCalls?: string[] }).__rcSwCalls ?? [];
        return `controller=${w(navigator.serviceWorker.controller)} active=${w(reg?.active)} waiting=${w(reg?.waiting)} installing=${w(reg?.installing)} register=[${calls.join("; ")}]`;
      }).then((line) => (/^controller=\/sw\.js:activated /.test(line) ? line : `${line} in-flight=[${[...inFlight].join(", ")}]`));
    await expect
      .poll(swState, { timeout: 30_000, message: "the reloaded page's own /sw.js controls it" })
      .toMatch(/^controller=\/sw\.js:activated /);
    expect(new URL(await controllerScript()).pathname).toBe("/sw.js");
    expect(documentsFromWorker).toEqual([]);
  });

  // regression: CI run 43246907343 (webkit-iphone, bot-resume-starved-frames): a font fetch the worker could not
  // complete surfaced as page errors ("no-response: no-response :: [{url: …woff2}]"). Workbox's CacheFirst throws
  // `no-response` when the network fails and nothing is cached, and the rejected respondWith reached the page as an
  // uncaught error. Without a worker the same failure is an ordinary network error (the element's `error` event, a
  // rejected FontFace.load()), so with one it must be too: the routes answer a 504 (next.config.js
  // NETWORK_ERROR_ON_FAILURE; Response.error() still logs page errors on WebKit).
  // The connection is dropped by a proxy in front of the app (offline emulation fails a request before the worker
  // sees it), so the worker's own fetch is what fails.
  test("a static file the network cannot deliver fails like a network error, never a page error @public", async ({
    browser,
  }, testInfo) => {
    const proxy = await startSlowDocumentProxy({ target: WEB_PORT, match: () => false });
    const use = testInfo.project.use;
    const context = await browser.newContext({
      baseURL: proxy.url,
      viewport: use.viewport ?? null,
      userAgent: use.userAgent,
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
    });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      // The first visit goes through Clerk's development handshake, which returns to the app's own origin (the proxy
      // presents it as the Host); the second, with the dev-browser cookie set, stays on the proxy.
      await page.goto("/about", { waitUntil: "domcontentloaded" });
      await page.goto(`${proxy.url}/about`, { waitUntil: "domcontentloaded" });
      expect(new URL(page.url()).origin).toBe(proxy.url);
      // Controlled from the start of a load: wait for the page's own registration to be active, then reload (a first
      // visit is only controlled once clientsClaim reaches it, which a busy WebKit run did not do within 30 s).
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.reload({ waitUntil: "domcontentloaded" });
      await activeAndControlling(page);
      proxy.reset((p) => p.includes("rc-unreachable-"));
      const outcome = await page.evaluate(async () => {
        const tag = Date.now().toString(36);
        const script = await new Promise<string>((resolve) => {
          const el = document.createElement("script");
          el.src = `/_next/static/chunks/rc-unreachable-${tag}.js`;
          el.onload = () => resolve("load");
          el.onerror = () => resolve("error");
          document.head.appendChild(el);
        });
        const css = await new Promise<string>((resolve) => {
          const el = document.createElement("link");
          el.rel = "stylesheet";
          el.href = `/_next/static/css/rc-unreachable-${tag}.css`;
          el.onload = () => resolve("load");
          el.onerror = () => resolve("error");
          document.head.appendChild(el);
        });
        const font = await new FontFace("rc-unreachable", `url(/_next/static/media/rc-unreachable-${tag}.woff2)`)
          .load()
          .then(
            () => "loaded",
            () => "rejected",
          );
        return { script, css, font };
      });
      // Each one went to the worker's CacheFirst route, its fetch lost the connection, and the page saw a network error.
      expect(outcome).toEqual({ script: "error", css: "error", font: "rejected" });
      expect(proxy.resets().length, "the worker's fetches reached the network and were dropped").toBeGreaterThanOrEqual(3);
      await page.waitForTimeout(1_000);
      // Only errors about these requests or the worker's answer count: WebKit also reports unrelated noise (Clerk's
      // bot-protection probes cut by the reload) as page errors, which the console guard excuses elsewhere.
      const ours = pageErrors.filter((m) => /rc-unreachable|no-response|service worker|Cannot load \.$/i.test(m));
      expect(ours, "page errors from failed static fetches").toEqual([]);
    } finally {
      await context.close();
      await proxy.close();
    }
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
        // The copy promises no cached page (none is, until Phase 11): "new pages need a connection" on desktop.
        await expect(page.locator('[data-testid^="shell-online-chip"]:visible')).not.toContainText(/cached/i);
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
