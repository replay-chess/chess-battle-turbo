// Home (phase-05 plan §12.4 `home.spec.ts`; owner tests T1, T9; §4.1, §4.8). @p5
//
//   landing   a signed-in member who opens `/` lands on /home (middleware, claims only); the nav shows Home current
//             (six tabs on phones); the logo goes to /home; G then H goes to /home from another page; `home_viewed`
//             is sent once per mount.
//   populated leased `bank-member`: the Continue card (board + Start Review → /review/<ref>), the Mistake Bank card
//             (due thumbnails, Review N · About M min → the runner, never prefetched), This week, Recent games.
//   new_user  leased `home-new`: the Start here card (Play the Opera Game, Import My Chess.com Games), the empty bank
//             card (How It Works) and "Your games appear here after you play or import them."
//   import    leased `dev-trial` (P4's running Chess.com import): the `import_running` status row.
// No document scroll on any of them (lock mode; phones scroll inside the page's own region).
import type { Page } from "@playwright/test";
import type { Match, Telemetry } from "../fixtures/telemetry";
import { matchesProps } from "../fixtures/telemetry";
import { pendingViewerReads } from "../fixtures/auth";
import { DEVICES, expect, gotoOk, test, type DeviceName } from "./review/_lib/review";

// Not serial: each test signs in or leases on its own, so a red T1 (the Clerk dev `md` claim, owner action) never hides the
// T9 states (REGRESSION-5: in serial mode the six T9 runs were skipped behind T1 and V3Home had no real-data proof).
test.describe.configure({ mode: "default" });

const HOME_BOARDS = ["V3Home", "V3HomeNewUser", "V3HomeLoading"] as const;
const stateTags = (state: "populated" | "new_user" | "import_running") => HOME_BOARDS.map((b) => `@state:${b}.${state}`);

const isPhone = (d: DeviceName) => d === "iphone";

async function openHome(page: Page, state: "populated" | "new_user"): Promise<void> {
  await gotoOk(page, "/home");
  await expect(page.locator(`[data-testid="home"][data-state="${state}"]`)).toBeVisible({ timeout: 120_000 });
}

/**
 * `home_viewed` is sent once per mount of /home. The sign-in (member) and the persona lease (pool user) land on `/`,
 * which P5 sends a member to /home, so that earlier mount sent one too (with the previous state's props). Only the
 * mounts from `since` on are the test's (regression: home-viewed-per-mount: T1 and T9 counted 2 once the Clerk session
 * token carried the `md` claim). Exactly `count`, held for a second to catch a late duplicate.
 */
async function expectHomeViewed(telemetry: Telemetry, since: number, match: Match, count = 1): Promise<void> {
  const mine = async () => (await telemetry.events("client")).filter((e) => e.event === "home_viewed" && e.ts >= since && matchesProps(e.props, match)).length;
  await expect.poll(mine, { timeout: 15_000, message: `home_viewed ${JSON.stringify(match)} ×${count} since the test's own visit` }).toBe(count);
  await new Promise((r) => setTimeout(r, 1_000));
  expect(await mine(), `home_viewed ${JSON.stringify(match)} exactly ${count}×`).toBe(count);
}

async function noDocumentScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
  expect(overflow, "the document never scrolls (lock mode)").toBeLessThanOrEqual(0);
}

