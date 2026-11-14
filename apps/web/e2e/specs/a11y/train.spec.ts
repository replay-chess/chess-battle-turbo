// axe on every P5 screen state (phase-05 plan §12.4 `a11y/train.spec.ts`; §4 accessibility notes; SPEC 5.2). @p5
//
// Every demo state of /dev/ui/train/{hub,bank,runner,puzzles,summary} and /dev/ui/home (the real screen components on
// contract fixtures, no server) in light and dark on desktop-1440, and the main states on iPhone: no WCAG 2.1 A/AA
// violation (axe, ../../devices/a11y.ts). On the runner's graded state the four grade buttons are at least 48 px high
// and the live region says "Correct." exactly once.
import { DEVICES, expect, test, type DeviceName } from "../train/_lib/train";
import { expectNoAxeViolations } from "../../devices/a11y";
import {
  BANK_DEMO_STATES,
  HOME_DEMO_STATES,
  HUB_DEMO_STATES,
  PUZZLE_DEMO_STATES,
  RUNNER_DEMO_STATES,
  SUMMARY_DEMO_STATES,
} from "../../../app/dev/ui/_fixtures/train";

type Screen = { path: string; ready: string };

const DESKTOP: Screen[] = [
  ...HUB_DEMO_STATES.map((s) => ({ path: `/dev/ui/train/hub?state=${s}`, ready: '[data-testid="train-hub"]' })),
  { path: "/dev/ui/train/hub?state=loading&route=1", ready: '[data-testid="train-hub"]' },
  ...[...BANK_DEMO_STATES, "remove"].map((s) => ({ path: `/dev/ui/train/bank?state=${s}`, ready: '[data-testid="train-bank"]' })),
  { path: "/dev/ui/train/bank?state=filtered&open=1", ready: '[data-testid="bank-filter-panel"]' },
  ...RUNNER_DEMO_STATES.map((s) => ({ path: `/dev/ui/train/runner?state=${s}`, ready: '[data-testid="trainer"], [data-testid="trainer-empty"], [data-testid="trainer-error"]' })),
  ...PUZZLE_DEMO_STATES.map((s) => ({ path: `/dev/ui/train/puzzles?state=${s}`, ready: '[data-testid="trainer"], [data-testid="trainer-error"]' })),
  ...SUMMARY_DEMO_STATES.map((s) => ({ path: `/dev/ui/train/summary?state=${s}`, ready: '[data-testid="session-summary"]' })),
  ...HOME_DEMO_STATES.map((s) => ({ path: `/dev/ui/home?state=${s}`, ready: '[data-testid="home"], [data-testid="home-loading"]' })),
];

const PHONE: Screen[] = [
  { path: "/dev/ui/train/hub?state=default", ready: '[data-testid="train-hub"]' },
  { path: "/dev/ui/train/hub?state=nothingdue", ready: '[data-testid="train-hub"]' },
  { path: "/dev/ui/train/bank?state=due", ready: '[data-testid="train-bank"]' },
  { path: "/dev/ui/train/bank?state=filtered&open=1", ready: '[data-testid="bank-filter-panel"]' },
  { path: "/dev/ui/train/runner?state=solve", ready: '[data-testid="trainer"]' },
  { path: "/dev/ui/train/runner?state=correct", ready: '[data-testid="trainer"]' },
  { path: "/dev/ui/train/puzzles?state=themes", ready: '[data-testid="trainer"]' },
  { path: "/dev/ui/train/summary?state=default", ready: '[data-testid="session-summary"]' },
  { path: "/dev/ui/home?state=populated", ready: '[data-testid="home"]' },
  { path: "/dev/ui/home?state=new_user", ready: '[data-testid="home"]' },
];

for (const [device, screens] of [["desktop-1440", DESKTOP], ["iphone", PHONE]] as [DeviceName, Screen[]][]) {
  test.describe(`P5 axe · ${device}`, { tag: ["@p5"] }, () => {
    test.use(DEVICES[device]);
    for (const s of screens) {
      test(`${s.path} light and dark`, async ({ page }) => {
        test.setTimeout(120_000);
        const res = await page.goto(s.path);
        expect(res?.status()).toBe(200);
        await expect(page.locator(s.ready).first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(800);
        for (const theme of ["light", "dark"] as const) await expectNoAxeViolations(page, { theme });
      });
    }
  });
}

test("the graded runner: 48 px grade buttons, one polite \"Correct.\"", { tag: ["@p5"] }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.goto("/dev/ui/train/runner?state=correct");
  expect(res?.status()).toBe(200);
  const bar = page.getByTestId("trainer-grades").filter({ visible: true }).first();
  await expect(bar).toBeVisible({ timeout: 60_000 });
  for (const g of ["again", "hard", "good", "easy"]) {
    const box = await bar.locator(`[data-grade="${g}"]`).boundingBox();
    expect(box?.height, `${g} button height`).toBeGreaterThanOrEqual(48);
  }
  const live = page.locator('.tr-live[aria-live="polite"]').filter({ visible: true }).first();
  await expect(live).toContainText("Correct.");
  expect(((await live.textContent()) ?? "").split("Correct.").length - 1, "announced once").toBe(1);
});
