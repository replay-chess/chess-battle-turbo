// The P5 Train screens in the device × zoom suite (phase-05 plan §12.4 `e2e/devices/layout/train.spec.ts`; §4.2–§4.7,
// §9.6 "CLS on runner pages"; TST X9). @p5
//
// Tiered by playwright.devices.config.ts: PR = desktop-1440@100, desktop-1280@125, iphone@100, ipad-portrait@100;
// nightly = all 40 projects (on `next start` in CI).
//
//   demo routes  /dev/ui/train/{hub,bank,runner,puzzles,summary} in every state (the real screen components on contract
//                fixtures): the document never scrolls and nothing escapes the viewport (lock mode); on the runners the
//                board is square, ≥ 220 px, unoccluded and inside the viewport, the Hint is visible while solving and
//                the grade bar after a solve, no tab bar (immersive); at ≤ 620 px of height (150 % on desktop) the
//                `.tr-tall` lines are hidden; the tap-target floors hold. `stress=1` (300-row bank, 40-character
//                opponent names, 3-digit move numbers, both colours, 365-day streak) runs at 150 %.
//   real routes  signed in as a pool user leased to `bank-member` on REAL_PROJECTS: /train, /train/bank, the bank drill
//                and a puzzle session (`?s=`), with the same checks.
//   lab gates    (Chromium) CLS ≤ 0.02 on the runner routes at every zoom of the tier; move → verdict ≤ 50 ms and no
//                long task > 50 ms after hydration on the runner with a 4× CPU throttle (desktop-1440@100).
//
// Each demo test belongs to one device family and skips on the others, so its @demo tags name exactly the boards that
// ran (the P2/P3 pattern).
import type { Page, TestInfo } from "@playwright/test";
import { expectTapTargets, isChromium } from "../helpers";
import { familyOf, type DeviceFamily } from "../game/families";
import { expectOneViewport } from "./assertions";
import { expect, gotoStable, hasInsets, test, waitForStable } from "./fixtures";
import { BANK_DEMO_STATES, HUB_DEMO_STATES, PUZZLE_DEMO_STATES, RUNNER_DEMO_STATES, SUMMARY_DEMO_STATES, runnerDemo } from "../../../app/dev/ui/_fixtures/train";

const STRESS_ZOOM = 1.5;
const CLS_BUDGET = 0.02;
/** The real-route layer runs here (the projects of routes.real.ts). */
const REAL_PROJECTS = new Set(["desktop-1440@100", "desktop-1440@150", "iphone@100", "iphone@125", "ipad-portrait@100"]);

/** Device boards per family (docs/qa/design-states.json, P5). */
const PREFIX: Record<Exclude<DeviceFamily, "desktop">, string> = {
  iphone: "V3iPhone",
  android: "V3Android",
  "ipad-portrait": "V3iPadP",
  "ipad-landscape": "V3iPadL",
};

type Kind = "hub" | "bank" | "runner" | "puzzles" | "summary";
type Route = { kind: Kind; state: string; path: string; ready: string };

const DESKTOP_TAGS: Record<Kind, (state: string) => string[]> = {
  hub: (s) => (["default", "nothingdue", "loading"].includes(s) ? ["V3TrainHub", "V3TrainHubDone", "V3TrainHubLoading"].map((b) => `@demo:${b}.${s}`) : []),
  bank: (s) =>
    ["default", "filtered"].includes(s)
      ? [`@demo:V3MistakeBank.${s}`]
      : ["empty", "caughtup", "loading"].includes(s)
        ? [...["V3BankEmpty", "V3BankCaughtUp", "V3BankLoading"].map((b) => `@demo:${b}.${s}`), ...(s === "loading" ? ["@demo:V3MistakeBank.loading"] : [])]
        : [],
  runner: (s) => (["solve", "hint", "wrong", "correct", "solution", "themes"].includes(s) ? [`@demo:V3BankSession.${s}`] : []),
  puzzles: (s) =>
    ["solve", "hint", "wrong", "correct", "solution", "themes"].includes(s)
      ? ["V3PuzzleSolve", "V3PuzzleHint", "V3PuzzleWrong", "V3PuzzleCorrect", "V3PuzzleSolution", "V3PuzzleThemes"].map((b) => `@demo:${b}.${s}`)
      : [],
  summary: (s) => (["default", "perfect"].includes(s) ? ["V3SessionSummary", "V3SessionPerfect"].map((b) => `@demo:${b}.${s}`) : []),
};

