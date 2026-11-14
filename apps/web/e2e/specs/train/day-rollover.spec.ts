// The training day, the 08:00 release and the streak, end to end with server time (phase-05 plan §12.4
// `day-rollover.spec.ts`; testing X5; §8.4, §8.9, §5.2 S2 "Day rollover"). @p5 @local-only
//
// Leased `day-rollover` (America/New_York, 2 NEW cards due at the next local 08:00 release, trained yesterday, streak 1),
// reset AT the test's own instant (`resetPersona(…, { now })`), and every same-origin request of the page carrying that
// instant as `x-rc-now` (`serverClock`). The browser clock is left alone (Clerk checks its tokens against it); attempts
// it stamps are clamped by the server to `now + 5 min`, so the spec grades at 03:50, not 03:59.
//
//   EDT leg, Saturday 2026-10-31 (UTC−4):
//     03:50  the hub's day is Friday (the day starts at 04:00); an explicit pick graded now counts for 2026-10-30: the
//            streak becomes 2 (Thu + Fri), no row for the 31st yet.
//     04:01  /train builds Saturday's plan (a new training_days row), nothing due.
//     07:59  still nothing due.
//     07:59:50 → 08:00  the hub's release timer fires in the background; on focus the released card appears (the
//            hub refetches), /api/me/badges says 1 due with the dot; grading it
//            makes the streak 3, and a second grade the same day leaves it at 3 (+1 exactly once).
//   DST leg, Sunday 2026-11-01 (EDT → EST at 02:00):
//     01:30  twice (05:30Z EDT, then 06:30Z EST): both are Saturday's training day.
//            The persona's release is 08:00 EST = 13:00Z (not 12:00Z).
//     03:59 EST Saturday · 04:01 EST Sunday's plan · 07:59 nothing due · 08:00 the 2 released cards.
import type { Page } from "@playwright/test";
import {
  DEVICES,
  expect,
  gotoOk,
  grade,
  itemOf,
  itemsById,
  nextItem,
  poolUserEmail,
  serverClock,
  sessionPayload,
  solveItem,
  stateTags,
  test,
  trainDb,
  waitForSession,
  type TrainDb,
} from "./_lib/train";
import { pendingViewerReads } from "../../fixtures/auth";
import { poolSlot } from "../../fixtures/users";

test.describe.configure({ mode: "serial" });
// The spec routes requests: a service worker would take them past page.route (docs/decisions.md, the P1 SW rule).
test.use({ ...DEVICES["desktop-1440"], timezoneId: "America/New_York", serviceWorkers: "block" });

const Z = (iso: string) => new Date(iso);

/**
 * The hub's reads (today's plan, the badges, the viewer). regression: webkit-train-today-cut (CI, once: "…/api/train/
 * today due to access control checks." on WebKit). The 08:00 step fakes a tab switch by pinning
 * `document.visibilityState` with Object.defineProperty, and the pin ended at "visible": when the spec then left the
 * page, the browser's own `visibilitychange` (to hidden) read "visible", so the query client took it for a return to
 * the tab and refetched today's plan at the very moment the document was being left, and the navigation cut it
 * (Chromium: net::ERR_ABORTED on every run; WebKit reports the cut load as an error on the page being left). A real
 * hidden tab reads "hidden" and refetches nothing; on a real navigation the old document shows nothing anyway. The step
 * now removes its pin (the native getter again) and waits for the reads it caused (fixtures/auth.ts
 * pendingViewerReads; no service-worker wait: this spec blocks service workers), and the tests assert that no hub read
 * was cut.
 */
const HUB_READS = ["/api/train/today", "/api/me/badges", "/api/me"] as const;

/** Hub reads that failed (a navigation cut them: Chromium reports net::ERR_ABORTED, WebKit "cancelled"). */
function cutHubReads(page: Page): string[] {
  const cut: string[] = [];
  page.on("requestfailed", (r) => {
    const path = new URL(r.url()).pathname;
    if ((HUB_READS as readonly string[]).includes(path)) cut.push(`${r.method()} ${path}: ${r.failure()?.errorText ?? "failed"}`);
  });
  return cut;
}

