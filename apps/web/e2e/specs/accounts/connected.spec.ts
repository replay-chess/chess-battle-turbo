// Connected accounts (phase-04 plan §12.4 `accounts/connected.spec.ts`; §4.10, §7.3, §8.11, §8.12). @p4 @local-only
//
// Persona `connected-none-member` (an onboarded member, nothing linked), against the upstream mock:
//   none_linked → Look up `knightowl88xx` → not_found → a fixture handle → linked, syncing → "Sync finished · N new
//   games" → private_games (the 3 skipped fixture games) → Sync now twice → our own limit (rate_limited countdown) → the daily-import switch survives a reload →
//   Lichess denied (li_denied) → Lichess approved → both_linked + toast, the token revoked once → disconnect Lichess
//   keeping its games → disconnect Chess.com deleting them → the /games Chess.com tab empties.
// Persona `connected-syncfailed`: the sync_failed banner (Chess.com's last run failed upstream) next to the Lichess
//   back-off (rate_limited) → Try again → the run imports and the banner goes away.
// Projects: desktop-1440, iphone (`@smoke`), ipad-landscape.
import type { Page } from "@playwright/test";
import {
  DEVICES,
  FIXTURE_IMPORTABLE,
  clickReady,
  expect,
  gotoOk,
  importRuns,
  lichessConsent,
  noDocumentScroll,
  resetUserBucket,
  skipOtherEngines,
  test,
  tid,
  uniqueHandle,
  uniqueLichess,
  waitHydrated,
  type DeviceName,
  type Family,
} from "../onboarding/_lib/p04";

test.describe.configure({ mode: "serial" });

const panel = (page: Page) => page.locator('[data-testid="settings-connected"]:not([data-state="loading"])').first();
const toast = (page: Page, text: RegExp | string) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

async function openConnected(page: Page): Promise<void> {
  await gotoOk(page, "/settings/connected");
  await expect(panel(page)).toBeVisible({ timeout: 60_000 });
  await waitHydrated(page, '[data-testid="settings-connected"] button, [data-testid="settings-connected"] a');
}

const VARIANTS: { family: Family | "ipad-land"; device: DeviceName; smoke: boolean; tags: boolean }[] = [
  { family: "desktop", device: "desktop-1440", smoke: true, tags: true },
  { family: "iphone", device: "iphone", smoke: true, tags: false },
  { family: "ipad-land", device: "ipad-landscape", smoke: false, tags: false },
];

const S = (state: string) => [`@state:V4SettingsConnected.${state}`, `@state:V4SettingsConnectedError.${state}`];

