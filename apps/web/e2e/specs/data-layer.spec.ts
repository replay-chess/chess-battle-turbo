import type { Page, Request, Response } from "@playwright/test";
import { test, expect, ChessBoardHelper } from "../fixtures";

// Client data layer and the 401 / 429 / 500 system UI (phase-01 plan §12.3, 1B·F8; T12–T16).
//
// The fault steps need the server's test hooks: NEXT_PUBLIC_APP_ENV=dev|test and ALLOW_TEST_HOOKS=1 (plan §11.6).
// Without them `x-rc-fault` is ignored and those steps fail loudly ("hooks off"), which is the intended signal.
// Persona steps need the E2E pool users (E2E_POOL_01_EMAIL, scripts/dev/personas.ts) and skip until they exist.

const DATA = "/dev/ui/data";
const HEX8 = /^[0-9a-f]{8}$/;

/** goto with one retry: a shared `next dev` sometimes aborts a navigation during Fast Refresh. */
async function gotoOk(page: Page, url: string, waitUntil: "load" | "commit" = "load") {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil });
      expect(res?.status(), `${url} status`).toBe(200);
      return;
    } catch (error) {
      if (attempt > 0 || !/ERR_ABORTED|frame was detached|interrupted/i.test(String(error))) throw error;
    }
  }
}

async function gotoData(page: Page, query = "") {
  await gotoOk(page, `${DATA}${query}`);
  // Clicks before hydration are lost.
  await expect(page.getByTestId("data-demo-ready")).toBeAttached({ timeout: 60_000 });
}

const isApi = (path: string) => (r: Request | Response) => new URL(r.url()).pathname === path;