function deviceTags(prefix: string, kind: Kind, s: string): string[] {
  switch (kind) {
    case "hub":
      return ["default", "nothingdue", "loading"].includes(s) ? [`@demo:${prefix}TrainHub.${s}`] : [];
    case "bank":
      if (s === "default" || s === "filtered") return [`@demo:${prefix}MistakeBank.${s}`];
      if (s === "loading") return [`@demo:${prefix}MistakeBank.loading`, `@demo:${prefix}Bank.loading`];
      return ["due", "empty", "caughtup"].includes(s) ? [`@demo:${prefix}Bank.${s}`] : [];
    case "runner":
    case "puzzles":
      // The puzzle device boards are the runner on that device (bank and theme mode share them).
      return ["solve", "hint", "wrong", "correct", "solution", "themes"].includes(s) ? [`@demo:${prefix}Puzzle.${s}`] : [];
    default:
      return [];
  }
}

function tagsFor(family: DeviceFamily, r: Route): string[] {
  return family === "desktop" ? DESKTOP_TAGS[r.kind](r.state) : deviceTags(PREFIX[family], r.kind, r.state);
}

const RUNNER_READY = '[data-testid="trainer"], [data-testid="trainer-empty"], [data-testid="trainer-error"]';
const ROUTES: Route[] = [
  ...HUB_DEMO_STATES.map((s) => ({ kind: "hub" as const, state: s, path: `/dev/ui/train/hub?state=${s}`, ready: '[data-testid="train-hub"]' })),
  { kind: "hub", state: "loading-route", path: "/dev/ui/train/hub?state=loading&route=1", ready: '[data-testid="train-hub"]' },
  ...BANK_DEMO_STATES.map((s) => ({ kind: "bank" as const, state: s, path: `/dev/ui/train/bank?state=${s}`, ready: '[data-testid="train-bank"]' })),
  { kind: "bank", state: "filter-open", path: "/dev/ui/train/bank?state=filtered&open=1", ready: '[data-testid="bank-filter-panel"]' },
  { kind: "bank", state: "remove", path: "/dev/ui/train/bank?state=remove", ready: '[data-testid="train-bank"]' },
  ...RUNNER_DEMO_STATES.map((s) => ({ kind: "runner" as const, state: s, path: `/dev/ui/train/runner?state=${s}`, ready: RUNNER_READY })),
  ...PUZZLE_DEMO_STATES.map((s) => ({ kind: "puzzles" as const, state: s, path: `/dev/ui/train/puzzles?state=${s}`, ready: RUNNER_READY })),
  ...SUMMARY_DEMO_STATES.map((s) => ({ kind: "summary" as const, state: s, path: `/dev/ui/train/summary?state=${s}`, ready: '[data-testid="session-summary"]' })),
];

/** Runner states that show the board (the empty and error states are a card). */
const BOARDLESS = new Set(["caughtup", "cap_reached", "nothing_matches", "broken"]);
/** The grade bar shows after a solve or the solution; Hint shows while the first move is still to find. */
const GRADED = new Set(["correct", "solution"]);
const SOLVING = new Set(["solve", "hint", "hint_arrow", "resumed"]);

async function noDocumentScroll(page: Page, what: string): Promise<void> {
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
  }));
  expect(m.sh, `${what}: the document does not scroll vertically`).toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, `${what}: no horizontal page scroll`).toBeLessThanOrEqual(m.iw + 1);
}

