// Connected accounts for a non-member (phase-04 plan §12.4 `accounts/non-member.spec.ts`; §4.10, §11.1, §11.4). @p4
//
// Persona `connected-nonmember` (onboarded, never trialled, nothing linked) links Chess.com in settings: the account
// is linked, "Importing starts when your trial begins.", no Sync now; `POST /api/accounts/chesscom/sync` → 402. The
// import run waits for membership. Project: desktop-1440. @local-only (the Chess.com account comes from the mock).
import { DEVICES, clickReady, expect, gotoOk, importRuns, noDocumentScroll, test, tid, uniqueHandle, waitHydrated } from "../onboarding/_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

test(
  "a non-member links Chess.com: waiting for the trial, no Sync now, sync → 402",
  { tag: ["@p4", "@local-only"] },
  async ({ page, leasePersona, p4db, telemetry }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(180_000);
    const me = await leasePersona("connected-nonmember");
    const handle = uniqueHandle("nonmem", testInfo);
    telemetry.forbid(handle);
    await gotoOk(page, "/settings/connected");
    const panel = page.locator('[data-testid="settings-connected"]:not([data-state="loading"])').first();
    await expect(panel).toHaveAttribute("data-state", "none_linked", { timeout: 60_000 });
    await waitHydrated(page, '[data-testid="account-chesscom-lookup"]');
    await tid(page, "account-chesscom-input").fill(handle);
    await clickReady(page, "account-chesscom-lookup");
    await expect(tid(page, "account-card-chesscom")).toBeVisible({ timeout: 60_000 });
    await expect(tid(page, "account-card-chesscom")).toContainText("Importing starts when your trial begins.");
    await expect(page.locator('[data-testid="account-sync-chesscom"]:visible')).toHaveCount(0);
    await noDocumentScroll(page);

    const res = await page.request.post("/api/accounts/chesscom/sync", { data: {} });
    expect(res.status()).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("subscription_required");
    const runs = await importRuns(p4db, me.email);
    expect(runs.map((r) => r.status)).toEqual(["WAITING_FOR_MEMBERSHIP"]);
  },
);