async function hubAt(page: Page, clock: { set(at: Date): void }, at: Date, state: "default" | "nothingdue"): Promise<void> {
  clock.set(at);
  await gotoOk(page, "/train");
  await expect(page.locator(`[data-testid="train-hub"][data-state="${state}"]`)).toBeVisible({ timeout: 120_000 });
}

/** GET through the page (so the route adds `x-rc-now`); `page.request` would bypass it. */
async function getJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => ((await (await fetch(p, { headers: { accept: "application/json" } })).json()) as { data: T }).data, path);
}

async function gradeOne(page: Page, db: TrainDb, url: string): Promise<string> {
  await gotoOk(page, url);
  const ref = await waitForSession(page);
  const items = itemsById(await sessionPayload(page.request, ref));
  const id = await nextItem(page, null);
  await solveItem(page, itemOf(items, id));
  await grade(page, "good");
  await expect.poll(() => db.attemptsOfSession(ref), { timeout: 30_000 }).toBe(1);
  return ref;
}

/** The `day-rollover` lease at a given instant (leasePersona resets at the wall clock). */
async function leaseAt(parallelIndex: number, now: Date): Promise<void> {
  const { resetPersona } = await import("../../../scripts/dev/personas");
  await resetPersona(String(poolSlot(parallelIndex, 0)), "day-rollover", { now, log: () => undefined });
}