for (const v of VARIANTS) {
  test.describe(`connected accounts · ${v.family}`, () => {
    test.use(DEVICES[v.device]);

    test(
      `link, sync, limits, switch, Lichess, disconnect with delete (${v.family})`,
      {
        tag: [
          "@p4",
          "@local-only",
          ...(v.smoke ? ["@smoke"] : []),
          ...(v.tags ? [...S("none_linked"), ...S("not_found"), ...S("syncing"), ...S("private_games"), ...S("rate_limited"), ...S("li_denied"), ...S("both_linked")] : []),
        ],
      },
      async ({ page, leasePersona, upstream, telemetry, p4db }, testInfo) => {
        const skip = skipOtherEngines(testInfo, v.family === "ipad-land" ? "ipad" : v.family);
        test.skip(skip !== null, skip ?? "");
        test.setTimeout(420_000);
        const me = await leasePersona("connected-none-member");
        const handle = uniqueHandle("conn", testInfo);
        const lichessName = uniqueLichess("Conn", testInfo);
        telemetry.forbid(handle);
        telemetry.forbid(lichessName);

        // The archive list and each month of this handle answer after 2 s, so the runs stay visibly `syncing` for a while.
        const slow = `/pub/player/${handle.toLowerCase()}/games/`;
        await upstream.delay("chesscom", 2_000, slow);
        await openConnected(page);
        await expect(panel(page)).toHaveAttribute("data-state", "none_linked");
        await noDocumentScroll(page);
        await telemetry.expect("settings_connected_viewed", { state: "none_linked" }, { source: "client" });

        // Not found, then a fixture account: linked and importing.
        await tid(page, "account-chesscom-input").fill(`knightowl88xx${testInfo.workerIndex}`);
        await clickReady(page, "account-chesscom-lookup");
        await expect(tid(page, "account-chesscom-error")).toBeVisible({ timeout: 30_000 });
        await expect(panel(page)).toHaveAttribute("data-state", "not_found");
        await tid(page, "account-chesscom-input").fill(handle);
        await clickReady(page, "account-chesscom-lookup");
        await expect(tid(page, "account-card-chesscom")).toBeVisible({ timeout: 60_000 });
        await expect(panel(page)).toHaveAttribute("data-state", "syncing");
        await expect(toast(page, new RegExp(`Sync finished · ${FIXTURE_IMPORTABLE} new games`))).toBeVisible({ timeout: 180_000 });
        // The fixture account has 3 games the import skips (a parse error, unrated, chess960): the finished run reports
        // them for 24 h, which is the `private_games` board.
        await expect(panel(page)).toHaveAttribute("data-state", "private_games", { timeout: 60_000 });
        await telemetry.expect("account_linked", { provider: "chesscom", context: "settings" }, { source: "server", distinctId: me.ref, count: 1 });
        expect((await importRuns(p4db, me.email)).find((r) => r.provider === "CHESSCOM" && r.trigger === "INITIAL")).toMatchObject({ status: "DONE", imported: FIXTURE_IMPORTABLE });

        // Sync now twice: the row flips to Syncing at once; the second press meets our own limit (1 / 30 s). The
        // "Sync finished" toast sits over the phone's card actions until it closes.
        await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
        // The first press starts a manual run, unless the provider back-off after the initial run still holds (then it is
        // already the countdown); either way the second press, within the 30 s window, meets a limit. The mock answers
        // at once from here on, so the manual run is over well inside that window.
        await upstream.clearDelays("chesscom", slow);
        await clickReady(page, "account-sync-chesscom");
        await expect
          .poll(
            async () =>
              (await importRuns(p4db, me.email)).some((r) => r.trigger === "MANUAL") ||
              (await page.locator('[data-testid="account-countdown-chesscom"]:visible').count()) > 0,
            { timeout: 30_000 },
          )
          .toBe(true);
        // A manual run ends with its own "Sync finished" toast over the phone's card actions: let it come and go first.
        if ((await importRuns(p4db, me.email)).some((r) => r.trigger === "MANUAL")) {
          await expect
            .poll(async () => (await importRuns(p4db, me.email)).find((r) => r.trigger === "MANUAL")?.status, { timeout: 30_000 })
            .toBe("DONE");
          await expect(toast(page, /Sync finished/)).toBeVisible({ timeout: 15_000 });
          await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
        }
        await expect(tid(page, "account-sync-chesscom")).toBeVisible({ timeout: 60_000 });
        const second = page.waitForResponse((r) => r.url().endsWith("/api/accounts/chesscom/sync") && r.request().method() === "POST", { timeout: 15_000 });
        await tid(page, "account-sync-chesscom").click();
        const limited = await second;
        expect(limited.status(), `the second Sync now: ${await limited.text()}`).toBe(429);
        await expect(tid(page, "account-countdown-chesscom")).toBeVisible({ timeout: 30_000 });
        await expect(panel(page)).toHaveAttribute("data-state", "rate_limited");
        await expect(tid(page, "account-countdown-chesscom")).toContainText(/0:\d\d/);
        await telemetry.expect("account_sync_rate_limited", { provider: "chesscom" }, { source: "client" });

        // The daily-import switch persists.
        const sw = tid(page, "account-autoimport-chesscom");
        const was = await sw.getAttribute("aria-checked");
        await sw.click();
        await expect(sw).toHaveAttribute("aria-checked", was === "true" ? "false" : "true");
        await expect(tid(page, "settings-connected-saved")).toBeVisible();
        await page.reload();
        await expect(panel(page)).toBeVisible({ timeout: 60_000 });
        await expect(tid(page, "account-autoimport-chesscom")).toHaveAttribute("aria-checked", was === "true" ? "false" : "true");

        // Lichess: denied, then approved.
        await waitHydrated(page, '[data-testid="account-lichess-connect"]');
        await clickReady(page, "account-lichess-connect");
        await lichessConsent(page, { approve: false, username: lichessName });
        await expect(page).toHaveURL(/\/settings\/connected/, { timeout: 60_000 });
        await expect(panel(page)).toHaveAttribute("data-state", "li_denied");
        await clickReady(page, "account-lichess-connect");
        await lichessConsent(page, { approve: true, username: lichessName });
        await expect(page).toHaveURL(/\/settings\/connected/, { timeout: 60_000 });
        await expect(tid(page, "account-card-lichess")).toBeVisible({ timeout: 30_000 });
        await expect(toast(page, /Lichess linked/)).toBeVisible({ timeout: 30_000 });
        await expect(panel(page)).toHaveAttribute("data-state", /both_linked|syncing|private_games|rate_limited/);
        // Both linked; the board shows the highest-priority view of the two (the Chess.com skips may outrank it).
        await expect(panel(page)).toHaveAttribute("data-state", /both_linked|private_games/, { timeout: 120_000 });
        expect(await upstream.revokesFor(lichessName), "the callback revoked its token once").toBe(1);

        // Disconnect Lichess, keeping its games (the delete box stays unticked; "Keep it" would cancel).
        await clickReady(page, "account-disconnect-open-lichess");
        await expect(tid(page, "account-disconnect-lichess")).toBeVisible();
        await clickReady(page, "account-disconnect-confirm-lichess");
        await expect(toast(page, /Lichess disconnected/)).toBeVisible({ timeout: 30_000 });

        // Disconnect Chess.com and delete its games: the purge empties the /games Chess.com tab. The steps above spent
        // this minute's 5 link-bucket requests (ACC-3/ACC-6/OAU-1 share one bucket); a member is not this quick, so the
        // spec starts a new window instead of waiting a minute.
        await resetUserBucket(p4db, "link", me.clerkUserId);
        await clickReady(page, "account-disconnect-open-chesscom");
        await clickReady(page, "account-disconnect-delete-chesscom");
        const unlinked = page.waitForResponse((r) => r.url().includes("/api/accounts/chesscom") && r.request().method() === "DELETE");
        await clickReady(page, "account-disconnect-confirm-chesscom");
        const unlinkRes = await unlinked;
        expect(unlinkRes.status(), `DELETE /api/accounts/chesscom: ${await unlinkRes.text()}`).toBeLessThan(300);
        await expect(toast(page, /Chess\.com disconnected\. Imported games are being removed\./).or(tid(page, "account-disconnect-error-chesscom"))).toBeVisible({ timeout: 30_000 });
        await expect(tid(page, "account-disconnect-error-chesscom"), "the disconnect went through").toHaveCount(0);
        await expect
          .poll(
            async () =>
              (
                await p4db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM game_players gp JOIN users u ON u.id = gp."userId"
                   WHERE u.email = ${me.email} AND gp.source = 'CHESSCOM'`
              )[0]!.n,
            { timeout: 30_000, intervals: [1_000] },
          )
          .toBe(0);
        await gotoOk(page, "/games?source=chesscom");
        await expect(page.locator('[data-testid="games-row"]:visible')).toHaveCount(0);
        await telemetry.expect("account_unlinked", { provider: "chesscom", has_delete_games: true }, { source: "server", distinctId: me.ref });
      },
    );
  });
}

test(
  "sync failed: the banner, Try again, the import recovers (desktop)",
  { tag: ["@p4", "@local-only", ...S("sync_failed")] },
  async ({ page, leasePersona }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(240_000);
    await leasePersona("connected-syncfailed");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page);
    await expect(panel(page)).toHaveAttribute("data-state", "sync_failed");
    await expect(tid(page, "account-banner-chesscom")).toContainText("Chess.com didn’t respond");
    await noDocumentScroll(page);
    await clickReady(page, "account-retry-chesscom");
    await expect(panel(page)).not.toHaveAttribute("data-state", "sync_failed", { timeout: 180_000 });
    await expect(page.locator('[data-testid="account-banner-chesscom"]:visible')).toHaveCount(0);
  },
);
