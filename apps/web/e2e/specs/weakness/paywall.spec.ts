// The paywall (phase-06 plan §12.4 `paywall.spec.ts`, §11; §1.2 T11, T13). User R, a non-member who never had a trial
// (read-only: nothing is written), with BILLING_PAYWALL=on (TE X3): /train/weakness sends them to pricing with the way
// back; TR-5, TR-12 and TR-13 answer 402 `subscription_required` with the reason. Signed out, /weakness redirects to the
// page and then to sign-in. @p6
import { expect, test } from "./_lib/weakness";

test.describe("weakness paywall", { tag: ["@p6"] }, () => {
  test("a non-member: pricing, and 402 from every weakness route @smoke", async ({ page, member }) => {
    test.setTimeout(300_000);
    await member("R");
    await page.goto("/train/weakness", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/pricing\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("reason")).toBe("required");
    expect(url.searchParams.get("redirect_url")).toBe("/train/weakness");
    expect(url.search).toContain("redirect_url=%2Ftrain%2Fweakness");
    for (const [method, path, data] of [
      ["GET", "/api/train/weakness", undefined],
      ["POST", "/api/train/weakness/recompute", {}],
      ["POST", "/api/train/weakness/seen", { version: 1 }],
    ] as const) {
      const res = method === "GET" ? await page.request.get(path) : await page.request.post(path, { data });
      expect(res.status(), `${method} ${path}`).toBe(402);
      const body = (await res.json()) as { error: { code: string; details?: { reason?: string } } };
      expect(body.error.code).toBe("subscription_required");
      expect(body.error.details?.reason).toBe("trial_available");
    }
  });

  test("signed out: /weakness → /train/weakness → sign-in @public", async ({ request }) => {
    const first = await request.get("/weakness", { maxRedirects: 0 });
    expect(first.status()).toBe(307);
    expect(first.headers()["location"]).toMatch(/\/train\/weakness$/);
    const second = await request.get("/train/weakness", { maxRedirects: 0 });
    expect([302, 307]).toContain(second.status());
    expect(second.headers()["location"]).toMatch(/\/sign-in\?redirect_url=/);
  });
});
