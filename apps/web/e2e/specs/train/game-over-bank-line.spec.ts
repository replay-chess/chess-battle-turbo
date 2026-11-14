// The game-over card's Mistake Bank line (phase-05 plan §12.4 `game-over-bank-line.spec.ts`; owner test T12, coverage
// C-01; §4.8 "Game-over card"). @p5 @local-only
//
// Shared member C plays bot games in the browser (fake engine; asserts only on its own new games):
//   - blunders (three quiet moves, then the move that hangs the most each turn), then resigns: the card shows the
//     accuracy line (P3) and then "+N positions added to your Mistake Bank (moves …)." without a reload, driven by
//     `analysis:done`; N equals the bank cards of that game; a reload brings the same line back from A2's status;
//     `game_over_bank_line_shown {mode: bot}` once;
//   - a clean game (P3's Ruy Lopez line through the API, resigned before 13.Nf1): nothing in the bank, no line;
//   - another member opening the finished game sees no line (never a spectator's);
//   - the demo card (`/dev/ui/game-over`): no `bank` (the `train` flag off) and `bank=0` render no line, `bank=1` one.
// @local-only: the e2e worker with the fake engine.
import type { Page } from "@playwright/test";
import { gameTags } from "../game/tags";
import { completeBotGame, createBotGame, RUY_LOPEZ_26 } from "../review/_lib/games";
import { DEVICES, expect, gotoOk, playBotGame, test, trainDb } from "./_lib/train";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

const LINE = /^\+(\d+) positions? added to your Mistake Bank \(moves? \d+(, \d+)*\)\.$/;
const bankLine = (page: Page) => page.getByTestId("game-over-bank-line").filter({ visible: true });

async function analysisDone(page: Page, ref: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/review/${ref}/status`);
        return res.ok() ? ((await res.json()) as { data: { analysis: { status: string } } }).data.analysis.status : `http ${res.status()}`;
      },
      { timeout: 300_000, intervals: [2_000] },
    )
    .toBe("done");
}

test(
  "T12: blunders → the accuracy line, then +N positions added without a reload; the same after a reload",
  { tag: ["@p5", "@local-only", ...gameTags("state", ["over_resign_loss"])] },
  async ({ member, page, reviewDb, telemetry }) => {
    test.setTimeout(900_000);
    await member("C");
    const db = trainDb(reviewDb);
    const userId = await db.userId(process.env.E2E_USER_C_EMAIL!);
    const ref = await playBotGame(page, { own: 10, blunders: true });

    const line = bankLine(page);
    await expect(line).toBeVisible({ timeout: 300_000 });
    const text = (await line.textContent())!.trim();
    expect(text).toMatch(LINE);
    await expect(line).toHaveAttribute("role", "status");
    const n = Number(LINE.exec(text)![1]);
    const [cards] = await db.raw.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT c.id) AS n FROM training_cards c
        JOIN mistake_occurrences mo ON mo."mistakeId" = c."mistakeId" JOIN games g ON g.id = mo."gameId"
       WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND g."referenceId" = ${ref}`;
    expect(Number(cards?.n ?? 0), "the line counts this game's bank cards").toBe(n);
    await telemetry.expect("game_over_bank_line_shown", { mode: "bot", count: Math.min(n, 4) }, { count: 1, source: "client" });

    await page.reload();
    await expect(bankLine(page)).toHaveText(text, { timeout: 120_000 });
  },
);

test("a clean game: no line once analysed, none after a reload; another member sees none", { tag: ["@p5", "@local-only"] }, async ({ member, userPage, page, reviewDb }) => {
  test.setTimeout(600_000);
  await member("C");
  // P3's Closed Ruy Lopez line up to 12…Re8 (24 plies), then White resigns: the fake engine grades none of White's
  // moves an error (13.Nf1, the 25th ply, is the one it would flag, so the line stops before it).
  const ref = await createBotGame(page);
  await completeBotGame(page, ref, RUY_LOPEZ_26.slice(0, 24));
  await analysisDone(page, ref);
  const [cards] = await reviewDb.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM mistake_occurrences mo JOIN games g ON g.id = mo."gameId" WHERE g."referenceId" = ${ref}`;
  expect(Number(cards?.n ?? 0), "the clean game puts nothing in the bank").toBe(0);
  await gotoOk(page, `/game/${ref}`);
  await expect(page.locator('[data-testid="game-board-container"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("game-result-title").filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId("game-over-bank-line")).toHaveCount(0);

  const d = await userPage("D");
  await d.goto(`/game/${ref}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await d.waitForTimeout(5_000);
  await expect(d.getByTestId("game-over-bank-line")).toHaveCount(0);
});

test("demo card: no slot with the flag off, none at 0, the line at 1", { tag: ["@p5", "@demo:V3GameOver.over_checkmate_win"] }, async ({ page }) => {
  test.setTimeout(180_000);
  await gotoOk(page, "/dev/ui/game-over?slot=done");
  await expect(page.getByTestId("game-over-demo")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("game-over-bank-line")).toHaveCount(0);
  await gotoOk(page, "/dev/ui/game-over?slot=done&bank=0");
  await expect(page.getByTestId("game-over-demo")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("game-over-bank-line")).toHaveCount(0);
  await gotoOk(page, "/dev/ui/game-over?slot=done&bank=1");
  await expect(bankLine(page)).toHaveText(LINE, { timeout: 60_000 });
});
