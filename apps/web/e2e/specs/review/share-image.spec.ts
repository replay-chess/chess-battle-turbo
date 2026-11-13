// The share image of a live link, signed out (phase-03 plan §5.5, §9.4): `/r/<code>/og` is the 1200×630 card PNG, and
// the public page's og:image points at it. @smoke without @local-only, so the post-deploy check runs it against the
// deployed dev site too: there the Vercel runtime's addCacheTag returned undefined and every live share's image was a
// 500 (regression: og-addcachetag-void), which `next start` in CI could not show. Member A's seeded live share
// (packages/db/seed/review.ts, GAME:live) is the link; an unknown code is the generic card.
import { expect, test } from "./_lib/review";

test.describe("share image", { tag: ["@p3", "@smoke"] }, () => {
  test("a live share's og image is the 1200×630 card; an unknown code is the generic card", async ({ playwright, baseURL, seeded }) => {
    const anon = await playwright.request.newContext({ baseURL });
    try {
      const page = await anon.get(`/r/${seeded.shares.live}`);
      expect(page.status()).toBe(200);
      const og = /<meta property="og:image" content="([^"]+)"/.exec(await page.text())?.[1];
      expect(og, "og:image on the public page").toBeTruthy();
      const ogUrl = new URL(og!.replace(/&amp;/g, "&"), baseURL);
      const ogPath = ogUrl.pathname + ogUrl.search;
      expect(ogPath).toMatch(new RegExp(`^/r/${seeded.shares.live}/og\\?v=\\d+`));

      for (const url of [ogPath, `/r/${seeded.shares.live}/og?v=1&download=1`]) {
        const res = await anon.get(url);
        expect(res.status(), url).toBe(200);
        expect(res.headers()["content-type"], url).toBe("image/png");
        const png = await res.body();
        expect(png.subarray(1, 4).toString("latin1"), url).toBe("PNG");
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], url).toEqual([1200, 630]);
      }

      const generic = await anon.get("/r/zzzzzzzz/og?v=1");
      expect(generic.status()).toBe(200);
      expect(generic.headers()["content-type"]).toBe("image/png");
    } finally {
      await anon.dispose();
    }
  });
});
