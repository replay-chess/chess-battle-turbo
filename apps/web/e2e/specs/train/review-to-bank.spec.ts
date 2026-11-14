// From a review to the Mistake Bank (phase-05 plan §12.4 `review-to-bank.spec.ts`; owner tests T2–T4; §4.8 review
// lights-up, §7.3 A6, §7.6 J1). @p5 @local-only
//
// Leased `bank-empty` (a pool user with no bank; a shared member would not do: a mistake is deduped per member by its
// position, so a second run's game would find the first run's (hidden) mistakes) adds one bot game: White (the member) hangs a bishop (4.Bf4), a knight
// (7.Nh3) and the queen (9.Qg4), Black takes each time, White resigns. The e2e worker (fake engine, 1-ply material)
// analyses it and J1 writes one bank card per key moment in the same batch. Then:
//   - the review: on moment 1 the bank switch is on; a switch-off answered 500 (an injected `x-rc-fault`) rolls back
//     with "Couldn't update your Mistake Bank"; off → "Removed from Mistake Bank", the ply is in
//     `player_reviews.progress.bankOptOut` and the card is gone; on → "Added to Mistake Bank · next review …", the ply
//     leaves `bankOptOut` and the card is back;
//   - Review complete: "3 moments reviewed · 3 added to your Mistake Bank. The first one comes back tomorrow." (today
//     before the 08:00 release), an "Added"
//     tag on each moment, Drill These 3 Mistakes → the runner with exactly this game's 3 positions.
// @local-only: the e2e worker with the fake engine.
import type { Page } from "@playwright/test";
import { Chess } from "chess.js";
import { completeBotGame, createBotGame } from "../review/_lib/games";
import { DEVICES, expect, gotoOk, poolUserEmail, sessionPayload, stateTags, test, trainDb, trainerBoard, waitForSession, type TrainDb } from "./_lib/train";

// The spec routes requests: a service worker would take them past page.route (docs/decisions.md, the P1 SW rule).
test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC", serviceWorkers: "block" });

/** 9 moves from the initial position, White blundering on plies 6, 12 and 16 (each piece taken at once). */
const BLUNDERS = ["e4", "e5", "Nf3", "Nc6", "d3", "d6", "Bf4", "exf4", "Ng1", "Nf6", "Nc3", "Be7", "Nh3", "Bxh3", "a3", "O-O", "Qg4", "Nxg4"] as const;

function blunderLine(): string[] {
  const c = new Chess();
  return BLUNDERS.map((san) => {
    const m = c.move(san);
    return `${m.from}${m.to}${m.promotion ?? ""}`;
  });
}

