// S4 Drill a weakness on real data (phase-06 plan §12.4 `drill.spec.ts`, `drill-time-pressure.spec.ts`, §4.7, §8.11;
// §1.2 T4–T6). Persona `weak-member` (§6.8): 54 real CC0 games graded by the e2e worker, the Mistake Bank J1 extracted
// from them, the READY profile. The drilled row is the member's first matchable row and the time-pressure row its
// `rc:timePressure` row, both read from TR-5. Lichess items come from the CI shard server (the committed CC0 subset,
// never R2). @p6
//
//   config       Drill on the row → /train/weakness/<slug>; 10 + mix by default; 20 → "{12 own} + {8} matched … near
//                {rating}"; mix off → "{n} from your games only ({inBank} in your bank)"; Esc → /train/weakness; the
//                focus enters the config and comes back to the row (FIX-1); weakness_drill_opened and (from the week
//                plan) weakness_week_plan_clicked
//   session      Start → the runner (?s=), header "Weakness drill", items alternate own / puzzle; every item solved and
//                graded with the P5 runner helpers; the summary eyebrow "{label} drill · N positions"; the bank's
//                daily cap is untouched (TR-1 capRemaining before = after); weakness_drill_started
//   time pressure  (FIX-2) weak-member's blunder rate falls with the clock: no time-pressure row or headline next to the
//                Clock tab's sentence; a time-pressure drill (TR-7) holds own positions only, each one of the member's
//                mistakes tagged rc:timePressure (SQL). The config's disabled mix and its reason are drawn by the
//                drill_time_pressure demo state and the component tests (no fake-engine persona has a rising rate).
import { randomUUID } from "node:crypto";
import {
  DEVICES,
  expect,
  forbidSolutions,
  itemsById,
  openSummary,
  openWeakness,
  sessionPayload,
  solveAndGradeAll,
  test,
  tr5,
  waitForSession,
  weakStateTags,
  type Row,
} from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

type Today = { data: { due: { capRemaining: number; cap: number } } };

