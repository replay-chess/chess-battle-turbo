import type { Page, Response } from "@playwright/test";
import { test, expect, signIn } from "../fixtures";

// Shared computer (phase-01 plan §12.3, CA §5; T22): after member A signs out, member B in the same browser never
// sees A through the HTTP cache, the query cache, the service worker or history.
//
// Needs: `POST /api/session/clear` (1B·F1), `GET /api/me` (1B·F4a), and the account menu's Sign Out calling
// signOutEverywhere() (1B·J swaps `runSignOut` in components/shell/useAccountActions.ts). Later phases add their
// per-user URLs (review, PGN, invoice) to `PER_USER_URLS`.

const PER_USER_URLS = ["/api/me"];

type Me = { data: { user: { ref: string; name: string; email: string } } };

async function readMe(page: Page): Promise<{ me: Me; response: Response }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/me" && r.request().method() === "GET"),
    page.evaluate(() => fetch("/api/me", { credentials: "same-origin" }).then((r) => r.status)),
  ]);
  expect(response.status(), "/api/me").toBe(200);
  return { me: (await response.json()) as Me, response };
}

async function openAccountMenu(page: Page) {
  await page.getByTestId("shell-account-button").click();
  await expect(page.getByTestId("account-menu")).toBeVisible();
}

test.describe("shared device @p1", () => {
  test("signing out leaves nothing of A for B", async ({ page }) => {
    test.setTimeout(300_000);

    // A: load the per-user reads and a member page.
    await signIn(page, process.env.E2E_USER_A_EMAIL!, process.env.E2E_USER_A_PASSWORD!);
    await page.goto("/play");
    const { me: meA } = await readMe(page);
    const refA = meA.data.user.ref;
    const emailA = meA.data.user.email;
    for (const url of PER_USER_URLS.filter((u) => u !== "/api/me")) await page.evaluate((u) => fetch(u), url);

    // A signs out from the account menu: session/clear answers 204 + Clear-Site-Data before Clerk's sign-out.
    await openAccountMenu(page);
    const clear = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/session/clear" && r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByTestId("account-item-signout").click();
    const clearRes = await clear;
    expect(clearRes.status()).toBe(204);
    // allHeaders(): Playwright's headers() leaves out security-related headers such as Clear-Site-Data.
    const clearHeaders = await clearRes.allHeaders();
    expect(clearHeaders["clear-site-data"]).toBe('"cache"');
    expect(clearHeaders["cache-control"]).toContain("no-store");
    await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
    expect(await page.evaluate(() => sessionStorage.getItem("rc.signout"))).toBe("1");

    // B signs in in the same context.
    await signIn(page, process.env.E2E_USER_B_EMAIL!, process.env.E2E_USER_B_PASSWORD!);
    await page.goto("/play");
    const { me: meB, response } = await readMe(page);
    expect(response.fromServiceWorker(), "/api/me must come from the network").toBe(false);
    expect(meB.data.user.ref).not.toBe(refA);
    expect(meB.data.user.email).not.toBe(emailA);

    // Back never shows A's page: every history entry renders for B (or a signed-out page), never A's data.
    for (let i = 0; i < 4; i++) {
      const moved = await page.goBack({ waitUntil: "load" }).catch(() => null);
      if (!moved) break;
      const html = await page.content();
      expect(html, `history entry ${page.url()}`).not.toContain(emailA);
      expect(html, `history entry ${page.url()}`).not.toContain(refA);
    }
  });
});
