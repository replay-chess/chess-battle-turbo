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
      await gotoOk(page, "/");
      await expect(page).toHaveURL(/\/home$/, { timeout: 120_000 });
      await expect(page.getByTestId("home")).toBeVisible({ timeout: 120_000 });
      await noDocumentScroll(page);

      const home = page.locator('[data-rc-nav] a[href="/home"]:visible, [data-rc-tabbar] a[href="/home"]:visible').first();
      await expect(home).toHaveAttribute("aria-current", "page");
      if (isPhone(device)) {
        // Six tabs: Home, Play, Train, Learn, Review, Profile.
        await expect(page.locator("[data-rc-tabbar] a:visible")).toHaveCount(6);
        await expect(page.locator("[data-rc-tabbar]")).toContainText("Train");
      }
      await telemetry.expect("home_viewed", {}, { count: 1, source: "client" });

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
      await telemetry.expect("home_viewed", { state: "populated", has_continue: true }, { count: 1, source: "client" });

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
      await telemetry.expect("home_viewed", { state: "new_user", due: 0, has_continue: false }, { count: 1, source: "client" });
    });

    test("T9: import_running (leased dev-trial): the import status row", { tag: stateTags("import_running") }, async ({ persona, page, telemetry }) => {
      test.setTimeout(300_000);
      await persona("dev-trial");
      await gotoOk(page, "/home");
      const row = page.getByTestId("home-import");
      await expect(row).toBeVisible({ timeout: 120_000 });
      await expect(row).toHaveAttribute("role", "status");
      await expect(page.getByTestId("home-import-label")).toHaveText(/^Importing \d+( \/ \d+)? games?$/);
      await noDocumentScroll(page);
      await telemetry.expect("home_viewed", { state: "import_running" }, { count: 1, source: "client" });
    });
  });
}