async function inViewport(page: Page, selector: string, what: string): Promise<void> {
  const el = page.locator(selector).filter({ visible: true }).first();
  await expect(el, `${what} visible`).toBeVisible();
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1, `${what} inside the viewport`).toBe(true);
}

/** The runner's checks (demo and real routes). */
async function checkRunner(page: Page, state: string): Promise<void> {
  if (BOARDLESS.has(state)) {
    await noDocumentScroll(page, state);
    return;
  }
  if (state === "themes" && (await page.getByTestId("trainer-themes").isVisible())) {
    // The theme picker is a modal over the board (popover-sized dialog on desktop, sheet on phones): it fits the
    // viewport and its first theme is in view; the board under it is meant to be covered.
    await noDocumentScroll(page, state);
    await inViewport(page, '[data-testid="trainer-themes"] [data-theme]', "the first theme");
    // FIX-2: More Themes lines up with the rows' text.
    const pads = await page.locator('[data-testid="trainer-themes"] details > summary').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).paddingLeft)));
    for (const p of pads) expect(p, "More Themes padding").toBeGreaterThanOrEqual(14);
    return;
  }
  await expectOneViewport(page, { board: true });
  const sq = await page.locator('[data-testid="trainer-board"] > div:not([data-next]) [data-square="a1"]').first().boundingBox();
  expect(sq, "a1 on screen").not.toBeNull();
  expect(sq!.width, "squares ≥ 220/8 px").toBeGreaterThanOrEqual(27.5);
  await expect(page.locator("[data-rc-tabbar]:visible"), "no tab bar on the runner").toHaveCount(0);
  // The grade bar, or on very short phones (Safari at 150 %) the same four grades in the control bar (FIX-1).
  if (GRADED.has(state)) await inViewport(page, '[data-testid="trainer-grades"], [data-testid="trainer-grades-compact"]', "the grade bar");
  if (SOLVING.has(state)) await inViewport(page, '[data-testid="trainer-hint"], [data-testid="trainer-hint-phone"]', "Hint");
  const vh = await page.evaluate(() => innerHeight);
  if (vh <= 620) {
    const tall = await page.locator("[data-rc-trainer] .tr-tall").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").length);
    expect(tall, "the .tr-tall lines hide at ≤ 620 px").toBe(0);
  }
  // FIX-2: a bank item's game is reachable on every device: the line under the board (its link's 44 px hit area not
  // clipped by an ancestor, underlined), or on a short phone the ⋯ menu's See It in Your Game.
  const bankItem = await page.locator('[data-testid="trainer-label-bottom"][data-game]').count();
  if (bankItem > 0) {
    const link = page.locator('[data-testid="trainer-see-in-game"]');
    if (await link.isVisible()) {
      const hit = await link.evaluate((a) => {
        const r = a.getBoundingClientRect();
        let top = r.top;
        let bottom = r.bottom;
        for (let n = a.parentElement; n && n !== document.body; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.overflow !== "visible" || cs.overflowY !== "visible") {
            const c = n.getBoundingClientRect();
            top = Math.max(top, c.top);
            bottom = Math.min(bottom, c.bottom);
          }
        }
        return { visible: bottom - top, underline: getComputedStyle(a).textDecorationLine };
      });
      expect(hit.visible, "See It in Your Game: the hit area is not clipped below 44 px").toBeGreaterThanOrEqual(43);
      expect(hit.underline).toContain("underline");
    } else if (SOLVING.has(state)) {
      // While solving (the ⋯ menu is in the control bar; after a grade or a miss the bar holds the grades / Try Again).
      const menu = page.locator('[data-testid="trainer-menu-phone"]:visible, [data-testid="trainer-menu"]:visible').first();
      await menu.click();
      await expect(page.locator('[data-testid$="-see-in-game"]:visible').first(), "See It in Your Game in the ⋯ menu").toBeVisible();
      await page.keyboard.press("Escape");
    }
  }
}

