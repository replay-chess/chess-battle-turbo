// The Mistake Bank's empty and caught-up pages on real data (phase-05 plan §12.4 `bank-states.spec.ts`; §4.3 states,
// §4.2 nothingdue). @p5
//
//   empty     leased `bank-empty` (one analysed game not reviewed yet, no bank, no linked account): the heading, the
//             CTAs (Play a Game to Fill Your Bank on desktop, Review Your Last Game "not reviewed yet", Import Games From
//             Chess.com or Lichess) and the faded example card; no lesson card (the slot is P8's and renders nothing).
//   caughtup  leased `bank-caughtup` (today's 10 reviewed, nothing due; Tomorrow 6 · day 2 3 · day 3 5 · next week 9):
//             "All caught up", the copy with the cap, Coming up rows (desktop), Browse All 23 Positions → the list; no
//             lesson card. /train shows the nothingdue hub (Done for today, the next batch line).
// Each persona's tests run in this file only, serially (two files leasing the same persona must both be serial).
import {
  DEVICES,
  deviceStateTags,
  expect,
  gotoOk,
  noDocumentScroll,
  poolUserEmail,
  serverClock,
  stateTags,
  test,
  trainDb,
} from "./_lib/train";
import { poolSlot } from "../../fixtures/users";

/** Tuesday 2026-11-10 12:00 UTC: after the persona's 08:00 release. */
const AT = new Date("2026-11-10T12:00:00Z");

test.describe.configure({ mode: "serial" });
// The caught-up test routes its requests (server time): no service worker may take them past page.route.
test.use({ serviceWorkers: "block" });

for (const device of ["desktop-1440", "iphone"] as const) {
  const phone = device === "iphone";
  test.describe(`bank states · ${device}@100`, { tag: ["@p5"] }, () => {
    // The personas live in UTC; a browser in another zone would PATCH the stored zone (the hub syncs it).
    test.use({ ...DEVICES[device], timezoneId: "UTC" });

    test("empty: CTAs, the example card, no lesson card", { tag: [...stateTags("bankStates", "empty"), ...deviceStateTags(device, "Bank", "empty")] }, async ({ persona, page, reviewDb, telemetry }, testInfo) => {
      test.setTimeout(300_000);
      await persona("bank-empty");
      const db = trainDb(reviewDb);
      expect(await db.bankCards(await db.userId(poolUserEmail(testInfo)))).toBe(0);
      await gotoOk(page, "/train/bank");
      await expect(page.locator('[data-testid="train-bank"][data-state="empty"]')).toBeVisible({ timeout: 120_000 });
      const empty = page.getByTestId("bank-empty");
      await expect(empty.getByRole("heading", { level: 2 })).toHaveText("Your mistakes will land here after you review a game");
      if (phone) await expect(page.getByTestId("bank-empty-play")).toBeHidden();
      else await expect(page.getByTestId("bank-empty-play")).toHaveText("Play a Game to Fill Your Bank");
      await expect(page.getByTestId("bank-empty-review")).toContainText("Review Your Last Game");
      await expect(page.getByTestId("bank-empty-review")).toContainText("not reviewed yet");
      await expect(page.getByTestId("bank-empty-review")).toHaveAttribute("href", /^\/review\/c[a-z0-9]+$/);
      await expect(page.getByTestId("bank-empty-import")).toContainText("Import Games From Chess.com or Lichess");
      await expect(empty.getByText("Example", { exact: true })).toBeVisible();
      await expect(page.getByTestId("lesson-card")).toHaveCount(0);
      await noDocumentScroll(page, "empty bank");
      await telemetry.expect("bank_viewed", { state: "empty", total: 0, due: 0 }, { count: 1, source: "client" });
    });

    test(
      "caughtup: All caught up, Coming up, Browse All → the list; the hub is done for today",
      {
        tag: [
          ...stateTags("bankStates", "caughtup"),
          ...deviceStateTags(device, "Bank", "caughtup"),
          ...stateTags("hub", "nothingdue"),
          ...deviceStateTags(device, "TrainHub", "nothingdue"),
        ],
      },
      async ({ member, page, reviewDb, telemetry, baseURL }, testInfo) => {
        test.setTimeout(300_000);
        // The Coming up rows are relative to the reset: at a fixed instant after the 08:00 release (a Tuesday) the
        // persona's blocks are Tomorrow · Thursday · Friday · Next week whatever the wall clock says.
        const email = poolUserEmail(testInfo);
        await member(email);
        const { resetPersona } = await import("../../../scripts/dev/personas");
        await resetPersona(String(poolSlot(testInfo.parallelIndex, 0)), "bank-caughtup", { now: AT, log: () => undefined });
        const clock = await serverClock(page, baseURL!);
        clock.set(AT);
        const db = trainDb(reviewDb);
        const userId = await db.userId(email);
        const total = await db.bankCards(userId);
        expect(total).toBe(23);
        expect(await db.dueBankCards(userId, AT)).toBe(0);

        await gotoOk(page, "/train/bank");
        await expect(page.locator('[data-testid="train-bank"][data-state="caughtup"]')).toBeVisible({ timeout: 120_000 });
        const caught = page.getByTestId("bank-caughtup");
        await expect(caught.getByRole("heading", { level: 2 })).toHaveText("All caught up");
        await expect(page.getByTestId("bank-caughtup-line")).toContainText("10");
        if (phone) {
          await expect(page.getByTestId("bank-upcoming")).toBeHidden();
        } else {
          const upcoming = page.getByTestId("bank-upcoming");
          await expect(upcoming).toContainText("Coming up");
          const items = upcoming.locator("li");
          await expect(items).toHaveCount(4);
          await expect(items.first()).toContainText("Tomorrow");
          await expect(items.first()).toContainText("6");
          await expect(items.nth(1)).toContainText("Thursday");
          await expect(items.nth(3)).toContainText("Next week");
          await expect(page.getByTestId("bank-caughtup-puzzles")).toHaveText(/^Train .+ While You Wait$/);
        }
        await expect(page.getByTestId("lesson-card")).toHaveCount(0);
        await noDocumentScroll(page, "caught-up bank");
        await telemetry.expect("bank_viewed", { state: "caughtup", total, due: 0 }, { count: 1, source: "client" });

        // regression: bank-browse-all-noop (WP-I D-I2): the link changed the URL and left the caught-up page on screen.
        const browse = page.getByTestId("bank-caughtup-browse");
        await expect(browse).toHaveText(`Browse All ${total} Positions`);
        await browse.click();
        await expect(page).toHaveURL(/[?&]view=all/);
        await expect(page.getByTestId("bank-row").filter({ visible: true })).toHaveCount(total, { timeout: 60_000 });

        await gotoOk(page, "/train");
        await expect(page.locator('[data-testid="train-hub"][data-state="nothingdue"]')).toBeVisible({ timeout: 120_000 });
        if (phone) await expect(page.getByText(/^Next 6 reviews arrive tomorrow at 08:00\.$/).filter({ visible: true })).toHaveCount(1);
        else await expect(page.getByTestId("train-nothing-due")).toBeVisible();
        await noDocumentScroll(page, "nothingdue hub");
        await telemetry.expect("train_hub_viewed", { state: "nothingdue", due_shown: 0 }, { count: 1, source: "client" });
      },
    );
  });
}
