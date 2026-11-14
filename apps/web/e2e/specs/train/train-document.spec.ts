// The trainer routes put the runner, and its interactive board, in the document's shell, never in a streamed Suspense
// segment (phase-05 plan §4.4, §4.5; the P2/P3 game and review documents, game-document.spec / review-document.spec).
//
// regression: train-streamed-board (Phase 5 pre-deploy review). /train/puzzles and /train/bank/session had a route
// loading.tsx (RunnerSkeleton), so the runner streamed as a hidden `<div id="S:n">` that React's `$RV` reveals on an
// animation frame; when an update during hydration (Clerk loading) makes React client-render that boundary first, the
// server's copy stays in the document, hidden: a second `trainer-board` with every test id (the bot-game duplicate
// after a reload on WebKit, CI 43211562326, 43226863882, 43438531034). Each runner document is read twice (a session
// created by the URL's spec, then its `?s=` resume): the board is in the shell once and no segment carries a test id.
// In the browser, after a reload the page holds exactly one board, and no hidden segment holds any test id.
// @local-only: /train/puzzles reads the CI shard server (playwright.config.ts starts it on 4012).
import type { Page } from "@playwright/test";
import { currentItem, expect, gotoOk, test, waitForSession } from "./_lib/train";

/** The document's HTML before the first streamed segment, and each segment's own HTML. */
async function documentParts(page: Page, path: string): Promise<{ status: number; shell: string; segments: { id: string; html: string }[] }> {
  const res = await page.request.get(path, { headers: { accept: "text/html" } });
  const html = await res.text();
  const marker = '<div hidden id="S:';
  const first = html.indexOf(marker);
  const segments = first < 0 ? [] : html.slice(first + marker.length).split(marker).map((part) => ({ id: `S:${part.slice(0, part.indexOf('"'))}`, html: part.split("<script")[0]! }));
  return { status: res.status(), shell: first < 0 ? html : html.slice(0, first), segments };
}

const BOARD = /data-testid="trainer-board"/g;

test.describe("trainer documents", { tag: ["@p5", "@smoke", "@local-only"] }, () => {
  // The personas live in UTC; a browser in another zone would PATCH the stored zone.
  test.use({ timezoneId: "UTC" });

  for (const route of ["/train/bank/session", "/train/puzzles"] as const) {
    test(`${route} renders the runner in the shell, with nothing streamed after it, and one board after a reload`, async ({ persona, page }) => {
      test.setTimeout(300_000);
      await persona("bank-member");

      const check = (label: string, doc: Awaited<ReturnType<typeof documentParts>>) => {
        expect(doc.status, label).toBe(200);
        const ids = [...new Set((doc.shell.match(/data-testid="[^"]+"/g) ?? []).map((m) => m.slice(13, -1)))];
        expect((doc.shell.match(BOARD) ?? []).length, `${label}: the trainer board is in the shell, once (shell test ids: ${ids.join(", ")})`).toBe(1);
        const streamed = doc.segments.filter((s) => s.html.includes("data-testid=")).map((s) => s.id);
        expect(streamed, `${label}: no part of the runner streams as a hidden segment`).toEqual([]);
      };
      // The document that creates (or resumes) the session from the URL's spec, then the `?s=` resume of the session.
      check(route, await documentParts(page, route));
      await gotoOk(page, route);
      const ref = await waitForSession(page);
      check(`${route}?s=${ref}`, await documentParts(page, `${route}?s=${ref}`));

      await currentItem(page);
      await page.reload();
      await currentItem(page);
      await expect(page.locator('[data-testid="trainer-board"]'), "one board after the reload").toHaveCount(1);
      expect(await page.locator('div[hidden][id^="S:"] [data-testid]').count(), "no hidden segment holds a test id").toBe(0);
    });
  }
});

// The hub and the bank list are in the document's shell too. regression: train-streamed-hub (CI 43620776665 follow-up):
// /train and /train/bank had a route loading.tsx (HubSkeleton, BankSkeleton), so the whole screen streamed as a hidden
// segment, as /home did (home.spec "home document"): a hidden second copy of the screen while a client-rendered
// boundary waits for the reveal, and a hydration that trails the server's HTML (the hub's clock and focus handling
// start late; day-rollover's 08:00 step faked its focus into that gap).
test.describe("train hub and bank documents", { tag: ["@p5", "@smoke", "@local-only"] }, () => {
  test.use({ timezoneId: "UTC" });

  for (const [route, root] of [
    ["/train", "train-hub"],
    ["/train/bank", "train-bank"],
  ] as const) {
    test(`${route} renders the screen in the shell, with nothing streamed after it, and one copy after a reload`, async ({ persona, page }) => {
      test.setTimeout(300_000);
      await persona("bank-member");
      const doc = await documentParts(page, route);
      expect(doc.status).toBe(200);
      const ids = [...new Set((doc.shell.match(/data-testid="[^"]+"/g) ?? []).map((m) => m.slice(13, -1)))];
      expect((doc.shell.match(new RegExp(`data-testid="${root}"`, "g")) ?? []).length, `${route}: the screen is in the shell, once (shell test ids: ${ids.join(", ")})`).toBe(1);
      // The real screen, not the route skeleton (which carries the same test id with data-state="loading").
      expect(doc.shell, `${route}: the shell holds the screen, not its skeleton`).not.toMatch(new RegExp(`data-testid="${root}"[^>]*data-state="loading"`));
      const streamed = doc.segments.filter((s) => s.html.includes("data-testid=")).map((s) => s.id);
      expect(streamed, `${route}: no part of the screen streams as a hidden segment`).toEqual([]);

      await gotoOk(page, route);
      await expect(page.getByTestId(root)).toBeVisible({ timeout: 120_000 });
      await page.reload();
      await expect(page.getByTestId(root)).toBeVisible({ timeout: 120_000 });
      await expect(page.locator(`[data-testid="${root}"]`), "one screen after the reload").toHaveCount(1);
      await expect(page.locator(`[data-testid="${root}"]`)).not.toHaveAttribute("data-state", "loading");
      expect(await page.locator('div[hidden][id^="S:"] [data-testid]').count(), "no hidden segment holds a test id").toBe(0);
    });
  }
});