async function checkRoute(page: Page, r: Route): Promise<void> {
  await gotoStable(page, r.path);
  await expect(page.locator(r.ready).first()).toBeVisible({ timeout: 30_000 });
  if (r.kind === "runner" || r.kind === "puzzles") {
    await checkRunner(page, r.state);
  } else if (r.state === "filter-open") {
    // regression: bank-filter-popover-overflow (WP-I D-I4): at desktop-1280@125 the popover ran off the viewport.
    // The filter surface (popover / sheet) may cover the page; it must fit the viewport itself.
    await noDocumentScroll(page, r.path);
    await inViewport(page, '[data-testid="bank-filter-show"]', "Show n Positions");
    // FIX-2: the phone / iPad-portrait sheet's close button is "Close filters" (V3iPhoneMistakeBank).
    if ((await page.getByTestId("bank-filter-panel").getAttribute("data-surface")) === "sheet") {
      await expect(page.getByTestId("bank-filter-panel").getByRole("button", { name: "Close filters" })).toBeVisible();
    }
  } else {
    await expectOneViewport(page);
    if (r.kind === "hub" && r.state === "default") await inViewport(page, '[data-testid="train-plan-cta"], [data-testid="train-sticky-cta-button"]', "Start Today's Plan");
    if (r.kind === "hub" && r.state === "default") {
      // FIX-2: the plan step numbers are readable (V3TrainHub 0.5 alpha; 0.15 was ≈ 1.3:1), and a due thumbnail's
      // opponent is never cut to an ellipsis.
      const alphas = await page.locator('[data-testid^="train-plan-step-"] > span:first-child').evaluateAll((els) =>
        els.map((e) => {
          const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).color);
          const parts = m ? m[1]!.split(",").map((x) => Number(x.trim())) : [];
          return parts.length === 4 ? parts[3]! : 1;
        }),
      );
      for (const a of alphas) expect(a, "step number alpha").toBeGreaterThanOrEqual(0.5);
      const cut = await page.locator('[data-testid="train-due-thumb-opponent"]:visible').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      expect(cut, "due thumbnails: the opponent is not truncated").toBe(0);
    }
    if (r.kind === "bank" && r.state === "default" && (await page.getByTestId("bank-detail").isVisible())) {
      // FIX-2 (§4.3 desktop): the judgement line under the board, and the mastery line where the screen is ≥ 640 px tall.
      await expect(page.getByTestId("bank-detail-meta")).toBeVisible();
      if ((await page.evaluate(() => innerHeight)) > 640) await expect(page.getByTestId("bank-detail-mastery")).toBeVisible();
    }
    if (r.kind === "summary") await inViewport(page, '[data-testid="summary-back"]', "Back to Train");
  }
  await expect(page.locator("[data-sonner-toast]:visible").filter({ hasNotText: /Undo/ }), "no toast over the screen").toHaveCount(0);
  await expectTapTargets(page, { root: "[data-rc-main]" });
}

const FAMILIES: DeviceFamily[] = ["desktop", "ipad-landscape", "ipad-portrait", "iphone", "android"];

for (const family of FAMILIES) {
  test.describe(`train screens one viewport · ${family} @p5`, () => {
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(familyOf(testInfo) !== family, `${family} test`);
    });
    for (const r of ROUTES) {
      test(r.path, { tag: tagsFor(family, r) }, async ({ page }) => {
        await checkRoute(page, r);
      });
      test(`${r.path}&stress=1`, async ({ page }, testInfo: TestInfo) => {
        test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
        await checkRoute(page, { ...r, path: `${r.path}&stress=1` });
      });
    }
  });
}

