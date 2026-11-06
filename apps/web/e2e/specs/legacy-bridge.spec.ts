import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

// The legacy client bridge (phase-01 plan §3.2, §5.2, 1B·F4d acceptance; AC #4 / #5):
// - UserSync fills the legacy store from one GET /api/me; nothing calls /api/user/sync, /api/subscription or the
//   removed /api/user/email/* on a hard load.
// - A failing GET /api/me never sends a member to /pricing or /sign-in.
// - A Phase 0 persisted store (version 0, with a `subscription`) migrates to version 2 and its stale
//   `entitled: false` no longer bounces a member.
// - A non-member is still sent to /pricing?reason=required (a successful negative answer).

const STORE_KEY = "chess-user-store";

type Persisted = { state: { user: Record<string, unknown> | null } & Record<string, unknown>; version: number };

/** The signed-in user's persisted store entry, once UserSync has written it. */
async function persistedUser(page: Page): Promise<Record<string, unknown>> {
  await page.waitForFunction((key) => {
    try {
      return Boolean(JSON.parse(localStorage.getItem(key) ?? "null")?.state?.user?.clerkUserId);
    } catch {
      return false;
    }
  }, STORE_KEY);
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORE_KEY);
  return (JSON.parse(raw!) as Persisted).state.user!;
}

/** Writes `snapshot` into localStorage once, before the next document's scripts run. */
async function seedStoreOnce(page: Page, snapshot: unknown) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("f4d-seeded")) return;
      sessionStorage.setItem("f4d-seeded", "1");
      localStorage.setItem(key, value);
    },
    [STORE_KEY, JSON.stringify(snapshot)] as const,
  );
}

/** Answers every GET /api/me with a 500 envelope; returns a counter. */
async function failMe(page: Page) {
  const hits = { count: 0 };
  await page.route(
    (url) => url.pathname === "/api/me",
    async (route) => {
      hits.count++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal", message: "forced by legacy-bridge.spec" } }),
      });
    },
  );
  return hits;
}

/** Stays on `path` for `ms`: no navigation to /pricing or /sign-in. */
async function expectStays(page: Page, path: string, ms = 8_000) {
  const left: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) left.push(new URL(frame.url()).pathname);
  });
  await page.waitForTimeout(ms);
  expect(left.filter((p) => p !== path), `navigations away from ${path}`).toEqual([]);
  expect(new URL(page.url()).pathname).toBe(path);
}

test.describe("legacy bridge: viewer reads @p1", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a forced 500 on /api/me never redirects a member (cold store)", async ({ authedPage: page }) => {
    const hits = await failMe(page);
    await page.evaluate((key) => localStorage.removeItem(key), STORE_KEY);
    await page.goto("/play", { waitUntil: "load" });
    await expectStays(page, "/play");
    // (app) pages are seeded with qk.me() by their layout (1B·J): no client read, so nothing to fail.
    expect(hits.count, "(app) pages make no client /api/me read").toBe(0);
  });

  // regression: REGRESSION-2 — this used the game page as the "outside (app)" page; P2 moved /game/[ref] into
  // (app), whose layout seeds the viewer, so UserSync never asked. /help is outside (app) and signed-in aware.
  test("a forced 500 on /api/me never redirects a member outside (app) (cold store, /help)", async ({
    authedPage: page,
  }) => {
    // Outside the (app) layout UserSync reads the viewer on a hard load.
    await page.goto("/play", { waitUntil: "load" });
    const hits = await failMe(page);
    await page.evaluate((key) => localStorage.removeItem(key), STORE_KEY);
    await page.goto("/help", { waitUntil: "load" });
    await expectStays(page, "/help");
    expect(hits.count, "UserSync asked for the viewer").toBeGreaterThan(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("a forced 500 on /api/me never redirects a member (Phase 0 snapshot saying entitled:false)", async ({
    authedPage: page,
  }) => {
    const user = await persistedUser(page);
    await seedStoreOnce(page, {
      state: { user, subscription: { plan: null, entitled: false }, lastSyncedAt: Date.now() },
      version: 0,
    });
    await failMe(page);
    await page.goto("/play", { waitUntil: "load" });
    await expectStays(page, "/play");
  });

  test("a Phase 0 snapshot migrates to version 2 and the member plays", async ({ authedPage: page }) => {
    const user = await persistedUser(page);
    await seedStoreOnce(page, {
      state: { user, subscription: { plan: null, entitled: false }, lastSyncedAt: 1 },
      version: 0,
    });
    const legacy: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p === "/api/user/sync" || p === "/api/subscription" || p.startsWith("/api/user/email/")) legacy.push(p);
    });
    await page.goto("/play", { waitUntil: "load" });
    await expect(page.getByTestId("start-game-button")).toBeVisible({ timeout: 60_000 });
    expect(new URL(page.url()).pathname).toBe("/play");

    const stored = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), STORE_KEY))!) as Persisted;
    expect(stored.version).toBe(2);
    expect(Object.keys(stored.state).sort()).toEqual(["lastSyncedAt", "user"]);
    expect(stored.state.user?.referenceId).toBe(user.referenceId);
    expect(legacy, "legacy viewer calls").toEqual([]);
  });

  test("the removed email route is a 404 for its owner too", async ({ authedPage: page }) => {
    const user = await persistedUser(page);
    const status = await page.evaluate(
      async (email) => (await fetch(`/api/user/email/${encodeURIComponent(email)}`)).status,
      String(user.email),
    );
    expect(status).toBe(404);
  });
});

test.describe("legacy bridge: paywall gate @p1", () => {
  test("a non-member is sent to /pricing?reason=required with the return path", async ({ nonMemberPage: page }) => {
    await page.goto("/play", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/pricing\?reason=(required|ended)&redirect_url=%2Fplay/, { timeout: 60_000 });
  });
});
