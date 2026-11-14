// The Mistake Bank on real data (phase-05 plan §12.4 `bank.spec.ts`; §4.3, §5.2 S3, §10.1). @p5
//
// Leased `bank-member` (41 positions from 24 analysed games, 4 due today) on desktop-1440 and iPhone at 100 %:
//   - the Due / All counts and tabs match the database (complete bank: every row in the first payload);
//   - Filter (the popover on desktop, opened with F; the sheet on the phone): pick Fork → "Show N Positions" (N = the
//     member's fork cards) → the list is filtered and the URL carries `theme=fork`; leaving for /train and coming Back
//     restores the filter;
//   - a theme × phase the member has no card for → "Nothing matches these filters" → Clear Filters → all rows again;
//   - desktop: a row click selects it (the detail board), ↑/↓ move the selection, Enter solves it → the runner starts at
//     that card; Solve This One on the detail pane does the same; the phone: a row tap opens the runner at that card.
// Telemetry: `bank_viewed {state: default, total: 41, complete: true}` once per mount, `bank_filter_applied
// {theme: fork, results: N}`, `bank_solve_one_clicked` (desktop).
import type { Page } from "@playwright/test";
import {
  DEVICES,
  deviceStateTags,
  expect,
  gotoOk,
  noDocumentScroll,
  poolUserEmail,
  sessionPayload,
  stateTags,
  test,
  trainDb,
  trainerBoard,
  waitForSession,
  type TrainDb,
} from "./_lib/train";

test.describe.configure({ mode: "serial" });

const rows = (page: Page) => page.getByTestId("bank-row").filter({ visible: true });