for (const device of ["desktop-1440", "iphone"] as const) {
  test.describe(`home · ${device}@100`, { tag: ["@p5"] }, () => {
    test.use(DEVICES[device]);

    test("T1: a signed-in member opening / lands on /home; logo and G H come back to it", { tag: ["@state:V3Nav.home"] }, async ({ member, page, telemetry }) => {
      test.setTimeout(240_000);
      await member("K");
      const since = Date.now();
      await gotoOk(page, "/");
      await expect(page).toHaveURL(/\/home$/, { timeout: 120_000 });
      await expect(page.getByTestId("home")).toBeVisible({ timeout: 120_000 });
      await noDocumentScroll(page);

      // The Home nav item (sidebar) or tab, by its own test id: the shell's logo is also a link to /home inside the nav
      // region (regression: home-t1-logo-match, CI 43599091643: `a[href="/home"]` matched the logo, which carries no
      // aria-current, once the session's claims made the landing /home).
      const home = page.locator('[data-testid="nav-item-home"]:visible, [data-testid="tab-item-home"]:visible').first();
      await expect(home).toHaveAttribute("aria-current", "page");
      if (isPhone(device)) {
        // Six tabs: Home, Play, Train, Learn, Review, Profile.
        await expect(page.locator("[data-rc-tabbar] a:visible")).toHaveCount(6);
        await expect(page.locator("[data-rc-tabbar]")).toContainText("Train");
      }
      await expectHomeViewed(telemetry, since, {});

      // The logo (sidebar on desktop, the top bar on phones) goes to /home.
      await gotoOk(page, "/play");
      await page.getByTestId("shell-brand").locator("visible=true").first().click();
      await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });

      if (!isPhone(device)) {
        // G then H (single-key chords need a fine pointer).
        await gotoOk(page, "/legends");
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        await page.keyboard.press("g");
        await page.keyboard.press("h");
        await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
      }
    });

    test("T9: populated (leased bank-member): Continue, the Mistake Bank card, This week, Recent games", { tag: stateTags("populated") }, async ({ persona, page, telemetry }) => {
      test.setTimeout(300_000);
      await persona("bank-member");
      const since = Date.now();
      const runnerPrefetch: string[] = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/train/bank/session") && (r.headers()["next-router-prefetch"] || r.headers()["purpose"] === "prefetch")) {
          runnerPrefetch.push(u.pathname + u.search);
        }
      });
      const homeApi: string[] = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/home") homeApi.push(r.url());
      });
      await openHome(page, "populated");
      await noDocumentScroll(page);
      expect(homeApi, "first paint is seeded: no GET /api/home").toHaveLength(0);

      const cont = page.getByTestId("home-continue");
      await expect(cont).toBeVisible();
      await expect(page.getByTestId("home-continue-board")).toBeVisible();
      await expect(page.getByTestId("home-continue-text")).toContainText(/You (won|lost) on move \d+|Drawn on move \d+/);

      const bank = page.getByTestId("home-bank");
      await expect(page.getByTestId("home-bank-due")).toHaveText(/^\d+ due$/);
      const cta = page.getByTestId("home-bank-cta");
      await expect(cta).toHaveAttribute("data-kind", /review|open/);
      if ((await cta.getAttribute("data-kind")) === "review") {
        await expect(cta).toHaveText(/^Review \d+ · About \d+ min$/);
        await expect(cta).toHaveAttribute("href", "/train/bank/session");
        const thumbs = bank.getByTestId("home-bank-thumb");
        expect(await thumbs.count()).toBeGreaterThan(0);
        await expect(thumbs.first()).toHaveAttribute("href", /^\/train\/bank\/session\?card=m_/);
      }
      await expect(page.getByTestId("home-week-dots")).toHaveAttribute("role", "img");
      await expect(page.getByTestId("home-recent-row").first()).toBeVisible();
      await expectHomeViewed(telemetry, since, { state: "populated", has_continue: true });

      // Session-creating links are never prefetched (plan §5.1); hovering them must not fetch the runner.
      await cta.hover();
      await page.waitForTimeout(500);
      expect(runnerPrefetch, "no prefetch of a session-creating URL").toEqual([]);

      // Start Review opens the review of that game.
      const start = page.getByTestId("home-start-review");
      const href = await start.getAttribute("href");
      expect(href).toMatch(/^\/review\/c[a-z0-9]+$/);
      await start.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 120_000 });
      await telemetry.expect("home_continue_clicked", { kind: "review" }, { source: "client" });
    });

    test("T9: new_user (leased home-new): Start here, the empty bank and the empty recent list", { tag: stateTags("new_user") }, async ({ persona, page, telemetry }) => {
      test.setTimeout(300_000);
      await persona("home-new");
      const since = Date.now();
      await openHome(page, "new_user");
      await noDocumentScroll(page);
      await expect(page.getByTestId("home-greeting")).toHaveText(/^Welcome, .+\.$/);
      await expect(page.getByTestId("home-start-here")).toBeVisible();
      await expect(page.getByTestId("home-start-legend")).toHaveText(/Play the Opera Game/);
      await expect(page.getByTestId("home-start-legend")).toHaveAttribute("href", /^\/position\//);
      await expect(page.getByTestId("home-bank-due")).toHaveText("0 due");
      await expect(page.getByTestId("home-bank-line")).toHaveText("Mistakes from your games land here as puzzles.");
      await expect(page.getByTestId("home-bank-cta")).toHaveText("How It Works");
      await expect(page.getByTestId("home-recent-empty")).toContainText("Your games appear here after you play or import them.");
      await expect(page.getByTestId("home-week-line")).toHaveText("No games yet");
      await expectHomeViewed(telemetry, since, { state: "new_user", due: 0, has_continue: false });
    });

    test("T9: import_running (leased dev-trial): the import status row", { tag: stateTags("import_running") }, async ({ persona, page, telemetry }) => {
      test.setTimeout(300_000);
      await persona("dev-trial");
      const since = Date.now();
      await gotoOk(page, "/home");
      const row = page.getByTestId("home-import");
      await expect(row).toBeVisible({ timeout: 120_000 });
      await expect(row).toHaveAttribute("role", "status");
      await expect(page.getByTestId("home-import-label")).toHaveText(/^Importing \d+( \/ \d+)? games?$/);
      await noDocumentScroll(page);
      await expectHomeViewed(telemetry, since, { state: "import_running" });
    });
  });
}

