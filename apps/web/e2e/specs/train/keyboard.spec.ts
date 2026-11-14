// The trainer's keys (phase-05 plan §12.4 `keyboard.spec.ts`; §4.4 "Interactions and keys", §4.5 "Keys"; SPEC D20,
// WCAG 2.1.4). @p5 @local-only
//
// Shared member I on desktop-1440 (read-mostly: it only adds attempts to its own new puzzle sessions, never asserts an
// absolute count), puzzles from the CI shard server:
//   H once → the hint (`train_hint_used {step: 1}`), H again → the arrow (step 2); S → the solution, the grade bar with
//   Again suggested; 1 → Again; focus moves to the next position's status line; a first-try solve then Enter → the
//   suggested grade; 4 → Easy on the next one; T opens the theme picker and Esc closes it.
//   With the Single-Key Shortcuts switch off (rc-single-key-shortcuts = "0") H, S and T do nothing.
import type { Page } from "@playwright/test";
import {
  DEVICES,
  expect,
  forbidSolutions,
  gotoOk,
  gradeBar,
  itemOf,
  itemsById,
  nextItem,
  sessionPayload,
  solveItem,
  stateTags,
  test,
  waitForSession,
} from "./_lib/train";

test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

const body = async (page: Page) => page.locator("body").click({ position: { x: 2, y: 2 } });

test(
  "H, H, S, 1–4, Enter, T, Esc on the runner; the single-key switch turns them off",
  { tag: ["@p5", "@local-only", ...stateTags("puzzle", "hint", "solution", "themes")] },
  async ({ member, page, telemetry }) => {
    test.setTimeout(420_000);
    await member("I");
    await gotoOk(page, "/train/puzzles?theme=fork");
    const ref = await waitForSession(page);
    const payload = await sessionPayload(page.request, ref);
    forbidSolutions(telemetry, payload.items);
    const items = itemsById(payload);

    // 1: H, H, S, 1.
    let id = await nextItem(page, null);
    await body(page);
    await page.keyboard.press("h");
    await telemetry.expect("train_hint_used", { step: 1 }, { count: 1, source: "client" });
    await page.keyboard.press("h");
    await telemetry.expect("train_hint_used", { step: 2 }, { count: 1, source: "client" });
    await page.keyboard.press("s");
    await expect(gradeBar(page)).toBeVisible({ timeout: 60_000 });
    await expect(gradeBar(page).locator("[data-suggested]")).toHaveAttribute("data-grade", "again");
    await telemetry.expect("train_solution_shown", { after_wrong: false }, { count: 1, source: "client" });
    await page.keyboard.press("1");
    await telemetry.expect("train_item_graded", { grade: "again", suggested: "again" }, { count: 1, source: "client" });

    // Focus follows to the next position's status line.
    id = await nextItem(page, id);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? ""), { timeout: 15_000 }).toBe("trainer-status");

    // 2: a first-try solve, Enter = the suggested grade.
    await solveItem(page, itemOf(items, id));
    await expect(gradeBar(page)).toBeVisible({ timeout: 60_000 });
    const suggestedGrade = await gradeBar(page).locator("[data-suggested]").getAttribute("data-grade");
    await body(page);
    await page.keyboard.press("Enter");
    await telemetry.expect("train_item_graded", { grade: suggestedGrade, overridden: false, first_try: true }, { count: 1, source: "client" });

    // 3: 4 = Easy.
    id = await nextItem(page, id);
    await solveItem(page, itemOf(items, id));
    await expect(gradeBar(page)).toBeVisible({ timeout: 60_000 });
    await body(page);
    await page.keyboard.press("4");
    await telemetry.expect("train_item_graded", { grade: "easy" }, { count: 1, source: "client" });

    // T opens the picker, Esc closes it.
    id = await nextItem(page, id);
    await body(page);
    await page.keyboard.press("t");
    await expect(page.getByTestId("trainer-themes")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trainer-themes")).toBeHidden();
    // T toggles (§4.5, §4.6): a second T closes it, with focus inside the picker (FIX-1). On desktop it is a popover.
    await body(page);
    await page.keyboard.press("t");
    await expect(page.getByTestId("trainer-themes")).toBeVisible();
    await expect(page.getByTestId("trainer-themes")).toHaveAttribute("data-surface", "popover");
    await page.keyboard.press("t");
    await expect(page.getByTestId("trainer-themes")).toBeHidden();
    // Arrows move between the rows (FIX-2, §4.6 "arrows move, Enter picks"); Esc returns focus to the opener.
    await page.getByTestId("trainer-theme-button").focus();
    await page.keyboard.press("Enter");
    const picker = page.getByTestId("trainer-themes");
    await expect(picker).toBeVisible();
    const focusedTheme = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.theme ?? document.activeElement?.tagName ?? null);
    await page.keyboard.press("ArrowDown");
    const first = await focusedTheme();
    await page.keyboard.press("ArrowDown");
    const second = await focusedTheme();
    expect(second).not.toBe(first);
    await page.keyboard.press("ArrowUp");
    expect(await focusedTheme()).toBe(first);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(page.getByTestId("trainer-theme-button")).toBeFocused();

    // The single-key switch off: H, S and T do nothing.
    await page.evaluate(() => localStorage.setItem("rc-single-key-shortcuts", "0"));
    await page.reload();
    await nextItem(page, null);
    const hintsBefore = (await telemetry.events("client")).filter((e) => e.event === "train_hint_used").length;
    await body(page);
    for (const k of ["h", "s", "t"]) await page.keyboard.press(k);
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("trainer-themes")).toBeHidden();
    await expect(gradeBar(page)).toBeHidden();
    expect((await telemetry.events("client")).filter((e) => e.event === "train_hint_used").length).toBe(hintsBefore);
    await page.evaluate(() => localStorage.removeItem("rc-single-key-shortcuts"));
  },
);
