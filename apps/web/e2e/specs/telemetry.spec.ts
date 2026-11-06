// Telemetry end to end (phase-01 plan §10.1, §12.3; CT X6; 1Q·2). @p1 @smoke @local-only
//
// Proves that the shell and system events reach the sinks with registry-shaped props and no typed text,
// and that the server's `webhook_processed` arrives once for a replayed delivery. The telemetry fixture
// parses every captured event against @repo/analytics and runs the PII guard after each test.
//
// Needs the local sinks, so it is @local-only:
// - client: a test build (`NEXT_PUBLIC_APP_ENV=test`, `NEXT_PUBLIC_TELEMETRY_SINK=1`) mirrors events into
//   `window.__rcTelemetry`;
// - server: posthog-node posts to e2e/mocks/posthog-sink.ts (`POSTHOG_HOST=http://127.0.0.1:4011` plus any
//   `POSTHOG_PROJECT_KEY`). playwright.config.ts sets all four on the web server it starts.
// The /dev/ui/data steps also need the fault hooks (`ALLOW_TEST_HOOKS=1`).
//
//   cd apps/web && set -a && source .env.test && set +a && PW_REUSE_SERVER=1 npx playwright test e2e/specs/telemetry.spec.ts
import { randomBytes } from "node:crypto";
import { mergeTests, type Locator, type Page } from "@playwright/test";
import { Webhook } from "standardwebhooks";
import type { PrismaClient } from "@repo/db";
import { test as authTest } from "../fixtures/auth";
import { expect, test as telemetryTest } from "../fixtures/telemetry";

const test = mergeTests(authTest, telemetryTest);

const SINK_HINT =
  "no client event in window.__rcTelemetry: is the web server a test build (NEXT_PUBLIC_APP_ENV=test, NEXT_PUBLIC_TELEMETRY_SINK=1)?";

/** goto with one retry: a shared `next dev` sometimes aborts a navigation during Fast Refresh. */
async function gotoOk(page: Page, url: string, timeout = 60_000) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      expect(res?.status(), `${url} status`).toBe(200);
      return;
    } catch (error) {
      if (attempt > 0 || !/ERR_ABORTED|frame was detached|interrupted/i.test(String(error))) throw error;
    }
  }
}

/**
 * Lets Clerk finish loading before a hard navigation. A `page.goto` that aborts Clerk's in-flight FAPI
 * requests and lazy chunks makes WebKit raise uncaught "… due to access control checks" and ChunkLoadError
 * rejections, which the console guard counts (CI's webkit-iphone smoke project).
 */
async function settleClerk(page: Page) {
  await page
    .waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, {
      timeout: 30_000,
    })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** Opens a layer, retrying while the page hydrates (the first key can land before React listens). */
