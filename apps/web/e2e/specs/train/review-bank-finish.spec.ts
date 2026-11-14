// The first "Add this position to my Mistake Bank" on a game side that was never extracted, then Finish Review while
// the switch is still on the wire (regression: first-add-finish-race; browser pass on staging 8bc24d3; phase-05 plan
// §7.3 A6, browser pass D1). @p5
//
// Leased `bank-member`; one of its oracle games is made a game analysed before P5 that the backfill has not reached (no
// occurrence, no mistake, no card, `bankVersion` 0). Its analysis has no MultiPV-2 scores (`second` empty, as P3's
// seed builders write it), the shape that made the on-demand extraction answer 500 (regression: a6-no-second). On the
// last key moment the member ticks the switch; A6 is held 4 s at the network (a slow first add), and Finish Review is
// pressed at once. Finish waits for the switch: the complete page counts the card ("1 added to your Mistake Bank"), the
// switch's own toast shows ("Added to Mistake Bank · next review …"), no error toast, and the bank holds the card.
import { Prisma } from "@repo/db";
import { DEVICES, expect, gotoOk, poolUserEmail, test, trainDb } from "./_lib/train";

test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC", serviceWorkers: "block" });

const control = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-testid="${id}"]:visible, [data-testid="bar-${id}"]:visible`).first();

test("first add held 4 s, then Finish Review at once: the complete page counts the card, one success toast, no error", { tag: ["@p5"] }, async ({
  persona,
  page,
  reviewDb,
}, testInfo) => {
  test.setTimeout(240_000);
  await persona("bank-member");
  const db = trainDb(reviewDb);
  const userId = await db.userId(poolUserEmail(testInfo));
  // The member's analysed game with no stored second-best scores and the fewest key mistakes.
  const [game] = await db.raw.$queryRaw<{ ref: string; gameId: bigint; moments: number }[]>(Prisma.sql`
    SELECT g."referenceId" AS ref, g.id AS "gameId", jsonb_array_length(pr.content->'moments')::int AS moments
      FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${userId}
      JOIN player_reviews pr ON pr."gameId" = g.id AND pr.color = gp.color
      JOIN game_analyses a ON a."gameId" = g.id
     WHERE cardinality(a.second) = 0 AND jsonb_array_length(pr.content->'moments') > 0
       AND EXISTS (SELECT 1 FROM mistake_occurrences mo WHERE mo."gameId" = g.id)
     ORDER BY 3, g.id LIMIT 1`);
  expect(game, "bank-member has an oracle game without second-best scores").toBeTruthy();
  const { ref, gameId } = game!;
  await db.raw.$executeRaw(Prisma.sql`DELETE FROM training_cards c USING mistake_occurrences mo WHERE mo."gameId" = ${gameId} AND c."mistakeId" = mo."mistakeId"`);
  await db.raw.$executeRaw(Prisma.sql`DELETE FROM mistake_occurrences WHERE "gameId" = ${gameId}`);
  await db.raw.$executeRaw(Prisma.sql`DELETE FROM mistakes m WHERE m."userId" = ${userId} AND NOT EXISTS (SELECT 1 FROM mistake_occurrences o WHERE o."mistakeId" = m.id)`);
  await db.raw.$executeRaw(Prisma.sql`UPDATE game_players SET "bankVersion" = 0 WHERE "gameId" = ${gameId} AND "userId" = ${userId}`);
  const gameCards = () =>
    db.raw.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM training_cards c JOIN mistake_occurrences mo ON mo."mistakeId" = c."mistakeId"
      WHERE c."userId" = ${userId} AND mo."gameId" = ${gameId}`).then((r) => Number(r[0]?.n ?? 0));
  expect(await gameCards()).toBe(0);

  await gotoOk(page, `/review/${ref}`);
  await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
  await expect(async () => {
    await control(page, "start-review").click({ timeout: 5_000 });
    await expect(page.getByTestId("moment-panel")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  // Walk to the last key moment, revealing each.
  for (;;) {
    const reveal = control(page, "reveal-answer");
    if (await reveal.count()) await reveal.click();
    if (await control(page, "finish-review").count()) break;
    await control(page, "next-moment").click();
  }
  const toggle = page.getByTestId("moment-bank-toggle").filter({ visible: true });
  await expect(toggle).not.toBeChecked({ timeout: 30_000 });

  // A slow first add: the A6 PATCH waits 4 s before it reaches the server.
  let a6Status = 0;
  await page.route(new RegExp(`/api/review/${ref}/moments/\\d+$`), async (route) => {
    await new Promise((r) => setTimeout(r, 4_000));
    const res = await route.fetch();
    a6Status = res.status();
    await route.fulfill({ response: res });
  });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await control(page, "finish-review").click();

  await page.waitForURL(new RegExp(`/review/${ref}/complete`), { timeout: 60_000 });
  expect(a6Status, "A6 answered before the complete page opened").toBe(200);
  await expect(page.getByTestId("complete-lead")).toContainText("· 1 added to your Mistake Bank.", { timeout: 30_000 });
  await expect(page.getByText(/^Added to Mistake Bank · next review /).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Couldn't update your Mistake Bank")).toHaveCount(0);
  await expect(page.getByText("Failed to save changes")).toHaveCount(0);
  expect(await gameCards(), "the bank holds the card").toBe(1);
});
