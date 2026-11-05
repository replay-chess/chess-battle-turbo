import type { Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect } from "../fixtures";

// Session expiry end to end (phase-01 plan §12.3, 1B·F8; T15): a real revoked Clerk session opens the
// "You’ve Been Signed Out" dialog, signing in again returns to the same URL, and other tabs follow.
//
// Only the session this test created is revoked (by id), so shared member A stays usable for parallel specs.
// The watcher is global (root layout, 1B·J), and since FIX-B it skips Clerk's route refresh when a session ends on
// its own on a non-public route, so the flow runs on a real member page: /play (D8). SESSION_SPEC_DEMO=1 runs it on
// the /dev/ui/data demo instead.

const WATCHED = process.env.SESSION_SPEC_DEMO === "1" ? "/dev/ui/data?tab=session" : "/play?tab=friends";
const DIALOG_NAME = "You’ve Been Signed Out";

async function gotoWatched(page: Page, path = WATCHED) {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBe(200);
  if (path.startsWith("/dev/ui/data")) await expect(page.getByTestId("data-demo-ready")).toBeAttached({ timeout: 60_000 });
}

async function revokeCurrentSession(page: Page): Promise<void> {
  // Clerk loads after hydration; wait for its session.
  const sessionId = await page
    .waitForFunction(() => (window as unknown as { Clerk?: { session?: { id?: string } } }).Clerk?.session?.id ?? null, null, {
      timeout: 30_000,
    })
    .then((h) => h.jsonValue())
    .catch(() => null);
  expect(sessionId, "the page has a Clerk session").toBeTruthy();
  const secret = process.env.CLERK_SECRET_KEY;
  expect(secret, "CLERK_SECRET_KEY (from .env.test)").toBeTruthy();
  // Clerk Backend API: POST /v1/sessions/{id}/revoke (the same call as clerkClient.sessions.revokeSession).
  const res = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(res.status, "revoke the session through the Clerk Backend API").toBe(200);
}

/** "Return to the tab": visibilitychange → visible, plus focus. */
async function returnToTab(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test.describe("session expiry @p1", () => {
  test("a revoked session shows the dialog, and signing in returns to the same URL @state:V3SessionExpired.modal @state:V3SessionExpired.signing_in", async ({
    authedPage: page,
  }) => {
    test.setTimeout(300_000);
    await gotoWatched(page);
    await revokeCurrentSession(page);
    await returnToTab(page);

    const dialog = page.getByRole("dialog", { name: DIALOG_NAME });
    // Clerk notices a revoked session on its next token refresh (≤ 60 s); ask for one so the test doesn't idle.
    await expect(dialog)
      .toBeVisible({ timeout: 5_000 })
      .catch(async () => {
        await page.evaluate(async () => {
          const c = (window as unknown as { Clerk?: { session?: { getToken: (o: object) => Promise<unknown> } } }).Clerk;
          await c?.session?.getToken({ skipCache: true }).catch(() => undefined);
        });
        await returnToTab(page);
        await expect(dialog).toBeVisible({ timeout: 90_000 });
      });
    await expect(dialog.getByText(`Returns to ${WATCHED}`)).toBeVisible();

    await Promise.all([
      page.waitForURL((u) => u.pathname.startsWith("/sign-in") && u.searchParams.get("redirect_url") === WATCHED, {
        waitUntil: "commit",
      }),
      dialog.getByRole("button", { name: "Sign In Again" }).click(),
    ]);

    // Sign in again (ticket strategy, as the auth fixture does), then Clerk's SignIn sends us back.
    await setupClerkTestingToken({ page });
    await clerk.signIn({ page, emailAddress: process.env.E2E_USER_A_EMAIL! });
    const target = new URL(WATCHED, page.url());
    const back = (u: URL) => u.pathname === target.pathname && u.search === target.search;
    await page.waitForURL(back, { timeout: 15_000 }).catch(async () => {
      // An already-signed-in visit to /sign-in redirects to redirect_url.
      await page.reload();
      await page.waitForURL(back, { timeout: 60_000 });
    });
    await expect(page.getByRole("dialog", { name: DIALOG_NAME })).toHaveCount(0);
  });

  test("a second tab receives the broadcast", async ({ authedPage: page }) => {
    await gotoWatched(page, "/dev/ui/data");
    const second = await page.context().newPage();
    await gotoWatched(second, "/dev/ui/data");

    await page.bringToFront();
    await page.getByRole("button", { name: "Simulate 401" }).click();
    await expect(page.getByRole("dialog", { name: DIALOG_NAME }), "hooks off? x-rc-fault: 401").toBeVisible({
      timeout: 20_000,
    });
    // The other tab is still signed in with Clerk; it opens the dialog from the rc-auth message alone.
    await expect(second.getByRole("dialog", { name: DIALOG_NAME })).toBeVisible({ timeout: 10_000 });
    await second.close();
  });
});