test.describe("data layer: request budget @p1 @smoke", () => {
  // (1) The viewer comes from one statement on the server: no client waterfall on a member page.
  test("a hard load of /play makes no legacy viewer calls", async ({ authedPage: page }) => {
    const seen: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith("/api/")) seen.push(p);
    });
    await page.goto("/play", { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const count = (pred: (p: string) => boolean) => seen.filter(pred).length;
    expect(count((p) => p === "/api/user/sync"), "/api/user/sync").toBe(0);
    expect(count((p) => p === "/api/subscription"), "/api/subscription").toBe(0);
    expect(count((p) => p.startsWith("/api/user/email/")), "/api/user/email/*").toBe(0);
    expect(count((p) => p === "/api/me"), "/api/me").toBeLessThanOrEqual(process.env.EXPECT_SEEDED_ME === "1" ? 0 : 1);
  });

  // (2) Outside the (app) layout the viewer is one client read.
  test("a hard load of a game page reads /api/me once", async ({ authedPage: page }) => {
    test.setTimeout(240_000);
    await page.goto("/play");
    await page.locator('[data-testid="start-game-button"]').click();
    await page.waitForURL(/\/game\//, { timeout: 60_000, waitUntil: "commit" });
    const gameUrl = page.url();

    let me = 0;
    page.on("request", (r) => {
      if (isApi("/api/me")(r)) me++;
    });
    await page.goto(gameUrl, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const meCalls = me;

    // Leave A without an open game, whatever the assertion says.
    const board = new ChessBoardHelper(page);
    await board.waitForBoard().catch(() => {});
    await board.waitForGameStarted().catch(() => {});
    await board.resign().catch(() => {});

    expect(meCalls, "/api/me requests on a hard load of /game/<ref>").toBe(1);
  });
});

test.describe("data layer: inline 429 @p1 @smoke @state:V3RateLimited.inline", () => {
  // (3) Fault-injected 429 on the openings index: countdown, aria-disabled, re-enable, then a real load.
  test("Load Openings (Force 429) counts down and recovers", async ({ page }) => {
    await page.clock.install();
    await gotoData(page);
    const button = page.getByRole("button", { name: "Load Openings (Force 429)" });

    const limited = page.waitForResponse((r) => isApi("/api/openings")(r) && r.url().includes("__rcfault="));
    await button.click();
    const res = await limited;
    expect(res.status(), "hooks off? x-rc-fault: 429 was not honoured").toBe(429);
    expect(res.headers()["retry-after"]).toBe("30");

    const timer = page.getByTestId("data-load-openings-countdown").getByRole("timer");
    await expect(timer).toHaveText(/^0:[23]\d$/);
    await expect(page.getByTestId("data-load-openings-countdown")).toHaveAttribute("role", "status");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toHaveAttribute("aria-describedby", /.+/);

    // A click while limited sends nothing (force: Playwright itself treats aria-disabled as disabled).
    let extra = 0;
    const onReq = (r: Request) => {
      if (isApi("/api/openings")(r)) extra++;
    };
    page.on("request", onReq);
    await button.click({ force: true });
    await page.waitForTimeout(300);
    page.off("request", onReq);
    expect(extra, "no request while the countdown runs").toBe(0);

    await page.clock.fastForward(31_000);
    await expect(page.getByTestId("data-load-openings-countdown")).toHaveCount(0); // inline_ready
    await expect(button).not.toHaveAttribute("aria-disabled", "true");

    const ok = page.waitForResponse((r) => isApi("/api/openings")(r) && !r.url().includes("__rcfault="));
    await button.click();
    expect((await ok).status()).toBe(200);
    const result = page.getByTestId("data-openings-result");
    await expect(result).toHaveText(/openings loaded/);
    expect(Number(await result.getAttribute("data-count"))).toBeGreaterThan(3000);
  });

  // (4) The real `health-deep` limiter (6 / 60 s per IP): within 7 clicks the server limits, and the inline
  // countdown shows the server's own Retry-After. Other runs from the same IP may have used part of the minute.
  test("Check Database hits the real limiter and shows its Retry-After @state:V3RateLimited.inline_ready", async ({
    page,
  }) => {
    await gotoData(page);
    const button = page.getByRole("button", { name: "Check Database" });
    let limitedRes: Response | null = null;
    for (let i = 0; i < 7 && !limitedRes; i++) {
      const next = page.waitForResponse((r) => isApi("/api/health")(r) && r.url().includes("deep=1"));
      await button.click();
      const r = await next;
      if (r.status() === 429) limitedRes = r;
      else {
        expect(r.status()).toBe(200);
        await expect(page.getByTestId("data-check-db-result")).toHaveText(new RegExp(`request ${i + 1}$`));
      }
    }
    expect(limitedRes, "the 7th Check Database within a minute is limited").not.toBeNull();
    const retryAfter = Number(limitedRes!.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(61);
    const body = (await limitedRes!.json()) as { error: { code: string; retryAfterSec: number; details?: { bucket?: string } } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retryAfterSec).toBe(retryAfter);

    const timer = page.getByTestId("data-check-db-countdown").getByRole("timer");
    await expect(timer).toBeVisible();
    const [m, s] = (await timer.innerText()).split(":").map(Number);
    const shown = m! * 60 + s!;
    expect(shown).toBeLessThanOrEqual(retryAfter);
    expect(shown).toBeGreaterThanOrEqual(retryAfter - 2);
    await expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("data layer: session and errors @p1 @smoke", () => {
  // (5) A 401 that a session reload does not fix: the blocking modal, then sign-in with the same return path.
  test("Simulate 401 opens the signed-out dialog @state:V3SessionExpired.modal @state:V3SessionExpired.signing_in", async ({
    authedPage: page,
  }) => {
    await gotoData(page);
    await page.getByRole("button", { name: "Simulate 401" }).click();

    const dialog = page.getByRole("dialog", { name: "You’ve Been Signed Out" });
    await expect(dialog, "hooks off? x-rc-fault: 401 was not honoured").toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText("Returns to /dev/ui/data")).toBeVisible();
    const signIn = dialog.getByRole("button", { name: "Sign In Again" });
    await expect(signIn).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5); // outside
    await expect(dialog).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/sign-in\?redirect_url=%2Fdev%2Fui%2Fdata(&|$)/, { waitUntil: "commit" }),
      signIn.click(),
    ]);
  });

  // (6) A failed action: one error toast whose event id is the first 8 hex of x-request-id.
  test("Force 500 raises an error toast with the event id", async ({ page }) => {
    await gotoData(page);
    const failed = page.waitForResponse((r) => isApi("/api/openings")(r) && r.url().includes("__rcfault="));
    await page.getByRole("button", { name: "Force 500" }).click();
    const res = await failed;
    expect(res.status(), "hooks off? x-rc-fault: 500 was not honoured").toBe(500);
    const requestId = res.headers()["x-request-id"] ?? "";
    const prefix = requestId.replace(/-/g, "").slice(0, 8);
    expect(prefix).toMatch(HEX8);

    const toast = page.getByTestId("toast-error");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(`Failed to load openings · Event ${prefix}`);
    await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});

test.describe("too-many-requests page @p1 @smoke @public @state:V3RateLimited.page", () => {
  // (7) The 429 page counts down from ?retry, then Try Again goes back to ?from. (8 s rather than the plan's 5 s:
  // on a busy `next dev` the load event can trail hydration by a few seconds.)
  test("counts down and returns to a safe from", async ({ page }) => {
    await gotoOk(page, "/too-many-requests?retry=8&from=/play", "commit");
    await expect(page.getByRole("heading", { level: 1, name: "Slow Down a Little" })).toBeVisible();
    await expect(page.getByText("429 · Too many requests")).toBeVisible();
    const status = page.getByTestId("too-many-requests-status");
    await expect(status).toHaveAttribute("role", "status");
    // The static fallback shows 0:30 until the client reads ?retry.
    await expect(status.getByRole("timer")).toHaveText(/^0:0[1-8]$/);
    const button = page.getByTestId("too-many-requests-retry");
    await expect(button).toHaveText(/^Try Again in 0:0[1-8]$/);
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Why This Happens" })).toHaveAttribute("href", "/help");

    await expect(button).toHaveText("Try Again", { timeout: 12_000 });
    await expect(button).not.toHaveAttribute("aria-disabled", "true");
    const nav = page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/play");
    await button.click();
    await nav;
  });

  // (8) An off-site `from` never leaves the app.
  test("an unsafe from goes home", async ({ page }) => {
    await gotoOk(page, "/too-many-requests?retry=0&from=https://evil.example");
    const button = page.getByTestId("too-many-requests-retry");
    await expect(button).toHaveText("Try Again");
    const nav = page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/");
    await button.click();
    const req = await nav;
    expect(new URL(req.url()).origin).toBe(new URL(page.url()).origin);
  });
});

test.describe("data layer: personas @p1", () => {
  test.describe.configure({ mode: "serial" });
  const poolReady = Boolean(process.env.E2E_POOL_01_EMAIL);

  // (9) A member whose card failed sees the payment banner on a real route.
  test("payment_banner persona sees the banner on /play @state:V3PaymentFailed.banner", async ({ page }, testInfo) => {
    test.skip(!poolReady, "E2E pool users are not provisioned (E2E_POOL_01_EMAIL)");
    const { leasePersona } = await import("../fixtures/lease");
    const { signIn } = await import("../fixtures/auth");
    const user = await leasePersona("payment_banner", testInfo);
    await signIn(page, user.email, "");
    await page.goto("/play");
    await expect(page.getByTestId("shell-payment-banner")).toBeVisible();
  });

  // (10) With the middleware member gate on, a lapsed member is sent to the "ended" pricing page.
  test("lapsed persona is redirected to /pricing?reason=ended", async ({ page }, testInfo) => {
    test.skip(!poolReady, "E2E pool users are not provisioned (E2E_POOL_01_EMAIL)");
    test.skip(process.env.MIDDLEWARE_MEMBER_GATE !== "on", "needs MIDDLEWARE_MEMBER_GATE=on on the server");
    const { leasePersona } = await import("../fixtures/lease");
    const { signIn } = await import("../fixtures/auth");
    const user = await leasePersona("lapsed", testInfo, 1);
    await signIn(page, user.email, "");
    await page.goto("/play");
    await expect(page).toHaveURL(/\/pricing\?reason=ended&redirect_url=%2Fplay$/);
  });
});