// ── Lab gates ─────────────────────────────────────────────────────────────────────────────────────────────────────
for (const path of ["/dev/ui/train/runner?state=solve", "/dev/ui/train/puzzles?state=solve", "/dev/ui/train/runner?state=correct"]) {
  test(`CLS ≤ ${CLS_BUDGET} on load: ${path} @p5`, async ({ page }, testInfo) => {
    test.skip(!isChromium(testInfo), "layout-shift entries are Chromium-only");
    test.skip(hasInsets(testInfo), "projects without insets only (the inset emulation re-lays out the page once)");
    await page.addInitScript(() => {
      const w = window as unknown as { __rcCls: number };
      w.__rcCls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!e.hadRecentInput) w.__rcCls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await gotoStable(page, path);
    await expect(page.locator('[data-testid="trainer-board"]').first()).toBeVisible();
    await page.waitForTimeout(1_500);
    const cls = await page.evaluate(() => (window as unknown as { __rcCls: number }).__rcCls);
    expect(cls, `cumulative layout shift on ${testInfo.project.name}`).toBeLessThanOrEqual(CLS_BUDGET);
  });
}

test("move → verdict ≤ 50 ms and no long task after hydration, 4× CPU throttle @p5", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440@100", "desktop-1440@100 only (a CDP throttle)");
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __rcLong: number[] };
    w.__rcLong = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__rcLong.push(e.duration);
    }).observe({ type: "longtask", buffered: false });
  });
  await gotoStable(page, "/dev/ui/train/runner?state=solve");
  const board = page.getByTestId("trainer-board");
  await expect(board).toHaveAttribute("data-input", "", { timeout: 30_000 });
  await waitForStable(page);
  await page.evaluate(() => {
    (window as unknown as { __rcLong: number[] }).__rcLong = [];
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const item = runnerDemo("solve").payload.items[0]!;
  const uci = item.solution[0]!;
  const sq = (s: string) => page.locator(`[data-testid="trainer-board"] > div:not([data-next]) [data-square="${s}"]`).first();
  await sq(uci.slice(0, 2)).click();
  await sq(uci.slice(2, 4)).click();
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("rc:train-move-verdict", "measure").length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const verdict = await page.evaluate(() => performance.getEntriesByName("rc:train-move-verdict", "measure").at(-1)!.duration);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  testInfo.annotations.push({ type: "move-verdict-ms", description: String(Math.round(verdict)) });
  expect(verdict, "move → verdict with a 4× CPU throttle").toBeLessThanOrEqual(50);
  const longTasks = await page.evaluate(() => (window as unknown as { __rcLong: number[] }).__rcLong);
  expect(longTasks.filter((d) => d > 50), "no long task > 50 ms after hydration").toEqual([]);
});

// ── Real routes ───────────────────────────────────────────────────────────────────────────────────────────────────
test("real routes: /train, /train/bank, the bank drill and a puzzle session as bank-member @p5", async ({ page }, testInfo) => {
  test.skip(!REAL_PROJECTS.has(testInfo.project.name), `real routes run on ${[...REAL_PROJECTS].join(", ")}`);
  test.setTimeout(300_000);
  const { clerkSetup } = await import("@clerk/testing/playwright");
  await clerkSetup();
  const { signIn } = await import("../../fixtures/auth");
  const { leasePersona } = await import("../../fixtures/lease");
  const { poolEmail, poolSlot } = await import("../../fixtures/users");
  await signIn(page, poolEmail(poolSlot(testInfo.parallelIndex, 0)), "");
  await leasePersona("bank-member", testInfo);

  for (const [path, ready] of [
    ["/train", '[data-testid="train-hub"][data-state="default"]'],
    ["/train/bank", '[data-testid="train-bank"][data-state="default"]'],
  ] as const) {
    await test.step(path, async () => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
      expect(res?.status()).toBe(200);
      await expect(page.locator(ready)).toBeVisible({ timeout: 60_000 });
      await waitForStable(page);
      await expectOneViewport(page);
    });
  }
  for (const path of ["/train/bank/session", "/train/puzzles?theme=fork"]) {
    await test.step(path, async () => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(/[?&]s=c[a-z0-9]+/, { timeout: 60_000 });
      await expect(page.getByTestId("trainer-board")).toHaveAttribute("data-input", "", { timeout: 60_000 });
      await waitForStable(page);
      await checkRunner(page, "solve");
    });
  }
});
