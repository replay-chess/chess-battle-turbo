// Share analysis end to end (phase-03 plan §12.3 `review-share.spec.ts`; owner tests T8–T10). Member A shares the
// seeded archive-02 game (an analysed game against the member tal_fan_77):
//   A10 twice with one Idempotency-Key → one share, `share_link_created` (server) exactly once;
//   the share page `generating` → `ready` → Copy Link (clipboard) → a signed-out context opens /r/<code>: board and
//   badges, the member opponent masked as "Opponent", no Set-Cookie, X-Robots-Tag noindex;
//   untick Show My Username → the public page and the bumped image (?v=2, new bytes) show "A Replay Chess player";
//   Stop Sharing → the public page shows `gone` and the old image URL returns the generic card.
// The spec owns archive-02's shares: it revokes leftovers of an interrupted run first.
import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { dataOf, DEVICES, expect, gotoOk, noDocumentScroll, test } from "./_lib/review";

type ShareDTO = { code: string; url: string; imageUrl: string; showUsername: boolean };

async function signedOutPage(browser: Browser) {
  const context = await browser.newContext(DEVICES["desktop-1440"]);
  return { context, page: await context.newPage() };
}

async function png(request: { get(url: string): Promise<{ status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }> }, url: string) {
  const res = await request.get(url);
  expect(res.status(), url).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  return res.body();
}

test.describe("share analysis", { tag: ["@p3"] }, () => {
  test.describe.configure({ mode: "serial" });
  test.use(DEVICES["desktop-1440"]);

  test(
    "create (idempotent) → ready → Copy Link → public page → hide my username → Stop Sharing",
    { tag: ["@state:V3RvShare.generating", "@state:V3RvShare.ready"] },
    async ({ browser, context, member, page, reviewDb, seeded, telemetry }) => {
      test.setTimeout(300_000);
      const ref = seeded.archive(2);
      // A leftover live share of an interrupted run would be reused (no new share, no event): revoke it first.
      await reviewDb.$executeRaw`
        UPDATE shares SET "revokedAt" = now()
         WHERE "revokedAt" IS NULL AND "gameId" = (SELECT id FROM games WHERE "referenceId" = ${ref})`;
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await member("A");

      // A10 replayed with the same Idempotency-Key: one share, one server event.
      const key = randomUUID();
      const create = () =>
        page.request.post(`/api/review/${ref}/share`, {
          data: { showUsername: true, from: "review_menu" },
          headers: { "Idempotency-Key": key },
        });
      const first = await create();
      expect(first.status(), await first.text()).toBe(201);
      const replay = await create();
      expect(replay.status()).toBeLessThan(300);
      const a = await dataOf<ShareDTO>(first);
      expect((await dataOf<ShareDTO>(replay)).code).toBe(a.code);
      await telemetry.expect("share_link_created", { from: "review_menu", show_username: true }, { source: "server", count: 1 });

      // The share page reuses that link (same options): generating → ready.
      await gotoOk(page, `/review/${ref}/share`);
      const screen = page.getByTestId("share-screen");
      await expect(screen).toHaveAttribute("data-state", /generating|ready/);
      await expect(screen).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
      // regression: share-preview-board — the preview's board is a picture: no square buttons, no tab stops.
      const previewBoard = page.getByTestId("share-board");
      await expect(previewBoard).toHaveAttribute("role", "img");
      await expect(previewBoard.locator("button, [tabindex]")).toHaveCount(0);
      await telemetry.expect("share_opened", { from: "review_menu" }, { source: "client" });
      const shown = await page.getByTestId("share-link").inputValue();
      // The app's own origin (E2E_PORT_OFFSET moves it off :3000; regression: e2e-offset-origin).
      const origin = new URL(page.url()).origin;
      expect(shown).toBe(`${new URL(origin).host}/r/${a.code}`);
      await page.getByTestId("share-copy").click();
      await expect(page.getByTestId("share-copied")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/r/${a.code}`);
      await telemetry.expect("share_link_copied", { show_username: true }, { source: "client" });
      await noDocumentScroll(page);

      // Signed out: the frozen snapshot with the owner's name and the masked member opponent.
      const anon = await signedOutPage(browser);
      try {
        const res = await anon.page.goto(`/r/${a.code}`);
        expect(res?.status()).toBe(200);
        const headers = res!.headers();
        expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
        expect(headers["set-cookie"]).toBeUndefined();
        await expect(anon.page.getByTestId("share-page")).toHaveAttribute("data-state", "ok");
        await expect(anon.page.getByTestId("share-board")).toBeVisible();
        await expect(anon.page.locator('[data-testid="share-strip"] [data-q], [data-testid="share-badge"]').first()).toBeVisible();
        // The page is plain HTML with one inline island (FIX-2): no Next runtime, and the island steps the board.
        expect(await anon.page.locator('script[src*="/_next/"]').count(), "no framework script on /r").toBe(0);
        const stepper = anon.page.getByTestId("share-stepper");
        await expect(stepper).toHaveAttribute("data-ready", "");
        const opened = Number(await stepper.getAttribute("data-index"));
        await anon.page.getByTestId("share-prev").click();
        await expect(stepper).toHaveAttribute("data-index", String(opened - 1));
        await anon.page.keyboard.press("Home");
        await expect(stepper).toHaveAttribute("data-index", "0");
        await expect(anon.page.getByTestId("share-position")).toContainText("Start");
        const viewed = await anon.page.evaluate(
          () => ((window as unknown as { __rcTelemetry?: { event: string }[] }).__rcTelemetry ?? []).filter((e) => e.event === "share_page_viewed").length,
        );
        expect(viewed, "the island's share_page_viewed beacon").toBe(1);
        await expect(anon.page.getByTestId("share-body")).toContainText("Opponent");
        await expect(anon.page.getByTestId("share-body")).not.toContainText("tal_fan_77");
        await expect(anon.page.getByTestId("share-body")).not.toContainText("A Replay Chess player");
        const v1 = await png(anon.page.request, `/r/${a.code}/og?v=1`);

        // Hide my username: A11 PATCH, the image version is bumped and the public page re-renders masked.
        await page.getByTestId("share-show-username").click();
        await expect(page.getByTestId("share-preview-title")).toContainText("A Replay Chess player");
        await telemetry.expect("share_username_toggled", { show_username: false }, { source: "client" });
        await expect
          .poll(async () => (await anon.page.request.get(`/r/${a.code}`)).text(), { timeout: 60_000 })
          .toContain("A Replay Chess player");
        const v2 = await png(anon.page.request, `/r/${a.code}/og?v=2`);
        expect(v2.equals(v1), "the v2 image is re-rendered").toBe(false);

        // Stop Sharing: the page is gone at once (revalidateTag), the old image URL is the generic card.
        await page.getByTestId("share-stop").click();
        await expect(page.getByTestId("share-revoked")).toBeVisible();
        await telemetry.expect("share_revoked", {}, { source: "client" });
        await expect
          .poll(async () => {
            await anon.page.goto(`/r/${a.code}`);
            return anon.page.getByTestId("share-page").getAttribute("data-state");
          }, { timeout: 30_000 })
          .toBe("gone");
        await expect(anon.page.getByTestId("share-gone")).toContainText("This review link has expired or was turned off.");
        const generic = await png(anon.page.request, "/r/zzzzzzzz/og?v=1");
        expect((await png(anon.page.request, `/r/${a.code}/og?v=1`)).equals(generic), "the revoked image is the generic card").toBe(true);
      } finally {
        await anon.context.close();
      }
    },
  );
});
