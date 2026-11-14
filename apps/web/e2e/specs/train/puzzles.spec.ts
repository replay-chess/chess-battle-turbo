// Puzzles by theme (phase-05 plan §12.4 `puzzles.spec.ts`; owner test T7; §4.5, §4.6, §8.7, §9.3). @p5 @local-only
//
// Leased `puzzles-fresh` (no puzzle attempts, rating seeded 1512, provisional) on desktop-1440, shards from the CI shard
// server (e2e/mocks/puzzle-shards.ts, the committed 6-theme × bands 14–16 subset; never R2):
//   - the setup move plays, then the member solves item 1 first try: the rating chip moves off 1512
//     (`puzzle_rating_changed`);
//   - Report a Problem from the menu stores one `reports` row for that puzzle;
//   - T opens the theme picker; Pins builds a new session ("1 of 10", `puzzle_theme_changed {to: pin, surface:
//     picker}`); going through it (a missed puzzle comes back once at the end, so the stream is longer than 10)
//     fires the extend request while 2 positions are still ahead;
//   - with today's `puzzlesDone` at the fair-use limit (400), a new session answers 429 and the runner page shows
//     "That's Today's Puzzles".
// The member's rating is kept inside the shard subset's bands (1400–1699): each item is solved first try while the
// stored rating is below 1580 and missed (wrong move, Show Solution, Again) above it, so every extend has puzzles.
// @local-only: the shard server and the database helpers are local.
import type { Page, Request, Response } from "@playwright/test";
import {
  DEVICES,
  expect,
  forbidSolutions,
  gotoOk,
  grade,
  itemOf,
  itemsById,
  nextItem,
  playUci,
  poolUserEmail,
  sessionPayload,
  showSolution,
  solveItem,
  stateTags,
  suggested,
  test,
  trainDb,
  waitForSession,
  wrongMove,
  type Item,
  type TrainDb,
} from "./_lib/train";

test.describe.configure({ mode: "serial" });
// The personas live in UTC; a browser in another zone would PATCH the stored zone (the hub syncs it).
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

/** The shard subset's top band is 16 (1600–1699); a session asks ±100 around the rating. */
const MISS_ABOVE = 1580;

async function ratingChip(page: Page): Promise<number> {
  const text = (await page.getByTestId("trainer-rating").filter({ visible: true }).first().textContent()) ?? "";
  const m = /(\d{3,4})/.exec(text);
  if (!m) throw new Error(`no rating on the chip: "${text}"`);
  return Number(m[1]);
}

/** Solves or misses the current puzzle (see MISS_ABOVE), grades it, and waits until the server applied the attempt. */
async function playOne(page: Page, db: TrainDb, userId: bigint, item: Item, sessionRef: string, applied: number): Promise<"solved" | "missed"> {
  const rating = (await db.profile(userId))?.puzzleRating ?? 1512;
  let outcome: "solved" | "missed";
  // What the outbox sent and what W1 answered, for the failure message when the attempt never lands.
  const exchanges: string[] = [];
  const onResponse = (r: Response) => {
    if (r.request().method() !== "POST" || new URL(r.url()).pathname !== "/api/train/attempts") return;
    void r.text().then(
      (body) => exchanges.push(`${r.request().postData() ?? ""} → ${r.status()} ${body}`),
      () => exchanges.push(`${r.request().postData() ?? ""} → ${r.status()} (no body)`),
    );
  };
  page.on("response", onResponse);
  try {
    if (rating >= MISS_ABOVE) {
      await playUci(page, wrongMove(item));
      await expect(page.getByTestId("trainer-status").filter({ visible: true }).first()).not.toBeEmpty();
      await showSolution(page);
      expect(await suggested(page)).toBe("again");
      await grade(page, "again");
      outcome = "missed";
    } else {
      await solveItem(page, item);
      await grade(page, ((await suggested(page)) ?? "good") as "good");
      outcome = "solved";
    }
    try {
      await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 30_000 }).toBe(applied + 1);
    } catch (err) {
      throw new Error(`${item.itemId} (${item.puzzleId}) was not applied; W1 exchanges: ${exchanges.join(" || ") || "none"}`, { cause: err });
    }
    return outcome;
  } finally {
    page.off("response", onResponse);
  }
}

