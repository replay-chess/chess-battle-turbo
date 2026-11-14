// Today's plan end to end (phase-05 plan §12.4 `train-plan.spec.ts`; owner tests T4–T6; §4.2, §4.4, §4.7, §10.1). @p5
//
// Leased `train-plan` (3 NEW cards from one analysed game due now, streak 4 ending yesterday, no plan built today) on
// desktop-1440, iPhone and Android at 100 %: /train shows "0 of 2 done" and the streak → Start Today's Plan → the
// runner (kind daily: the plan's bank step, then its 3 puzzles) → item 1 solved first try (Good suggested, taken),
// item 2 with one hint (Hard suggested, overridden to Good), item 3 a wrong move then Show Solution (Again suggested,
// taken) → the three puzzles solved first try → item 3 comes back once as its pass-2 copy and is solved → the summary
// ("6 / 6", a 4-row grade table with real interval labels, the themes) → Back to Train → "Done for today",
// "2 of 2 done", streak 5 (+1 once).
//
// Telemetry through the sink (X6): `train_session_started {kind: daily, source: plan}` once, `train_item_graded` exactly
// 7 times (4 bank grades incl. the re-queue, one `overridden: true`; 3 puzzles), `train_session_completed
// {perfect: false}` once, and the server's `train_attempts_applied` batches applied exactly 7 attempts (`ok`; a replayed
// batch only adds `duplicates`) = the attempts the database holds for the session. No solution SAN in any property (`forbidSolutions`).
import {
  BOARDS,
  DEVICES,
  deviceStateTags,
  expectAttemptsApplied,
  expect,
  forbidSolutions,
  gotoOk,
  grade,
  hint,
  intervalLabels,
  itemOf,
  itemsById,
  nextItem,
  noDocumentScroll,
  openSummary,
  playUci,
  poolUserEmail,
  sessionPayload,
  showSolution,
  solveAndGradeAll,
  solveItem,
  stateTags,
  suggested,
  test,
  trainDb,
  viewerRef,
  waitForSession,
  wrongMove,
} from "./_lib/train";

test.describe.configure({ mode: "serial" });

const RUNNER_STATES = ["solve", "hint", "wrong", "correct", "solution"] as const;
const INTERVAL = /^(< \d+ min|\d+ (min|hour|hours|day|days|week|weeks|month|months))$/;

