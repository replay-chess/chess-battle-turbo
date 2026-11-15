// A lazy chunk whose first load fails is loaded again and the page carries on with no error (lib/pwa/chunk-retry.ts).
// regression: webkit-chunk-abort-on-reload: WebKit aborts in-flight chunk loads when a page is reloaded, and the
// rejected `ChunkLoadError` used to be reported on the page being left (CI 43401675366 chunk 264, 43409659970 chunks
// 4654 / 7153); the same retry is what recovers a transient network or service-worker 504 failure.
// The production build loads the service-worker registration as a lazy chunk after `load`: its first request is
// aborted here, and the console guard (enforced) must stay clean while the retry fetches it again.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/console-guard";

const LAZY_CHUNK = /\/_next\/static\/chunks\/\d+\.[0-9a-f]+\.js$/;
/** The `(app)` route group's layout chunk: one the first paint's RSC payload makes the App Router load at hydration. */
const ROUTE_CHUNK = /\/_next\/static\/chunks\/app\/\(app\)\/layout-[0-9a-f]+\.js$/;

test.describe("lazy chunk retry", { tag: ["@p1", "@smoke", "@local-only"] }, () => {
  test("the first load of a lazy chunk fails; it is fetched again and nothing is reported", async ({ page }) => {
    let aborted: string | null = null;
    const loaded: string[] = [];
    await page.route(LAZY_CHUNK, async (route) => {
      const url = route.request().url();
      if (aborted === null) {
        aborted = url;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    page.on("requestfinished", (r) => {
      if (LAZY_CHUNK.test(r.url())) loaded.push(r.url());
    });
    await page.goto("/legends", { waitUntil: "load" });
    await expect.poll(() => aborted, { timeout: 30_000, message: "a lazy chunk was requested" }).not.toBeNull();
    await expect.poll(() => loaded.includes(aborted!), { timeout: 30_000, message: "the aborted chunk loads on retry" }).toBe(true);
  });

  // regression: webkit-route-chunk-abort (CI 43637337703, webkit-iphone review-walkthrough ?m=2 reload: "ChunkLoadError:
  // Loading chunk 2563 failed. (error: …/app/(app)/layout-….js)"). The chunks the first paint's RSC payload names are
  // asked for by the App Router while it hydrates, before the root layout's providers module ran installChunkRetry(),
  // so a cut load of one of them was reported at once. The retry is installed from instrumentation-client.ts now,
  // before the App Router reads the payload. Here the cut comes while webpack is waiting on the load (it has attached to
  // the server-rendered <script async> of the chunk): the load is retried, the page hydrates and the guard stays clean.
  test("the first load of a route chunk fails while the App Router waits on it; it is fetched again and nothing is reported", async ({ page }) => {
    // Until webpack has attached its handlers to the chunk's server-rendered <script async> (the App Router asked).
    const run = await holdRouteChunk(page, (path) =>
      waitInPage(page, (p) => [...document.scripts].some((s) => s.src.endsWith(p) && typeof s.onerror === "function"), path),
    );
    await page.goto("/openings", { waitUntil: "load" });
    await run.expectRefetched();
  });

  // regression: webkit-route-chunk-dead-tag (CI 43653740138, webkit-iphone: the test above, then with a fixed 1.5 s hold,
  // saw no second request on both attempts). /openings is an 8 MB document whose RSC payload names the (app) layout
  // chunk 3.4 MB in; on the CI runner the cut came before the App Router got that far. webpack's script loader then
  // found the chunk's <script async> already in the document, attached to it and waited for an event that had already
  // fired: no error, no retry, no request, until its 120 s timeout. A failed server-rendered chunk script is now taken
  // out of the document (CHUNK_SCRIPT_GUARD, inline in the root layout's <head>), so the loader makes a new one. Here
  // main-app (the App Router) is held until the cut has happened, so the router always asks after it.
  test("the first load of a route chunk fails before the App Router asks for it; it is fetched again and nothing is reported", async ({ page }) => {
    let released: () => void = () => {};
    const cut = new Promise<void>((resolve) => (released = resolve));
    await page.route(MAIN_APP, async (route) => {
      await Promise.race([cut, new Promise((resolve) => setTimeout(resolve, 15_000))]);
      await route.continue();
    });
    const run = await holdRouteChunk(
      page,
      // The <head> has been parsed (the inline guard ran) and the router cannot have asked: main-app is held.
      () => waitInPage(page, () => document.readyState !== "loading", ""),
      () => released(),
    );
    await page.goto("/openings", { waitUntil: "load" });
    await run.expectRefetched();
  });
});

const MAIN_APP = /\/_next\/static\/chunks\/main-app-[0-9a-f]+\.js$/;

/** Polls `check(arg)` in the page every 50 ms, for at most 15 s. */
async function waitInPage(page: Page, check: (arg: string) => boolean, arg: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (await page.evaluate(check, arg).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Routes the (app) layout chunk: its first load waits for `before(path)`, is cut, then `after()` runs; any later load is
 * served. clerk-js mounts <div id="clerk-components"> into <body> as soon as it runs; it is held until the chunk is
 * served again (at most 10 s: without a retry the chunk never is, and the test must fail on that, not hang), so the
 * late hydration these tests force does not meet a <body> Clerk changed (a separate React #418).
 */
async function holdRouteChunk(page: Page, before: (path: string) => Promise<void>, after: () => void = () => {}) {
  let aborted: string | null = null;
  let reloaded = 0;
  let served: () => void = () => {};
  const chunkServed = new Promise<void>((resolve) => (served = resolve));
  await page.route(/\/npm\/@clerk\/clerk-js@[^/]+\/dist\/clerk[^/]*\.js(?:\?|$)/, async (route) => {
    await Promise.race([chunkServed, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await route.continue();
  });
  await page.route(ROUTE_CHUNK, async (route) => {
    if (aborted === null) {
      aborted = route.request().url();
      await before(new URL(aborted).pathname);
      await route.abort("failed");
      after();
      return;
    }
    reloaded += 1;
    await route.continue();
    served();
  });
  return {
    async expectRefetched() {
      await expect.poll(() => aborted, { timeout: 30_000, message: "the (app) layout chunk was requested" }).not.toBeNull();
      await expect.poll(() => reloaded, { timeout: 30_000, message: "the aborted route chunk is fetched again" }).toBeGreaterThan(0);
      // The enforced console guard (fixture teardown) fails the test on the "ChunkLoadError" a cut load used to log.
    },
  };
}