async function themeCount(db: TrainDb, userId: bigint, theme: string): Promise<number> {
  const [r] = await db.raw.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
     WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND m."hiddenAt" IS NULL AND c.theme = ${theme}`;
  return Number(r?.n ?? 0);
}

/** A theme the member has and a phase none of that theme's cards are in (the empty combination). */
async function emptyCombination(db: TrainDb, userId: bigint): Promise<{ theme: string; phase: string }> {
  const present = await db.raw.$queryRaw<{ theme: string; phase: string | null }[]>`
    SELECT DISTINCT c.theme, lower(c.phase::text) AS phase FROM training_cards c
     WHERE c."userId" = ${userId} AND c.deck = 'BANK'`;
  for (const theme of [...new Set(present.map((p) => p.theme))]) {
    for (const phase of ["opening", "middlegame", "endgame"]) {
      if (!present.some((p) => p.theme === theme && p.phase === phase)) return { theme, phase };
    }
  }
  throw new Error("the persona covers every theme × phase: no empty combination to test");
}

for (const device of ["desktop-1440", "iphone"] as const) {
  const phone = device === "iphone";
  test.describe(`mistake bank · ${device}@100`, { tag: ["@p5"] }, () => {
    // The personas live in UTC; a browser in another zone would PATCH the stored zone (the hub syncs it).
    test.use({ ...DEVICES[device], timezoneId: "UTC" });

    test(
      "Due/All counts, Filter → Fork → URL state survives Back, nothing matches → Clear, solve one",
      {
        tag: [
          ...stateTags("bank", "default", "filtered"),
          ...deviceStateTags(device, "MistakeBank", "default", "filtered"),
          ...deviceStateTags(device, "Bank", "due"),
        ],
      },
      async ({ persona, page, reviewDb, telemetry }, testInfo) => {
        test.setTimeout(420_000);
        await persona("bank-member");
        const db = trainDb(reviewDb);
        const userId = await db.userId(poolUserEmail(testInfo));
        const total = await db.bankCards(userId);
        const due = await db.dueBankCards(userId, new Date());
        expect(total).toBe(41);
        expect(due).toBe(4);

        await gotoOk(page, "/train/bank");
        await expect(page.locator('[data-testid="train-bank"][data-state="default"]')).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('[data-testid="train-bank"]')).toHaveAttribute("data-complete", /.*/);
        await noDocumentScroll(page, "bank");
        await expect(rows(page)).toHaveCount(total, { timeout: 60_000 });
        await telemetry.expect("bank_viewed", { state: "default", total, due, complete: true }, { count: 1, source: "client" });

        // Due / All tabs.
        const tabs = page.getByTestId("bank-tabs").filter({ visible: true }).first();
        await expect(tabs).toContainText(`Due · ${due}`);
        await expect(tabs).toContainText(`All · ${total}`);
        await tabs.getByRole("radio", { name: /^Due/ }).or(tabs.getByRole("tab", { name: /^Due/ })).or(tabs.getByRole("button", { name: /^Due/ })).first().click();
        await expect(page).toHaveURL(/[?&]view=due/);
        await expect(page.locator('[data-testid="bank-row"][data-due]').filter({ visible: true })).toHaveCount(due);
        await tabs.getByRole("radio", { name: /^All/ }).or(tabs.getByRole("tab", { name: /^All/ })).or(tabs.getByRole("button", { name: /^All/ })).first().click();
        await expect(page).toHaveURL(/[?&]view=all/);
        await expect(rows(page)).toHaveCount(total);

        // Filter → Fork.
        const forks = await themeCount(db, userId, "fork");
        expect(forks, "the persona has fork positions").toBeGreaterThan(0);
        if (phone) {
          await page.getByTestId("bank-filter").filter({ visible: true }).first().click();
        } else {
          await page.locator("body").click({ position: { x: 2, y: 2 } });
          await page.keyboard.press("f");
        }
        const panel = page.getByTestId("bank-filter-panel");
        await expect(panel).toBeVisible();
        await panel.getByTestId("bank-filter-theme-fork").click();
        await expect(page).toHaveURL(/[?&]theme=fork/);
        await expect(page.getByTestId("bank-filter-show")).toHaveText(`Show ${forks} ${forks === 1 ? "Position" : "Positions"}`);
        await page.getByTestId("bank-filter-show").click();
        await expect(panel).toBeHidden();
        await expect(rows(page)).toHaveCount(forks);
        await telemetry.expect("bank_filter_applied", { theme: "fork", results: forks }, { count: 1, source: "client" });
        const filteredUrl = page.url();

        // Leave and come Back: the filter is the URL's.
        await gotoOk(page, "/train");
        await expect(page.locator('[data-testid="train-hub"][data-state]').last()).toBeVisible({ timeout: 120_000 });
        await page.goBack();
        await expect(page).toHaveURL(filteredUrl, { timeout: 60_000 });
        await expect(rows(page)).toHaveCount(forks, { timeout: 60_000 });

        // Nothing matches → Clear Filters.
        const none = await emptyCombination(db, userId);
        await gotoOk(page, `/train/bank?view=all&theme=${encodeURIComponent(none.theme)}&phase=${none.phase}`);
        const empty = page.getByTestId("bank-no-matches");
        await expect(empty).toContainText("Nothing matches these filters", { timeout: 60_000 });
        await empty.getByRole("button", { name: "Clear Filters" }).click();
        await expect(page).not.toHaveURL(/[?&](theme|phase)=/);
        await expect(rows(page)).toHaveCount(total);

        // Solve one.
        const runnerAt = async (card: string) => {
          await page.waitForURL(/\/train\/bank\/session/, { timeout: 120_000 });
          const ref = await waitForSession(page);
          const payload = await sessionPayload(page.request, ref);
          expect(payload.items.map((i) => i.cardRef), "the runner starts at that card").toEqual([card]);
          await expect(trainerBoard(page)).toHaveAttribute("data-input", "", { timeout: 60_000 });
        };
        if (phone) {
          const card = (await rows(page).first().getAttribute("data-card"))!;
          await rows(page).first().click();
          await runnerAt(card);
        } else {
          // ↑/↓ move the selection, Enter solves it.
          await rows(page).first().click();
          await expect(rows(page).first()).toHaveAttribute("aria-current", "true");
          await expect(page.getByTestId("bank-detail-board")).toBeVisible();
          await page.keyboard.press("ArrowDown");
          await expect(rows(page).nth(1)).toHaveAttribute("aria-current", "true");
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press("ArrowUp");
          await expect(rows(page).nth(1)).toHaveAttribute("aria-current", "true");
          const keyed = (await rows(page).nth(1).getAttribute("data-card"))!;
          await page.keyboard.press("Enter");
          await runnerAt(keyed);
          // Solve This One on the detail pane.
          await gotoOk(page, "/train/bank?view=all");
          await expect(rows(page)).toHaveCount(total, { timeout: 60_000 });
          await rows(page).nth(2).click();
          const clicked = (await rows(page).nth(2).getAttribute("data-card"))!;
          await page.getByTestId("bank-solve-one").filter({ visible: true }).first().click();
          await telemetry.expect("bank_solve_one_clicked", {}, { count: 1, source: "client" });
          await runnerAt(clicked);
        }
      },
    );
  });
}
