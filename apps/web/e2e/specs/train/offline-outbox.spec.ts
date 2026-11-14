// Grading offline and the outbox (phase-05 plan §12.4 `offline-outbox.spec.ts`; owner test T8; §5.4). @p5
//
// Leased `outbox` (the three key moments of one game, NEW and due now) on desktop-1440:
//   offline   start a bank session → `context.setOffline(true)` → grade all 3 → no error UI and nothing reaches the
//             server → `setOffline(false)` → within 15 s the database holds exactly 3 attempts for the session; the
//             server's batches applied exactly 3 (a replayed batch would only add duplicates) and the runner sent
//             `train_offline_flush` and three `train_item_graded {offline: true}`.
//   resume    a fresh lease: grade item 1 online, wait until it is stored, reload the runner URL (`?s=`) online → the
//             runner resumes at item 2, not item 1; finishing grades items 2 and 3 once each.
// (The offline reload belongs to P11's per-user page cache.)
import type { Request } from "@playwright/test";
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
});