test.describe("day rollover · America/New_York", { tag: ["@p5", "@local-only"] }, () => {
  test("EDT: 03:50 counts for yesterday, 04:01 a new plan, 08:00 the release on focus, the streak +1 once", { tag: [...stateTags("hub", "default", "nothingdue")] }, async ({ member, page, reviewDb, baseURL }, testInfo) => {
    test.setTimeout(600_000);
    const email = poolUserEmail(testInfo);
    await member(email);
    const t0 = Z("2026-10-31T07:50:00Z"); // 03:50 EDT
    await leaseAt(testInfo.parallelIndex, t0);
    const db = trainDb(reviewDb);
    const userId = await db.userId(email);
    expect((await db.profile(userId))?.dayStreak).toBe(1);
    const cards = await db.raw.$queryRaw<{ k: string; due: Date }[]>`SELECT "itemKey" AS k, due FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK' ORDER BY id`;
    expect(cards).toHaveLength(2);
    for (const c of cards) expect(c.due.toISOString(), "released at 08:00 EDT").toBe("2026-10-31T12:00:00.000Z");
    const clock = await serverClock(page, baseURL!);
    const cut = cutHubReads(page);

    // 03:50: Friday's day; an explicit pick counts for 2026-10-30.
    await hubAt(page, clock, t0, "nothingdue");
    await expect(page.getByTestId("train-header")).toContainText("Friday");
    await gradeOne(page, db, `/train/bank/session?card=${cards[0]!.k}`);
    const p1 = await db.profile(userId);
    expect(p1?.lastActiveDay).toBe("2026-10-30");
    expect(p1?.dayStreak, "Thursday + Friday").toBe(2);
    expect(await db.days(userId)).not.toContain("2026-10-31");

    // 04:01: Saturday's plan is built once.
    await hubAt(page, clock, Z("2026-10-31T08:01:00Z"), "nothingdue");
    await expect(page.getByTestId("train-header")).toContainText("Saturday");
    expect((await db.day(userId, "2026-10-31"))?.hasPlan, "a new plan row").toBe(true);

    // 07:59: nothing released yet.
    await hubAt(page, clock, Z("2026-10-31T11:59:00Z"), "nothingdue");
    await expect(page.getByTestId("train-due-thumb")).toHaveCount(0);
    expect(await getJson<{ bankDue: number; trainDot: boolean }>(page, "/api/me/badges")).toMatchObject({ bankDue: 0 });

    // 08:00: the release, picked up on focus. The hub's clock is the server's render time kept running by the device
    // (components/train/hub/when.ts), so a hub opened at 07:59:50 arms its release timer for 10 s later. The tab goes to
    // the background before that; the timer fires while it is hidden and only marks today's plan stale; the tab comes
    // back and the focus refetch brings the released card (a real visibilitychange bubbles from document to window,
    // where the query client's focus manager listens). Should the timer fire after the return instead, it refetches
    // itself; either way the read carries 08:00:30.
    // regression: day-rollover-focus-flake (CI 43620776665): the step used to rely on the browser's real date (days
    // after the server's) making the plan look stale; when the faked focus came before hydration it refetched nothing.
    await hubAt(page, clock, Z("2026-10-31T11:59:50Z"), "nothingdue");
    clock.set(Z("2026-10-31T12:00:30Z"));
    const focusReads = pendingViewerReads(page, { paths: HUB_READS, swRegistration: false });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await page.waitForTimeout(12_000); // the release timer's 10 s, in the background
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      // The native getter again (the pin is an own property of `document`): see HUB_READS.
      delete (document as { visibilityState?: unknown }).visibilityState;
    });
    await expect(page.getByTestId("train-due-thumb")).toHaveCount(1, { timeout: 60_000 });
    expect(await getJson<{ bankDue: number; trainDot: boolean }>(page, "/api/me/badges")).toEqual({ bankDue: 1, trainDot: true });
    await focusReads.settled();

    // Grading on Saturday: the streak +1, once.
    await gradeOne(page, db, `/train/bank/session?card=${cards[1]!.k}`);
    const p2 = await db.profile(userId);
    expect(p2?.lastActiveDay).toBe("2026-10-31");
    expect(p2?.dayStreak).toBe(3);
    clock.set(Z("2026-10-31T12:30:00Z"));
    await gradeOne(page, db, `/train/bank/session?card=${cards[0]!.k}`);
    expect((await db.profile(userId))?.dayStreak, "a second grade the same day").toBe(3);
    expect(cut, "no hub read was cut by the spec's own navigation").toEqual([]);
  });

  test("DST: 01:30 twice is Saturday, release at 08:00 EST, 04:01 EST a new plan, 08:00 the 2 cards", { tag: [...stateTags("hub", "default", "nothingdue")] }, async ({ member, page, reviewDb, baseURL }, testInfo) => {
    test.setTimeout(600_000);
    const email = poolUserEmail(testInfo);
    await member(email);
    await leaseAt(testInfo.parallelIndex, Z("2026-11-01T05:30:00Z"));
    const db = trainDb(reviewDb);
    const userId = await db.userId(email);
    const dues = await db.raw.$queryRaw<{ due: Date }[]>`SELECT due FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK'`;
    expect(dues.map((d) => d.due.toISOString())).toEqual(["2026-11-01T13:00:00.000Z", "2026-11-01T13:00:00.000Z"]);
    const clock = await serverClock(page, baseURL!);
    const cut = cutHubReads(page);

    for (const at of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-11-01T08:59:00Z"]) {
      await hubAt(page, clock, Z(at), "nothingdue");
      await expect(page.getByTestId("train-header"), `${at} is Saturday's training day`).toContainText("Saturday");
    }
    await hubAt(page, clock, Z("2026-11-01T09:01:00Z"), "nothingdue");
    await expect(page.getByTestId("train-header")).toContainText("Sunday");
    expect((await db.day(userId, "2026-11-01"))?.hasPlan).toBe(true);
    await hubAt(page, clock, Z("2026-11-01T12:59:00Z"), "nothingdue");
    await expect(page.getByTestId("train-due-thumb")).toHaveCount(0);
    await hubAt(page, clock, Z("2026-11-01T13:00:00Z"), "default");
    await expect(page.getByTestId("train-due-thumb")).toHaveCount(2);
    expect(await getJson<{ bankDue: number; trainDot: boolean }>(page, "/api/me/badges")).toEqual({ bankDue: 2, trainDot: true });
    expect(cut, "no hub read was cut by the spec's own navigation").toEqual([]);
  });
});