/** The document's HTML before the first streamed segment, and each segment's own HTML (review-document.spec). */
async function documentParts(page: Page, path: string): Promise<{ status: number; shell: string; segments: { id: string; html: string }[] }> {
  const res = await page.request.get(path, { headers: { accept: "text/html" } });
  const html = await res.text();
  const marker = '<div hidden id="S:';
  const first = html.indexOf(marker);
  const segments = first < 0 ? [] : html.slice(first + marker.length).split(marker).map((part) => ({ id: `S:${part.slice(0, part.indexOf('"'))}`, html: part.split("<script")[0]! }));
  return { status: res.status(), shell: first < 0 ? html : html.slice(0, first), segments };
}

// Home is part of the document's shell, never a streamed Suspense segment (the game, review and trainer documents:
// game-document, review-document, train-document specs).
//
// regression: home-streamed-duplicate (CI 43608761478, chromium home T9 import_running): /home had a route loading.tsx
// (HomeSkeleton), so the screen streamed as a hidden `<div id="S:n">` that React's `$RV` reveals on a later frame. An
// update during hydration (Clerk loading) makes React client-render that pending boundary instead; until the reveal
// runs, the document holds two copies of the screen, both hidden: `getByTestId('home-import')` resolved to two
// `role="status"` rows (one in app-shell, one in the segment) and failed strict mode. The leased `dev-trial` has the
// running import, so the document has the import row.
test.describe("home document", { tag: ["@p5", "@smoke"] }, () => {
  test("/home renders the screen in the shell, with nothing streamed after it, and one import row after a reload", { tag: stateTags("import_running") }, async ({ persona, page }) => {
    test.setTimeout(300_000);
    await persona("dev-trial");
    const doc = await documentParts(page, "/home");
    expect(doc.status).toBe(200);
    const ids = [...new Set((doc.shell.match(/data-testid="[^"]+"/g) ?? []).map((m) => m.slice(13, -1)))];
    expect((doc.shell.match(/data-testid="home"/g) ?? []).length, `the screen is in the shell, once (shell test ids: ${ids.join(", ")})`).toBe(1);
    expect((doc.shell.match(/data-testid="home-import"/g) ?? []).length, "one import row (role=status) in the shell").toBe(1);
    const streamed = doc.segments.filter((s) => s.html.includes("data-testid=")).map((s) => s.id);
    expect(streamed, "no part of the screen streams as a hidden segment").toEqual([]);

    // The page's own reads (the running import's events invalidate qk.home(); the badges; the viewer) must not be in
    // flight when the reload leaves the page: WebKit reports a cut one as an uncaught "…/api/home due to access control
    // checks." page error (regression: webkit-home-reload-cut; the WebKit-iPhone first-attempt failure of this test in CI).
    const homeReads = pendingViewerReads(page, { paths: ["/api/home", "/api/me/badges", "/api/me"] });
    await gotoOk(page, "/home");
    await expect(page.getByTestId("home-import")).toBeVisible({ timeout: 120_000 });
    await homeReads.settled();
    await page.reload();
    await expect(page.getByTestId("home-import")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('[data-testid="home-import"]'), "one import row after the reload").toHaveCount(1);
    expect(await page.locator('div[hidden][id^="S:"] [data-testid]').count(), "no hidden segment holds a test id").toBe(0);
  });
});
