// Train and Home behind the paywall (phase-05 plan §12.4 `paywall.spec.ts`; owner test T10; §11 "Members only"). @p5
//
// User R (never a member, never trialled; `nonMemberPage`, read-only) with the paywall on: every P5 page redirects to
// /pricing with the reason and the way back, and the P5 APIs answer 402 `subscription_required`.
import { DEVICES, expect, test } from "./_lib/train";

test.use(DEVICES["desktop-1440"]);

const PAGES = ["/home", "/train", "/train/bank", "/train/bank/session", "/train/puzzles"] as const;

test("T10: a non-member is sent to /pricing from every P5 page; the P5 APIs answer 402", { tag: ["@p5"] }, async ({ nonMemberPage: page }) => {
  test.setTimeout(300_000);
  for (const path of PAGES) {
    await test.step(path, async () => {
      // The redirect itself (a document request with the member's cookies), not the legacy /pricing page it lands on:
      // that page's marketing navbar has a known signed-in hydration mismatch (P0 page, console-baseline.json).
      const res = await page.request.get(path, { maxRedirects: 0, headers: { accept: "text/html" }, timeout: 180_000 });
      expect([303, 307, 308], `${path}: a redirect`).toContain(res.status());
      const url = new URL(res.headers()["location"] ?? "", "http://localhost");
      expect(url.pathname, `${path}: to the pricing page`).toBe("/pricing");
      expect(url.searchParams.get("reason"), `${path}: the reason`).toMatch(/^(trial_available|trial_used|expired|payment_failed|required)$/);
      expect(url.searchParams.get("redirect_url"), `${path}: the way back`).toBe(path);
    });
  }
  const calls: [string, string, unknown?][] = [
    ["GET", "/api/train/today"],
    ["GET", "/api/train/bank"],
    ["GET", "/api/home"],
    ["GET", "/api/me/badges"],
    ["POST", "/api/train/attempts", { attempts: [] }],
    ["POST", "/api/train/sessions", { kind: "bank" }],
  ];
  for (const [method, path, body] of calls) {
    const status = await page.evaluate(
      async ({ method, path, body }) => {
        const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
        const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        return `${res.status} ${json?.error?.code ?? ""}`;
      },
      { method, path, body },
    );
    expect(status, `${method} ${path}`).toBe("402 subscription_required");
  }
});
