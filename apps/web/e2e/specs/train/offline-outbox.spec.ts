// Grading offline and the outbox (phase-05 plan §12.4 `offline-outbox.spec.ts`; owner test T8; §5.4). @p5
//
// Leased `outbox` (the three key moments of one game, NEW and due now) on desktop-1440:
//   offline   start a bank session → `context.setOffline(true)` → grade all 3 → no error UI and nothing reaches the
//             server → `setOffline(false)` → within 15 s the database holds exactly 3 attempts for the session; the
//             server's batches applied exactly 3 (a replayed batch would only add duplicates) and the runner sent
//             `train_offline_flush` and three `train_item_graded {offline: true}`.
//   resume    a fresh lease: grade item 1 online, wait until it is stored, reload the runner URL (`?s=`) online → the
//             runner resumes at item 2, not item 1; finishing grades items 2 and 3 once each.
//   401 last  the session token "expires" before the last grade: the first POST carrying it answers 401 (the api()
//             envelope); the page stays visible (no visibility change, no reload, no summary) → the outbox resends it
//             once 2 s later, so within 10 s the database holds all 3 exactly once, and the signed-out dialog never shows.
// (The offline reload belongs to P11's per-user page cache.)
import type { Request, Route } from "@playwright/test";
import {
  DEVICES,
  expect,
  expectAttemptsApplied,
  forbidSolutions,
  gotoOk,
  grade,
  itemOf,
  itemsById,
  nextItem,
  poolUserEmail,
  sessionPayload,
  solveAndGradeAll,
  solveItem,
  stateTags,
  suggested,
  test,
  trainDb,
  viewerRef,
  waitForSession,
} from "./_lib/train";

test.describe.configure({ mode: "serial" });
// The personas live in UTC; a browser in another zone would PATCH the stored zone (the hub syncs it).
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("offline outbox · desktop-1440@100", { tag: ["@p5"] }, () => {
  test("T8: three positions graded offline are applied exactly once after reconnecting", { tag: stateTags("runner", "solve") }, async ({ persona, page, context, reviewDb, telemetry }, testInfo) => {
    test.setTimeout(420_000);
    await persona("outbox");
    const db = trainDb(reviewDb);
    const userId = await db.userId(poolUserEmail(testInfo));
    const ref = await viewerRef(page);
    const before = await db.attempts(userId);

    await gotoOk(page, "/train/bank/session");
    const sessionRef = await waitForSession(page);
    const payload = await sessionPayload(page.request, sessionRef);
    expect(payload.items).toHaveLength(3);
    forbidSolutions(telemetry, payload.items);
    await nextItem(page, null);

    const posts: string[] = [];
    page.on("request", (r: Request) => {
      if (new URL(r.url()).pathname === "/api/train/attempts" && r.method() === "POST") posts.push(r.url());
    });
    await context.setOffline(true);
    expect(await solveAndGradeAll(page, itemsById(payload), 3)).toBe(3);
    await expect(page.getByTestId("trainer-error")).toHaveCount(0);
    await expect(page.getByTestId("trainer-done").filter({ visible: true })).toBeVisible({ timeout: 30_000 });
    expect((await db.attempts(userId)).n, "nothing reached the server while offline").toBe(before.n);
    await telemetry.expect("train_item_graded", { offline: true }, { count: 3, source: "client" });

    await context.setOffline(false);
    await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 15_000, message: "applied within 15 s of reconnecting" }).toBe(3);
    await page.waitForTimeout(3_000);
    const after = await db.attempts(userId);
    expect(after.n - before.n, "exactly once").toBe(3);
    expect(after.n).toBe(after.distinct);
    expect(posts.length, "the outbox sent after reconnecting").toBeGreaterThan(0);
    await expectAttemptsApplied(telemetry, ref, 3);
    await telemetry.expect("train_offline_flush", {}, { source: "client" });
  });

  test("an online reload mid-session resumes at the next position", { tag: stateTags("runner", "solve") }, async ({ persona, page, reviewDb }, testInfo) => {
    test.setTimeout(420_000);
    await persona("outbox");
    const db = trainDb(reviewDb);
    await db.userId(poolUserEmail(testInfo));

    await gotoOk(page, "/train/bank/session");
    const sessionRef = await waitForSession(page);
    const items = itemsById(await sessionPayload(page.request, sessionRef));
    const first = await nextItem(page, null);
    await solveItem(page, itemOf(items, first));
    await grade(page, ((await suggested(page)) ?? "good") as "good");
    await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 30_000 }).toBe(1);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`[?&]s=${sessionRef}`));
    const resumed = await nextItem(page, null);
    expect(resumed, "the runner resumes after the graded position").not.toBe(first);
    expect(await solveAndGradeAll(page, items, 5)).toBe(2);
    await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 30_000 }).toBe(3);
  });

  test("a 401 on the session's last flush is resent once, without waiting for the next visit", { tag: stateTags("runner", "solve") }, async ({ persona, page, reviewDb }, testInfo) => {
    test.setTimeout(420_000);
    await persona("outbox");
    const db = trainDb(reviewDb);
    const userId = await db.userId(poolUserEmail(testInfo));
    const before = await db.attempts(userId);

    await gotoOk(page, "/train/bank/session");
    const sessionRef = await waitForSession(page);
    const payload = await sessionPayload(page.request, sessionRef);
    expect(payload.items).toHaveLength(3);
    const items = itemsById(payload);
    await nextItem(page, null);

    // The first two grades land as usual.
    expect(await solveAndGradeAll(page, items, 2)).toBe(2);
    await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 30_000 }).toBe(2);

    // The token expires before the last grade: the first POST after this point (it carries the last attempt) gets the
    // 401 envelope api() parses (packages/contracts/src/http/envelope.ts); later requests reach the server.
    let armed = true;
    const answered: number[] = [];
    await page.route("**/api/train/attempts", async (route: Route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      if (armed) {
        armed = false;
        answered.push(401);
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          headers: { "x-request-id": "e2e-outbox-401" },
          body: JSON.stringify({ error: { code: "unauthorized", message: "Sign in to continue.", requestId: "e2e-outbox-401" } }),
        });
      }
      answered.push(0);
      return route.fallback();
    });

    expect(await solveAndGradeAll(page, items, 5)).toBe(1);
    await expect(page.getByTestId("trainer-done").filter({ visible: true })).toBeVisible({ timeout: 30_000 });
    // No visibility change, reload or summary: only the outbox's own resend can deliver the last attempt.
    await expect
      .poll(() => db.attemptsOfSession(sessionRef), { timeout: 10_000, message: "the last attempt is resent after the 401" })
      .toBe(3);
    expect(answered[0], "the last attempt's first POST got the 401").toBe(401);
    expect(answered.length, "and was resent").toBeGreaterThan(1);
    await page.waitForTimeout(3_000);
    const after = await db.attempts(userId);
    expect(after.n - before.n, "every attempt exactly once").toBe(3);
    expect(after.n).toBe(after.distinct);
    await expect(page.getByRole("dialog", { name: "You’ve Been Signed Out" })).toHaveCount(0);
    await page.unroute("**/api/train/attempts");
  });
});