const control = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible, [data-testid="bar-${id}"]:visible`).first();

type GameCard = { itemKey: string; ply: number };

async function gameCards(db: TrainDb, userId: bigint, gameRef: string): Promise<GameCard[]> {
  return db.raw.$queryRaw<GameCard[]>`
    SELECT c."itemKey", mo.ply FROM training_cards c
      JOIN mistake_occurrences mo ON mo."mistakeId" = c."mistakeId"
      JOIN games g ON g.id = mo."gameId"
     WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND g."referenceId" = ${gameRef}
     ORDER BY mo.ply`;
}

async function optOut(db: TrainDb, gameRef: string): Promise<number[]> {
  const rows = await db.raw.$queryRaw<{ o: number[] | null }[]>`
    SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(pr.progress->'bankOptOut', '[]'::jsonb))::int) AS o
      FROM player_reviews pr JOIN games g ON g.id = pr."gameId" WHERE g."referenceId" = ${gameRef} AND pr.color = 'w'`;
  return rows[0]?.o ?? [];
}

test(
  "T2–T4: 3 key moments → 3 cards; the moment switch rolls back on a 500, then off/on; Review complete → Drill These 3",
  { tag: ["@p5", "@local-only", ...stateTags("runner", "solve")] },
  async ({ persona, page, reviewDb, telemetry }, testInfo) => {
    test.setTimeout(600_000);
    await persona("bank-empty");
    const db = trainDb(reviewDb);
    const userId = await db.userId(poolUserEmail(testInfo));

    const ref = await createBotGame(page);
    await completeBotGame(page, ref, blunderLine());
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/review/${ref}/status`);
          return res.ok() ? ((await res.json()) as { data: { analysis: { status: string } } }).data.analysis.status : `http ${res.status()}`;
        },
        { timeout: 240_000, intervals: [2_000] },
      )
      .toBe("done");
    const cards = await gameCards(db, userId, ref);
    expect(cards.map((c) => c.ply), "one card per key moment (the three blunders)").toEqual([6, 12, 16]);

    // The review: moment 1's bank switch.
    await gotoOk(page, `/review/${ref}`);
    await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    await expect(async () => {
      await control(page, "start-review").click({ timeout: 5_000 });
      await expect(page.getByTestId("moment-panel")).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByTestId("moment-header")).toContainText("of 3");
    const reveal = page.locator('[data-testid="reveal-answer"]:visible, [data-testid="bar-reveal-answer"]:visible').first();
    if (await reveal.count()) await reveal.click();
    const toggle = page.getByTestId("moment-bank-toggle").filter({ visible: true });
    await expect(toggle).toBeChecked({ timeout: 30_000 });

    // A 500 rolls the switch back.
    const pattern = new RegExp(`/api/review/${ref}/moments/\\d+$`);
    await page.route(pattern, (route) => route.continue({ headers: { ...route.request().headers(), "x-rc-fault": "500" } }), { times: 1 });
    await toggle.click();
    await expect(page.getByText("Couldn't update your Mistake Bank").first()).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeChecked();
    expect(await optOut(db, ref)).toEqual([]);
    expect(await gameCards(db, userId, ref)).toHaveLength(3);

    // Off, then on.
    await toggle.click();
    await expect(page.getByText("Removed from Mistake Bank").first()).toBeVisible({ timeout: 15_000 });
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => optOut(db, ref), { timeout: 15_000 }).toEqual([6]);
    expect((await gameCards(db, userId, ref)).map((c) => c.ply)).toEqual([12, 16]);
    await toggle.click();
    await expect(page.getByText(/^Added to Mistake Bank · next review /).first()).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeChecked();
    await expect.poll(() => optOut(db, ref), { timeout: 15_000 }).toEqual([]);
    const back = await gameCards(db, userId, ref);
    expect(back.map((c) => c.ply)).toEqual([6, 12, 16]);

    // Walk the other two moments and finish.
    for (let i = 2; i <= 3; i++) {
      await control(page, "next-moment").click();
      await expect(page.getByTestId("moment-header")).toContainText(`${i} of 3`);
      const r = page.locator('[data-testid="reveal-answer"]:visible, [data-testid="bar-reveal-answer"]:visible').first();
      if (await r.count()) await r.click();
    }
    await control(page, "finish-review").click();
    await page.waitForURL(new RegExp(`/review/${ref}/complete`), { timeout: 120_000 });
    // The cards come back at the next 08:00 release in the member's zone (UTC): today before 08:00, else tomorrow.
    const [first] = await db.raw.$queryRaw<{ due: Date }[]>`
      SELECT min(c.due) AS due FROM training_cards c JOIN mistake_occurrences mo ON mo."mistakeId" = c."mistakeId"
        JOIN games g ON g.id = mo."gameId" WHERE c."userId" = ${userId} AND g."referenceId" = ${ref}`;
    const when = first!.due.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) ? "today" : "tomorrow";
    await expect(page.getByTestId("complete-lead")).toHaveText(`3 moments reviewed · 3 added to your Mistake Bank. The first one comes back ${when}.`, { timeout: 60_000 });
    const tags = page.getByTestId("complete-moment-bank");
    await expect(tags).toHaveCount(3);
    for (const t of await tags.all()) await expect(t).toHaveText("Added");
    const drill = page.getByTestId("complete-primary");
    await expect(drill).toHaveText(/^Drill These 3 Mistakes · ~\d+ min$/);

    await drill.click();
    await page.waitForURL(/\/train\/bank\/session/, { timeout: 120_000 });
    // The day-one funnel (plan §10.1): Review complete → Drill → train_session_started{source: review_complete}.
    await telemetry.expect("drill_from_review_clicked", { mistakes: 3 }, { count: 1, source: "client" });
    const session = await waitForSession(page);
    const payload = await sessionPayload(page.request, session);
    expect(new Set(payload.items.map((i) => i.cardRef))).toEqual(new Set(back.map((c) => c.itemKey)));
    expect(payload.items).toHaveLength(3);
    await expect(trainerBoard(page)).toHaveAttribute("data-input", "", { timeout: 60_000 });
  },
);
