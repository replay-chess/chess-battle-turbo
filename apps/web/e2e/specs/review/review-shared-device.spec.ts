// Shared device (phase-03 plan §12.3 `review-shared-device.spec.ts`, AP-04): member A opens a review (A1, the status
// probe, the annotated PGN download), signs out from the account menu; member B signs in in the same browser context
// and requests the same URLs: each comes from the network (no HTTP-cache or service-worker hit, read from the Chrome
// DevTools protocol) and answers 404 for B. The P1 spec (shared-device.spec.ts) covers /api/me and history.
import type { CDPSession, Page } from "@playwright/test";
import { signIn } from "../../fixtures/auth";
import { letterEmail } from "../../fixtures/users";
import { clickUntil, DEVICES, expect, gotoOk, openReview, test } from "./_lib/review";

type Seen = { url: string; status: number; fromDiskCache: boolean; fromServiceWorker: boolean; fromPrefetchCache: boolean };

async function watchNetwork(page: Page): Promise<{ cdp: CDPSession; seen: Seen[] }> {
  const cdp = await page.context().newCDPSession(page);
  const seen: Seen[] = [];
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceived", (e) => {
    const r = e.response as { url: string; status: number; fromDiskCache?: boolean; fromServiceWorker?: boolean; fromPrefetchCache?: boolean };
    seen.push({
      url: r.url,
      status: r.status,
      fromDiskCache: Boolean(r.fromDiskCache),
      fromServiceWorker: Boolean(r.fromServiceWorker),
      fromPrefetchCache: Boolean(r.fromPrefetchCache),
    });
  });
  // A memory-cache hit has no responseReceived with a flag: it fires requestServedFromCache for the request id.
  const urlOf = new Map<string, string>();
  cdp.on("Network.requestWillBeSent", (e) => urlOf.set(e.requestId, e.request.url));
  cdp.on("Network.requestServedFromCache", (e) =>
    seen.push({ url: urlOf.get(e.requestId) ?? e.requestId, status: 0, fromDiskCache: true, fromServiceWorker: false, fromPrefetchCache: false }),
  );
  return { cdp, seen };
}

test.describe("shared device", { tag: ["@p3"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test("A's review URLs never reach B from a cache, and answer 404 for B", async ({ browserName, member, page, seeded }) => {
    test.skip(browserName !== "chromium", "the cache provenance is read from the Chrome DevTools protocol");
    test.setTimeout(300_000);
    const ref = seeded.GAME;
    const urls = [`/api/review/${ref}`, `/api/review/${ref}/status`, `/api/review/${ref}/pgn`];

    await member("A");
    await openReview(page, ref);
    for (const u of urls) {
      const status = await page.evaluate((x) => fetch(x, { credentials: "same-origin" }).then((r) => r.status), u);
      expect(status, `A ${u}`).toBe(200);
    }

    // A signs out from the account menu (session/clear answers Clear-Site-Data first).
    await gotoOk(page, "/play");
    await clickUntil(page.getByTestId("shell-account-button"), () => expect(page.getByTestId("account-menu")).toBeVisible({ timeout: 2_000 }));
    await page.getByTestId("account-item-signout").click();
    // The signed-out landing page lands when its document does: "load" also waits for ~50 third-party directory
    // badge images (app/components/DirectoryBadges.tsx), and one slow badge host held it past 30 s
    // (regression: signout-landing-load).
    await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000, waitUntil: "domcontentloaded" });

    const { seen } = await watchNetwork(page);
    await signIn(page, letterEmail("B"), "");
    for (const u of urls) {
      const status = await page.evaluate((x) => fetch(x, { credentials: "same-origin" }).then((r) => r.status), u);
      expect(status, `B ${u}`).toBe(404);
    }
    // The page streams, so the not-found UI arrives with a 200 status line (review-privacy.spec.ts).
    await gotoOk(page, `/review/${ref}`);
    await expect(page.getByTestId("review-not-found")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("review-screen")).toHaveCount(0);

    const api = seen.filter((s) => urls.some((u) => s.url.endsWith(u)));
    const doc = seen.filter((s) => s.url.endsWith(`/review/${ref}`));
    expect(api.length, "B's API requests were observed").toBeGreaterThanOrEqual(urls.length);
    expect(doc.length, "B's document request was observed").toBeGreaterThanOrEqual(1);
    for (const s of [...api, ...doc]) {
      expect(s, `${s.url} came from the network`).toMatchObject({ fromDiskCache: false, fromServiceWorker: false, fromPrefetchCache: false });
    }
    for (const s of api) expect(s.status, s.url).toBe(404);
    const ours = [...api, ...doc];
    expect(ours.filter((s) => s.status === 0), "none of them was served from the memory cache").toEqual([]);
  });
});