for (const device of ["desktop-1440", "iphone", "android"] as const) {
  test.describe(`today's plan · ${device}@100`, { tag: ["@p5"] }, () => {
    // The personas live in UTC; a browser in another zone would PATCH the stored zone (the hub syncs it).
    test.use({ ...DEVICES[device], timezoneId: "UTC" });

    test(
      "T4–T6: 0 of 2 → Good / Hard→Good / wrong + solution → Again → puzzles → re-queued once → summary → done, streak +1",
      {
        tag: [
          ...stateTags("hub", "default"),
          ...BOARDS.runner.flatMap((b) => RUNNER_STATES.map((s) => `@state:${b}.${s}`)),
          ...stateTags("summary", "default"),
          ...deviceStateTags(device, "TrainHub", "default"),
          ...(device === "desktop-1440" ? ["@state:V3Nav.train"] : []),
        ],
      },
      async ({ persona, page, reviewDb, telemetry }, testInfo) => {
        test.setTimeout(600_000);
        await persona("train-plan");
        const db = trainDb(reviewDb);
        const userId = await db.userId(poolUserEmail(testInfo));
        const ref = await viewerRef(page);
        const before = await db.attempts(userId);

        await gotoOk(page, "/train");
        await expect(page.locator('[data-testid="train-hub"][data-state="default"]')).toBeVisible({ timeout: 120_000 });
        await expect(page.getByTestId("train-plan-progress")).toHaveText(/0 of 2 done/);
        const streak = page.getByTestId("train-streak").or(page.getByTestId("train-streak-chip")).filter({ visible: true }).first();
        await expect(streak).toContainText("4");
        await noDocumentScroll(page, "hub");
        if (device === "desktop-1440") {
          // V3Nav `train`: the Train destination is current, with its Today / Mistake Bank / Puzzles subs.
          await expect(page.locator('[data-rc-nav] a[href="/train"]').first()).toHaveAttribute("aria-current", "page");
          for (const sub of ["/train/bank", "/train/puzzles"]) await expect(page.locator(`[data-rc-nav] a[href="${sub}"]`).first()).toBeVisible();
        }
        await telemetry.expect("train_hub_viewed", { state: "default", plan_done: 0, plan_total: 2, streak: 4 }, { count: 1, source: "client" });

        await page.locator('[data-testid="train-plan-cta"]:visible, [data-testid="train-sticky-cta-button"]:visible').first().click();
        await page.waitForURL(/\/train\/bank\/session/, { timeout: 120_000 });
        const sessionRef = await waitForSession(page);
        const payload = await sessionPayload(page.request, sessionRef);
        expect(payload.kind).toBe("daily");
        const bank = payload.items.filter((i) => i.kind !== "puzzle");
        const puzzles = payload.items.filter((i) => i.kind === "puzzle");
        expect(bank, "the plan's bank step: the 3 due positions").toHaveLength(3);
        expect(puzzles, "the plan's puzzle step").toHaveLength(3);
        forbidSolutions(telemetry, payload.items);
        const items = itemsById(payload);

        // 1: first try → Good suggested, with the real FSRS intervals of a NEW card.
        let id = await nextItem(page, null);
        expect(itemOf(items, id).kind).not.toBe("puzzle");
        await solveItem(page, itemOf(items, id));
        expect(await suggested(page)).toBe("good");
        const labels = await intervalLabels(page);
        for (const g of Object.values(labels)) expect(g).toMatch(INTERVAL);
        expect(labels.again).toBe("< 10 min");
        await grade(page, "good");

        // 2: one hint → Hard suggested, overridden to Good.
        id = await nextItem(page, id);
        await hint(page);
        await solveItem(page, itemOf(items, id));
        expect(await suggested(page)).toBe("hard");
        await grade(page, "good");

        // 3: a wrong move, then Show Solution → Again suggested.
        id = await nextItem(page, id);
        const third = id;
        await playUci(page, wrongMove(itemOf(items, id)));
        await expect(page.getByTestId("trainer-status").filter({ visible: true }).first()).not.toBeEmpty();
        await showSolution(page);
        expect(await suggested(page)).toBe("again");
        await grade(page, "again");

        // The puzzle step, then the missed position once more (its pass-2 copy, never a second re-queue).
        const seen: string[] = [];
        for (let k = 0; k < 4; k++) {
          id = await nextItem(page, id);
          seen.push(id);
          await solveItem(page, itemOf(items, id));
          await grade(page, ((await suggested(page)) ?? "good") as "good");
        }
        expect(seen.filter((x) => x === `${third}b`), "the missed position is re-queued once").toHaveLength(1);
        expect(seen.filter((x) => itemOf(items, x).kind === "puzzle")).toHaveLength(3);

        await openSummary(page);
        const summary = page.getByTestId("session-summary");
        await expect(summary).toHaveAttribute("data-variant", "default");
        await expect(page.getByTestId("summary-stats")).toContainText(/6\s*\/\s*6/);
        const rows = page.getByTestId("summary-grades").locator("tbody tr");
        await expect(rows).toHaveCount(4);
        for (const g of ["again", "hard", "good", "easy"]) await expect(page.locator(`[data-testid="summary-grades"] tr[data-grade="${g}"]`)).toHaveCount(1);
        await expect(page.locator('[data-testid="summary-grades"] tr[data-grade="again"] .ts-table__n')).toHaveText("1");
        const counts = await page.locator('[data-testid="summary-grades"] .ts-table__n').allTextContents();
        expect(counts.reduce((n, c) => n + Number(c), 0), "every grade of the session is in the table").toBe(7);
        await expect(page.locator('[data-testid="summary-grades"] tr[data-grade="good"] .ts-table__when')).toHaveText(INTERVAL);
        await expect(page.getByTestId("summary-themes")).toBeVisible();
        await noDocumentScroll(page, "summary");

        // Exactly-once: 7 grades on the client, 7 attempts in the database, the server's batches sum to 7.
        await telemetry.expect("train_item_graded", {}, { count: 7, source: "client" });
        await telemetry.expect("train_item_graded", { overridden: true }, { count: 1, source: "client" });
        await telemetry.expect("train_item_graded", { overridden: true, suggested: "hard", grade: "good" }, { count: 1, source: "client" });
        await telemetry.expect("train_session_completed", { kind: "daily", perfect: false }, { count: 1, source: "client" });
        await expect.poll(() => db.attemptsOfSession(sessionRef), { timeout: 30_000 }).toBe(7);
        const after = await db.attempts(userId);
        expect(after.n - before.n).toBe(7);
        expect(after.n).toBe(after.distinct);
        await expectAttemptsApplied(telemetry, ref, 7);

        await page.getByTestId("summary-back").click();
        await page.waitForURL(/\/train$/, { timeout: 120_000 });
        await expect(page.getByTestId("train-plan-progress")).toHaveText(/2 of 2 done/, { timeout: 60_000 });
        await expect(page.getByText("Done for today").first()).toBeVisible();
        await expect(streak).toContainText("5");
        const profile = await db.profile(userId);
        expect(profile?.dayStreak, "streak +1, once").toBe(5);
        // regression: train-session-started-source (WP-I D-I1): the session the hub created is a new plan session, not a
        // deep-link resume (the runner read `?s=` as a resume).
        await telemetry.expect("train_session_started", { kind: "daily", source: "plan", resumed: false }, { count: 1, source: "client" });
      },
    );
  });
}


test.describe("perfect session · desktop-1440@100", { tag: ["@p5"] }, () => {
  test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

  test(
    "three due positions, all first try → \"A perfect session.\"",
    { tag: [...stateTags("summary", "perfect")] },
    async ({ persona, page, reviewDb, telemetry }, testInfo) => {
      test.setTimeout(420_000);
      await persona("outbox");
      const db = trainDb(reviewDb);
      await db.userId(poolUserEmail(testInfo));
      await gotoOk(page, "/train/bank/session");
      const ref = await waitForSession(page);
      const payload = await sessionPayload(page.request, ref);
      expect(payload.items).toHaveLength(3);
      forbidSolutions(telemetry, payload.items);
      expect(await solveAndGradeAll(page, itemsById(payload), 10)).toBe(3);
      await openSummary(page);
      await expect(page.getByTestId("session-summary")).toHaveAttribute("data-variant", "perfect");
      await expect(page.getByTestId("summary-title")).toHaveText(/A perfect session\./);
      await expect(page.getByTestId("summary-stats")).toContainText(/3\s*\/\s*3/);
      await noDocumentScroll(page, "perfect summary");
      await telemetry.expect("train_session_completed", { kind: "bank", perfect: true, solved: 3, total: 3 }, { count: 1, source: "client" });
    },
  );
});