async function openLayer(target: Locator, open: () => Promise<void>) {
  await expect(async () => {
    if (!(await target.isVisible())) await open();
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
}

test.describe("telemetry @p1 @smoke @local-only", () => {
  test("shell: palette and nav events, never the typed query", async ({ authedPage: page, telemetry }) => {
    await gotoOk(page, "/play");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });

    const palette = page.getByTestId("command-palette");
    await openLayer(palette, () => page.keyboard.press("ControlOrMeta+K"));
    await telemetry.expect("shell_palette_opened", { via: "shortcut" }, { source: "client" }).catch((e: Error) => {
      throw new Error(`${SINK_HINT}\n${e.message}`);
    });

    // Whatever is typed in the palette must never leave the page; only its length may.
    telemetry.forbid("morphy");
    await page.getByTestId("command-palette-input").fill("morphy");
    await page.waitForTimeout(500); // let a debounced search (and any event it would send) run
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    await settleClerk(page);
    // A nav click on Legends (shown while Learn is current): the sidebar on desktop, the SubNav in tab-bar
    // mode (CI's webkit-iphone project has no sidebar). /openings renders ~3,600 rows: a cold `next dev`
    // compile of it can take over a minute.
    await gotoOk(page, "/openings", 150_000);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
    const tabBarMode = await page.getByTestId("shell-tabbar").isVisible();
    const legends = tabBarMode
      ? page.getByTestId("subnav-item-legends")
      : page.getByTestId("shell-sidebar").getByTestId("nav-item-legends");
    await expect(legends).toBeVisible();
    await legends.click();
    await page.waitForURL(/\/legends$/);
    await telemetry.expect(
      "shell_nav_click",
      { dest: "legends", surface: tabBarMode ? "subnav" : "sidebar" },
      { source: "client" },
    );

    // No captured property holds the query (the fixture's PII check also scans every event after the test).
    const all = await telemetry.events("client");
    expect(JSON.stringify(all)).not.toContain("morphy");
  });

  test.describe("system events on /dev/ui/data", () => {
    async function gotoData(page: Page) {
      await gotoOk(page, "/dev/ui/data");
      await expect(page.getByTestId("data-demo-ready")).toBeAttached({ timeout: 60_000 });
    }

    test("Force 429 → rate_limited_shown (inline)", async ({ page, telemetry }) => {
      await gotoData(page);
      await page.getByRole("button", { name: "Load Openings (Force 429)" }).click();
      await expect(page.getByTestId("data-load-openings-countdown"), "hooks off? x-rc-fault: 429 was not honoured").toBeVisible({
        timeout: 20_000,
      });
      await telemetry.expect("rate_limited_shown", { surface: "inline" }, { source: "client", count: 1 });
    });

    test("Simulate 401 → session_expired_shown (api_401)", async ({ authedPage: page, telemetry }) => {
      await gotoData(page);
      await page.getByRole("button", { name: "Simulate 401" }).click();
      await expect(page.getByRole("dialog", { name: "You’ve Been Signed Out" }), "hooks off?").toBeVisible({ timeout: 20_000 });
      await telemetry.expect("session_expired_shown", { source: "api_401" }, { source: "client", count: 1 });
    });

    test("Force 500 → api_error_toast (500)", async ({ page, telemetry }) => {
      await gotoData(page);
      await page.getByRole("button", { name: "Force 500" }).click();
      await expect(page.getByTestId("toast-error"), "hooks off? x-rc-fault: 500 was not honoured").toBeVisible({ timeout: 20_000 });
      await telemetry.expect("api_error_toast", { status: 500 }, { source: "client", count: 1 });
    });
  });

  test.describe("server events", () => {
    const DODO_KEY = process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? "";
    const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    const eventId = `msg_e2etel_${run}`;
    // A type no handler knows: the delivery is recorded as ignored, touches no user, and the type is
    // unique to this run, so a parallel webhooks.spec run cannot add to the count.
    const type = `e2e.telemetry_${run}`;
    let db: PrismaClient | undefined;

    test.skip(!DODO_KEY, "DODO_PAYMENTS_WEBHOOK_KEY not in .env.test");

    test.afterAll(async () => {
      const { PrismaClient } = await import("@repo/db");
      db = new PrismaClient();
      await db.$executeRawUnsafe(`DELETE FROM webhook_events WHERE "eventId" = $1`, eventId);
      await db.$disconnect();
    });

    test("a replayed Dodo delivery → webhook_processed{duplicate} exactly once", async ({ request, telemetry }) => {
      const body = JSON.stringify({ business_id: "bus_e2e", type, timestamp: new Date().toISOString(), data: {} });
      const headers = () => {
        const at = new Date();
        return {
          "content-type": "application/json",
          "webhook-id": eventId,
          "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
          "webhook-signature": new Webhook(DODO_KEY).sign(eventId, at, body),
        };
      };
      const first = await request.post("/api/webhook/dodo-payments", { data: body, headers: headers() });
      expect(first.status(), await first.text()).toBe(200);
      const replay = await request.post("/api/webhook/dodo-payments", { data: body, headers: headers() });
      expect(replay.status()).toBe(200);
      expect(((await replay.json()) as { data?: { duplicate?: boolean } }).data?.duplicate).toBe(true);

      await telemetry.expect("webhook_processed", { type, outcome: "duplicate" }, { source: "server", count: 1, timeout: 15_000 });
      // The first delivery is reported too, with its own outcome.
      const firstEvent = await telemetry.expect("webhook_processed", { type, provider: "dodo" }, { source: "server", count: 2 });
      expect(firstEvent.map((e) => e.props.outcome).sort()).toEqual(["duplicate", "ignored"]);
      // Stays at one: wait out a late flush, then count again.
      await new Promise((r) => setTimeout(r, 1_500));
      const dupes = (await telemetry.events("server")).filter(
        (e) => e.event === "webhook_processed" && e.props.type === type && e.props.outcome === "duplicate",
      );
      expect(dupes).toHaveLength(1);
    });
  });
});