test(
  "T7: setup move, solve → rating chip, report, T → Pins → 1 of 10, extend before the end, the daily limit",
  {
    tag: ["@p5", "@local-only", ...stateTags("puzzle", "solve", "correct", "wrong", "solution", "themes")],
  },
  async ({ persona, page, reviewDb, telemetry }, testInfo) => {
    test.setTimeout(900_000);
    await persona("puzzles-fresh");
    const db = trainDb(reviewDb);
    const userId = await db.userId(poolUserEmail(testInfo));
    expect((await db.profile(userId))?.puzzleRating).toBe(1512);

    // ── The first session (the focus theme) ──
    await gotoOk(page, "/train/puzzles");
    const first = await waitForSession(page);
    const p1 = await sessionPayload(page.request, first);
    expect(p1.kind).toBe("puzzles");
    expect(p1.items.length).toBeGreaterThan(0);
    forbidSolutions(telemetry, p1.items);
    const items1 = itemsById(p1);
    let id = await nextItem(page, null);
    const item = itemOf(items1, id);
    // The setup move has been played: its target square holds a piece, its origin is empty.
    const setup = item.setup[0]!;
    await expect(page.locator(`[data-testid="trainer-board"] > div:not([data-next]) [data-square="${setup.slice(2, 4)}"] img[alt]:not([alt=""])`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="trainer-board"] > div:not([data-next]) [data-square="${setup.slice(0, 2)}"] img[alt]:not([alt=""])`)).toHaveCount(0);
    expect(await ratingChip(page)).toBe(1512);
    await solveItem(page, item);
    await grade(page, ((await suggested(page)) ?? "good") as "good");
    await expect.poll(() => db.attemptsOfSession(first), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => ratingChip(page), { timeout: 30_000, message: "the rating chip moves after a solve" }).not.toBe(1512);
    await telemetry.expect("puzzle_rating_changed", { provisional: true }, { source: "client" });

    // Report a Problem on the next puzzle.
    id = await nextItem(page, id);
    const reported = itemOf(items1, id);
    await page.locator('[data-testid="trainer-menu"]:visible, [data-testid="trainer-menu-phone"]:visible').first().click();
    await page.getByRole("menuitem", { name: "Report a Problem" }).click();
    const dialog = page.getByTestId("trainer-report");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Send Report" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const [r] = await db.raw.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM reports WHERE "reporterId" = ${userId} AND "targetType" = 'PUZZLE' AND "targetRef" = ${reported.puzzleId}`;
        return Number(r?.n ?? 0);
      }, { timeout: 30_000 })
      .toBe(1);
    await telemetry.expect("train_item_reported", { kind: "puzzle" }, { count: 1, source: "client" });

    // ── T → the theme picker → Pins ──
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("t");
    const picker = page.getByTestId("trainer-themes");
    await expect(picker).toBeVisible();
    let pin = picker.locator('[data-theme="pin"]');
    if (!(await pin.isVisible())) {
      await picker.getByText("More Themes").click();
      pin = picker.locator('[data-theme="pin"]');
    }
    await pin.click();
    await expect(page).not.toHaveURL(new RegExp(`[?&]s=${first}(&|$)`), { timeout: 120_000 });
    const pins = await waitForSession(page);
    await telemetry.expect("puzzle_theme_changed", { to: "pin", surface: "picker" }, { count: 1, source: "client" });
    await expect(page.getByTestId("trainer-progress").filter({ visible: true }).first()).toHaveText(/1 of 10/, { timeout: 60_000 });
    const p2 = await sessionPayload(page.request, pins);
    expect(p2.items.every((i) => i.theme.key === "pin"), "a Pins session").toBe(true);
    const [abandoned] = await db.raw.$queryRaw<{ s: string }[]>`SELECT status::text AS s FROM training_sessions WHERE "referenceId" = ${first}`;
    expect(abandoned?.s, "the theme switch ends the previous puzzles session").not.toBe("ACTIVE");

    // Through the Pins session: the extend request fires before its last item.
    const extend: string[] = [];
    page.on("request", (r: Request) => {
      if (r.method() === "POST" && new RegExp(`/api/train/sessions/${pins}/extend$`).test(new URL(r.url()).pathname)) extend.push(r.url());
    });
    let items2 = itemsById(p2);
    let pid: string | null = null;
    let missed = 0;
    let applied = 0;
    for (let k = 0; k < 16 && extend.length === 0; k++) {
      pid = await nextItem(page, pid);
      if (!items2.has(pid.replace(/b$/, ""))) items2 = itemsById(await sessionPayload(page.request, pins));
      const it = itemOf(items2, pid);
      forbidSolutions(telemetry, [it]);
      if ((await playOne(page, db, userId, it, pins, applied)) === "missed") missed++;
      applied++;
    }
    expect(extend.length, "the extend request fired while positions were still ahead").toBeGreaterThan(0);
    await expect(page.getByTestId("trainer-done").filter({ visible: true }), "the stream did not run dry").toHaveCount(0);
    const profile = await db.profile(userId);
    expect(profile!.puzzleRating, "the rating stayed inside the CI shard bands").toBeGreaterThanOrEqual(1400);
    expect(profile!.puzzleRating).toBeLessThan(1700);
    testInfo.annotations.push({ type: "pins", description: `${applied} graded, ${missed} missed, rating ${Math.round(profile!.puzzleRating)}` });

    // ── The daily fair-use limit ──
    // regression: session-error-server-button (WP-I D-I3): every 429/502 runner page crashed on the server.
    const day = (await db.days(userId)).at(-1)!;
    await db.raw.$executeRaw`UPDATE training_days SET "puzzlesDone" = 400 WHERE "userId" = ${userId} AND day = ${day}::date`;
    await gotoOk(page, "/train/puzzles?theme=fork");
    const error = page.getByTestId("trainer-error");
    await expect(error).toHaveAttribute("data-kind", "daily_puzzle_limit", { timeout: 120_000 });
    await expect(error).toContainText("That's Today's Puzzles");
    await expect(error).toContainText("You've solved 400 puzzles today. More tomorrow.");
  },
);
