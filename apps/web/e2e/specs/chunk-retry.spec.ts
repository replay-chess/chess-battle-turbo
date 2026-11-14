// A lazy chunk whose first load fails is loaded again and the page carries on with no error (lib/pwa/chunk-retry.ts).
// regression: webkit-chunk-abort-on-reload: WebKit aborts in-flight chunk loads when a page is reloaded, and the
// rejected `ChunkLoadError` used to be reported on the page being left (CI 43401675366 chunk 264, 43409659970 chunks
// 4654 / 7153); the same retry is what recovers a transient network or service-worker 504 failure.
// The production build loads the service-worker registration as a lazy chunk after `load`: its first request is
// aborted here, and the console guard (enforced) must stay clean while the retry fetches it again.
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
  // before the App Router reads the payload: the route chunk's first load is held, then cut while hydration waits on
  // it; it is fetched again, the page hydrates and the enforced guard stays clean.
  test("the first load of a route chunk at hydration fails; it is fetched again and nothing is reported", async ({ page }) => {
    let aborted: string | null = null;
    let reloaded = 0;
    let served: () => void = () => {};
    const chunkServed = new Promise<void>((resolve) => (served = resolve));
    // clerk-js mounts <div id="clerk-components"> into <body> as soon as it runs; held here until the route chunk is
    // served, so the late hydration this test forces does not meet a <body> Clerk changed (a separate React #418).
    await page.route(/\/npm\/@clerk\/clerk-js@[^/]+\/dist\/clerk[^/]*\.js(?:\?|$)/, async (route) => {
      // At most 10 s: without the retry the chunk is never served again, and the test must fail on that, not hang.
      await Promise.race([chunkServed, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      await route.continue();
    });
    await page.route(ROUTE_CHUNK, async (route) => {
      if (aborted === null) {
        aborted = route.request().url();
        // Cut while the App Router is waiting on it (as a reload mid-hydration cuts it), not before it asked.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.abort("failed");
        return;
      }
      reloaded += 1;
      await route.continue();
      served();
    });
    // /openings: an (app) page.
    await page.goto("/openings", { waitUntil: "load" });
    await expect.poll(() => aborted, { timeout: 30_000, message: "the (app) layout chunk was requested" }).not.toBeNull();
    await expect.poll(() => reloaded, { timeout: 30_000, message: "the aborted route chunk is fetched again" }).toBeGreaterThan(0);
    // The enforced console guard (fixture teardown) fails the test on the "ChunkLoadError" a cut load used to log.
  });
});