test.describe("weakness drill · desktop-1440@100", { tag: ["@p6", ...weakStateTags("drill")] }, () => {
  test("config 10 / 20 / mix, the session in the runner, the summary, the bank cap @smoke", async ({ page, weak, telemetry }) => {
    test.setTimeout(900_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    expect(p.status).toBe("ready");
    const row = [...p.top, ...p.more].find((r) => r.matchable && r.inBank > 0) as Row | undefined;
    expect(row, "the member has a matchable row with positions in the bank").toBeTruthy();
    const rating = p.rating;
    const capBefore = ((await (await page.request.get("/api/train/today")).json()) as Today).data.due;

    await openWeakness(page, "ready");
    const r = page.locator(`[data-testid="weakness-row"][data-pattern="${row!.pattern}"]`).first();
    if ((await r.getAttribute("data-open")) === null) {
      if (p.more.some((m) => m.pattern === row!.pattern)) await page.getByTestId("weakness-see-all").click();
      await r.getByTestId("weakness-row-head").click();
    }
    await r.getByText(`Drill · ${row!.inBank} in bank`).click();
    await expect(page).toHaveURL(new RegExp(`/train/weakness/${row!.slug}$`));
    // regression: weakness-telemetry-unasserted (FIX-1, plan §10.1): the opening is captured once, from the row.
    await telemetry.expect("weakness_drill_opened", { pattern: row!.pattern, surface: "inline", entry: "row" }, { count: 1 });
    const config = page.getByTestId("weakness-drill-config");
    await expect(config).toHaveAttribute("data-size", "10");
    await expect(config).toHaveAttribute("data-mix", "on");
    const near = rating === null ? "at your level" : `near ${rating}`;
    const own = (size: number) => Math.min(Math.round(size * 0.6), row!.inBank);
    await expect(page.getByTestId("weakness-drill-mixline")).toHaveText(`${own(10)} from your games + ${10 - own(10)} matched Lichess puzzles ${near}`);
    await page.getByTestId("weakness-drill-size").getByRole("radio", { name: /20/ }).click();
    await expect(config).toHaveAttribute("data-size", "20");
    await expect(page.getByTestId("weakness-drill-mixline")).toHaveText(`${own(20)} from your games + ${20 - own(20)} matched Lichess puzzles ${near}`);
    await expect(page.getByTestId("weakness-drill-start")).toHaveText(/^Start drill · 20 positions · ~\d+ min$/);
    await page.getByTestId("weakness-drill-mix").click();
    await expect(config).toHaveAttribute("data-mix", "off");
    await expect(page.getByTestId("weakness-drill-mixline")).toHaveText(`${Math.min(20, row!.inBank)} from your games only (${row!.inBank} in your bank)`);
    await telemetry.expect("weakness_drill_configured", { pattern: row!.pattern, size: 20, mix: false });
    // Back to 10 + mix, then start.
    await page.getByTestId("weakness-drill-mix").click();
    await page.getByTestId("weakness-drill-size").getByRole("radio", { name: /10/ }).click();
    await expect(config).toHaveAttribute("data-mix", "on");
    await page.getByTestId("weakness-drill-start").click();
    const ref = await waitForSession(page);
    expect(page.url()).toMatch(/\/train\/bank\/session\?s=/);
    const payload = await sessionPayload(page.request, ref);
    expect(payload.kind).toBe("weakness");
    const kinds = payload.items.filter((i) => i.pass === 1).map((i) => (i.kind === "puzzle" ? "p" : "o")).join("");
    expect(kinds, "own and puzzle items alternate").toMatch(/^(op)+o*p*$/);
    expect(kinds.length).toBe(10);
    forbidSolutions(telemetry, payload.items);
    await expect(page.getByRole("heading", { name: "Weakness drill" }).filter({ visible: true }).first()).toBeVisible();
    await telemetry.expect("weakness_drill_started", { pattern: row!.pattern, size: 10, mix: true, result: "ok" }, { count: 1 });
    // regression: weakness-session-events-unasserted (FIX-2, plan §10.1): P5's session events with the P6 values: the
    // kind `weakness`, the theme = the pattern key, the source of the screen that created it, once each.
    await telemetry.expect(
      "train_session_started",
      { kind: "weakness", theme: row!.pattern, source: "weakness", resumed: false, size: 10 },
      { count: 1, source: "client" },
    );
    const graded = await solveAndGradeAll(page, itemsById(payload), 30);
    expect(graded).toBeGreaterThanOrEqual(10);
    await openSummary(page);
    await expect(page.getByText(new RegExp(`${row!.label} drill · \\d+ positions?`, "i")).first()).toBeVisible({ timeout: 60_000 });
    await telemetry.expect("train_session_completed", { kind: "weakness", total: 10 }, { count: 1, source: "client" });
    const capAfter = ((await (await page.request.get("/api/train/today")).json()) as Today).data.due;
    expect(capAfter.capRemaining, "a weakness drill never spends the bank's daily cap").toBe(capBefore.capRemaining);
    expect(capAfter.cap).toBe(capBefore.cap);
  });

  test("Esc on the config returns to the profile", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    const row = p.top.find((r) => r.matchable)!;
    await page.goto(`/train/weakness/${row.slug}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("weakness-drill-config")).toBeVisible({ timeout: 120_000 });
    // regression: weakness-focus-lost (FIX-1, WCAG 2.4.3): a direct load puts the focus in the inline config …
    await expect(page.getByTestId("weakness-drill-config")).toBeFocused();
    await page.getByTestId("weakness-drill-start").focus();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/train\/weakness(\?|$)/);
    // … and Esc gives it back to the row it came from, never to <body>.
    await expect
      .poll(() => page.evaluate(() => (document.activeElement?.closest("[data-testid=weakness-row]") as HTMLElement | null)?.dataset.pattern ?? document.activeElement?.tagName))
      .toBe(row.pattern);
  });

  test("regression: weakness-esc-back — after a click opened the config and Esc closed it, the first Back leaves the profile", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
    await page.goto("/train", { waitUntil: "domcontentloaded" });
    await openWeakness(page, "ready");
    await expect(page).toHaveURL(/\/train\/weakness(\?|$)/);
    const r = page.locator(`[data-testid="weakness-row"][data-pattern="${row.pattern}"]`).first();
    if ((await r.getAttribute("data-open")) === null) await r.getByTestId("weakness-row-head").click();
    await r.getByText(`Drill · ${row.inBank} in bank`).click();
    await expect(page).toHaveURL(new RegExp(`/train/weakness/${row.slug}$`));
    await expect(page.getByTestId("weakness-drill-config")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/train\/weakness(\?|$)/);
    // Esc went back over the entry Drill pushed: the next Back is the page before the profile, at once.
    await page.goBack();
    await expect(page).toHaveURL(/\/train(\?|$)/);
  });

  test("keyboard: Enter on Drill moves the focus into the config; Esc returns it to the Drill link", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    const row = p.top.find((r) => r.matchable && r.inBank > 0)!;
    await openWeakness(page, "ready");
    const r = page.locator(`[data-testid="weakness-row"][data-pattern="${row.pattern}"]`).first();
    if ((await r.getAttribute("data-open")) === null) await r.getByTestId("weakness-row-head").click();
    const link = r.getByTestId("weakness-drill");
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/train/weakness/${row.slug}$`));
    await expect(page.getByTestId("weakness-drill-config")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/train\/weakness(\?|$)/);
    await expect(r.getByTestId("weakness-drill")).toBeFocused();
  });

  test("the week plan's drill opens the top row's config; weakness_week_plan_clicked", async ({ page, weak, telemetry }) => {
    test.setTimeout(600_000);
    await weak("weak-member");
    const p = await tr5(page.request);
    const top = p.top[0]!;
    await openWeakness(page, "ready");
    // regression: weakness-telemetry-unasserted (FIX-1, plan §10.1).
    await page.getByTestId("weakness-plan-drill").click();
    await expect(page).toHaveURL(new RegExp(`/train/weakness/${top.slug}$`));
    await telemetry.expect("weakness_week_plan_clicked", { kind: "drill", pattern: top.pattern }, { count: 1 });
    await telemetry.expect("weakness_drill_opened", { pattern: top.pattern, surface: "inline", entry: "plan" }, { count: 1 });
    await expect(page.getByTestId("weakness-drill-config")).toBeFocused();
  });

  test("time pressure: no row when the Clock tab's rate does not rise; a time-pressure drill is own positions only, each under a minute", async ({ page, weak, reviewDb }) => {
    test.setTimeout(600_000);
    const lease = await weak("weak-member");
    const p = await tr5(page.request);
    // regression: tp-headline-contradicts-clock (FIX-2, D-P6-FIX2-6): weak-member's blunder rate FALLS as its clock runs
    // down (its real games graded by the e2e worker): no time-pressure row, no time-pressure headline, so nothing on
    // the screen contradicts the Clock tab's sentence.
    const clock = p.breakdown?.clock;
    expect(clock, "the member has a Clock tab").toBeTruthy();
    expect(clock!.sentence).toMatch(/drops|stays about the same/);
    expect([...p.top, ...p.more].find((r) => r.pattern === "rc:timePressure"), "no time-pressure row next to a falling rate").toBeUndefined();
    expect(p.headline?.text ?? "").not.toMatch(/under a minute/);
    await openWeakness(page, "ready");
    await page.getByTestId("weakness-tab-clock").click();
    await expect(page.getByTestId("weakness-clock")).toContainText(clock!.sentence);
    // The drill itself (TR-7, the composer the config previews) on the member's real bank: puzzles have no clock, so
    // a time-pressure drill holds the member's own positions only, every one a mistake made under a minute.
    const created = await page.request.post("/api/train/sessions", {
      data: { kind: "weakness", pattern: "rc:timePressure", size: 10, mix: true },
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const ref = ((await created.json()) as { data: { ref: string } }).data.ref;
    await page.goto(`/train/bank/session?s=${ref}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trainer-board").filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    const payload = await sessionPayload(page.request, ref);
    expect(payload.items.filter((i) => i.kind === "puzzle"), "no puzzle in a time-pressure drill").toEqual([]);
    const keys = [...new Set(payload.items.map((i) => i.cardRef).filter((k): k is string => Boolean(k)))];
    expect(keys.length).toBeGreaterThan(0);
    // The card keys are position hashes: another member drilling the same position has a card with the same key.
    const [tagged] = await reviewDb.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT c."itemKey")::int AS n FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
        JOIN users u ON u.id = c."userId"
       WHERE lower(u.email) = lower(${lease.email}) AND c."itemKey" = ANY(${keys}::text[]) AND 'rc:timePressure' = ANY(m.themes)`;
    expect(tagged!.n, "every item is a mistake made under a minute").toBe(keys.length);
  });
});
