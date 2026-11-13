// A lazy chunk whose first load fails is loaded again and the page carries on with no error (lib/pwa/chunk-retry.ts).
// regression: webkit-chunk-abort-on-reload: WebKit aborts in-flight chunk loads when a page is reloaded, and the
// rejected `ChunkLoadError` used to be reported on the page being left (CI 43401675366 chunk 264, 43409659970 chunks
// 4654 / 7153); the same retry is what recovers a transient network or service-worker 504 failure.
// The production build loads the service-worker registration as a lazy chunk after `load`: its first request is
// aborted here, and the console guard (enforced) must stay clean while the retry fetches it again.
import { expect, test } from "../fixtures/console-guard";

const LAZY_CHUNK = /\/_next\/static\/chunks\/\d+\.[0-9a-f]+\.js$/;

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
});
