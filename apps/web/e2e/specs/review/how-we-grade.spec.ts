// How we grade (phase-03 plan §12.3 `how-we-grade.spec.ts` @public; owner test T15), signed out on desktop-1440@100 and
// iphone@100: the Move Labels and Accuracy tabs (roving tab index), the #blunder anchor, the formula numbers equal the
// worker's own constants (imported from @repo/chess-analysis), and Pricing in the nav (flow edge E2).
import { ACC_A, ACC_B, ACC_BONUS, ACC_C } from "@repo/chess-analysis/accuracy";
import { SEVERITY } from "@repo/chess-analysis/classify";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { clickUntil, DEVICES, expect, gotoOk, test } from "./_lib/review";

for (const device of ["desktop-1440", "iphone"] as const) {
  test.describe(`how we grade · ${device}@100`, { tag: ["@p3", "@public"] }, () => {
    test.use(DEVICES[device]);
  test("tabs, the #blunder anchor, the grader's numbers and the Pricing link", { tag: ["@state:V3HowWeGrade.default"] }, async ({ page, telemetry }) => {
    await gotoOk(page, "/how-we-grade");
    await expect(page.getByRole("heading", { level: 1, name: "How we grade" })).toBeVisible();
    await expect(page.getByTestId("hwg-nav-auth")).toHaveAttribute("data-state", "signed-out");
    await telemetry.expect("how_we_grade_viewed", { tab: "labels" }, { source: "client" });
    // Move Labels: 12 rows, the Interesting row says it is not given yet.
    await expect(page.getByTestId("hwg-labels").locator("li")).toHaveCount(12);
    await expect(page.locator("#interesting")).toContainText("Not given yet");
    await expect(page.locator("#inaccuracy")).toContainText(`Loses ${SEVERITY.INACCURACY} to ${SEVERITY.MISTAKE} win% points.`);
    await expect(page.locator("#blunder")).toContainText(`Loses ${SEVERITY.BLUNDER} or more win% points`);
    // Accuracy: the formula equals the constants the worker uses (with Lichess's +1).
    await page.getByRole("tab", { name: "Accuracy" }).click();
    await expect(page).toHaveURL(/[?&]tab=acc/);
    await expect(page.getByTestId("hwg-formula-accuracy")).toHaveText(
      `move accuracy = ${ACC_A.toFixed(4)} × e^(−${ACC_B.toFixed(5)} × win% loss) − ${ACC_C.toFixed(4)} + ${ACC_BONUS}`,
    );
    await expect(page.locator("#failures")).toContainText("Why analysis sometimes stops");
    // Arrow keys move between tabs (roving tabindex).
    await page.getByRole("tab", { name: "Accuracy" }).focus();
    await page.keyboard.press(device === "desktop-1440" ? "ArrowUp" : "ArrowLeft");
    await expect(page.getByRole("tab", { name: "Move Labels" })).toHaveAttribute("aria-selected", "true");
    // The #blunder hash opens Move Labels and scrolls the row into view.
    await page.goto("/how-we-grade?tab=acc#blunder");
    await expect(page.getByRole("tab", { name: "Move Labels" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#blunder")).toBeInViewport();
    // The engine line names the profile (desktop: under the tabs; phones: at the end of the panel).
    await expect(page.getByTestId("hwg-engine").filter({ visible: true }).first()).toContainText(
      ENGINE_PROFILE.pass1.nodes.toLocaleString("en-US"),
    );
    // Flow edge E2: Pricing in the nav.
    await clickUntil(page.getByTestId("hwg-nav-pricing"), () => expect(page).toHaveURL(/\/pricing$/, { timeout: 5_000 }));
  });
});
}
