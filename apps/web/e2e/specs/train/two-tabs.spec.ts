// The same card graded in two tabs (phase-05 plan §12.4 `two-tabs.spec.ts`; §5.4 steps 4–6, §7.3 W1 conflicts). @p5
//
// Leased `two-tabs` (exactly one due card) on desktop-1440: tab A and tab B open the drill (the same ACTIVE session);
// the card is graded in A, then in B, which still holds the card's old `cardReps`. The server applies one attempt and
// answers the other `conflict`: no error UI in either tab, the card moved once, one attempt row, the batches report
// ok 1 and conflicts 1, and the losing tab sent `train_attempt_conflict` once. Opening the drill again afterwards
// finds nothing due.
import {
  DEVICES,
  expect,
  expectAttemptsApplied,
  gotoOk,
  grade,
  itemOf,
  itemsById,
  nextItem,
  poolUserEmail,
  sessionPayload,
  solveItem,
  stateTags,
  test,
  trainDb,
  viewerRef,
  waitForSession,
} from "./_lib/train";

test.describe.configure({ mode: "serial" });
// The personas live in UTC; a browser in another zone would PATCH the stored zone (the hub syncs it).
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test("two tabs grade the same card: one ok, one silent conflict, the card moves once", { tag: ["@p5", ...stateTags("runner", "solve")] }, async ({ persona, page, context, reviewDb, telemetry }, testInfo) => {
  test.setTimeout(420_000);
  await persona("two-tabs");
  const db = trainDb(reviewDb);
  const userId = await db.userId(poolUserEmail(testInfo));
  const ref = await viewerRef(page);
  const before = await db.attempts(userId);
  expect(await db.dueBankCards(userId, new Date())).toBe(1);

  await gotoOk(page, "/train/bank/session");
  const sessionRef = await waitForSession(page);
  const items = itemsById(await sessionPayload(page.request, sessionRef));
  expect(items.size).toBe(1);

  const tabB = await context.newPage();
  await gotoOk(tabB, `/train/bank/session?s=${sessionRef}`);
  const idA = await nextItem(page, null);
  const idB = await nextItem(tabB, null);
  expect(idB).toBe(idA);

  await solveItem(page, itemOf(items, idA));
  await grade(page, "good");
  await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 30_000 }).toBe(1);

  await solveItem(tabB, itemOf(items, idB));
  await grade(tabB, "easy");
  await telemetry.expect("train_attempt_conflict", {}, { count: 1, source: "client", timeout: 30_000 });
  await expect(page.getByTestId("trainer-error")).toHaveCount(0);
  await expect(tabB.getByTestId("trainer-error")).toHaveCount(0);

  const after = await db.attempts(userId);
  expect(after.n - before.n, "one attempt row").toBe(1);
  const [card] = await db.raw.$queryRaw<{ reps: number }[]>`SELECT reps FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK' AND "itemKey" = ${itemOf(items, idA).cardRef}`;
  expect(card?.reps, "the card moved once").toBe(1);
  await expectAttemptsApplied(telemetry, ref, 1, { conflicts: 1 });

  await tabB.close();
  await gotoOk(page, "/train/bank/session");
  await expect(page.getByTestId("trainer-empty").or(page.getByTestId("trainer-done")).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 });
});
