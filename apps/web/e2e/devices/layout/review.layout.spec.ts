// The P3 screens in the device × zoom suite (phase-03 plan §12.3 "Device × zoom layout suite", TST X9; owner test
// T19). Tiered by playwright.devices.config.ts: PR = desktop-1440@100, desktop-1280@125, iphone@100,
// ipad-portrait@100; nightly = all 40 projects. Every route also runs with `stress=1` (20-character names, a 120-ply
// game, the longest titles) on the @150 projects, where the demo supports it.
//
// The one-viewport assertion (ARCH §5.5): the document never scrolls; board screens are in lock mode with the board
// square, ≥ 220 px, unoccluded and inside the viewport with both player bars and the primary control; controls meet the
// tap-target floors (44 px for primary chrome); no tab bar on the immersive routes (review, compare, practice, game
// over); no toast over the board. Pages without a board (complete, share, the archive, How we grade, /r) assert no
// document scroll and their primary in view; the archive scrolls inside its list only.
//
// Each test belongs to one device family and skips on the others, so its @demo tags name exactly the boards that ran
// (the P2 pattern, ../game/one-viewport.spec.ts).
import type { Page, TestInfo } from "@playwright/test";
import { expectTapTargets } from "../helpers";
import { demoTags, familyOf, type DeviceFamily } from "../game/families";
import { expectOneViewport } from "./assertions";
import { expect, gotoStable, test } from "./fixtures";

/** The review boards per family (docs/qa/design-states.json, P3). Desktop draws one screen in five highlighted states. */
const REVIEW_BOARDS: Record<DeviceFamily, readonly string[]> = {
  desktop: ["V3ReviewSummary", "V3KeyMoments", "V3ReviewAnalysing", "V3ReviewClean", "V3ReviewFailed"],
  "ipad-landscape": ["V3iPadLReview"],
  "ipad-portrait": ["V3iPadPReview"],
  iphone: ["V3iPhoneReview"],
  android: ["V3AndroidReview"],
};

/** /dev/ui/review states → the boards' enum (analysing | failed | clean | summary | moment). */
const REVIEW_STATE: Record<string, string> = {
  analysing: "analysing",
  queued: "analysing",
  writing: "analysing",
  failed: "failed",
  terminal: "failed",
  summary: "summary",
  moves: "summary",
  clean: "clean",
  moment: "moment",
};

type Route = {
  path: string;
  /** A board screen in lock mode (BoardStage), checked with expectOneViewport. */
  board: boolean;
  /** Immersive: no tab bar. */
  immersive: boolean;
  /** The test id that proves the screen rendered. */
  ready: string;
  /** The primary control that must be in the viewport (pages without a board). */
  primary?: string;
  /** The demo honours stress=1. */
  stress: boolean;
  tags: (family: DeviceFamily) => string[];
};

const reviewTags = (state: string) => (family: DeviceFamily) => REVIEW_BOARDS[family].map((b) => `@demo:${b}.${REVIEW_STATE[state]}`);
const desktopOnly = (tags: string[]) => (family: DeviceFamily) => (family === "desktop" ? tags : []);

const REVIEW_STATES = ["analysing", "queued", "writing", "failed", "terminal", "summary", "moves", "clean"];
const MOMENT_PHASES = ["ask", "tried", "reveal", "line"];

const ROUTES: Route[] = [
  ...REVIEW_STATES.map((s) => ({ path: `/dev/ui/review?state=${s}`, board: true, immersive: true, ready: "review-screen", stress: true, tags: reviewTags(s) })),
  ...MOMENT_PHASES.map((p) => ({
    path: `/dev/ui/review?state=moment&phase=${p}`,
    board: true,
    immersive: true,
    ready: "moment-panel",
    stress: true,
    tags: reviewTags("moment"),
  })),
  { path: "/dev/ui/review/complete?state=default", board: false, immersive: false, ready: "review-complete", primary: "complete-primary", stress: false, tags: desktopOnly(["@demo:V3RvComplete.default", "@demo:V3RvCompleteClean.default"]) },
  { path: "/dev/ui/review/complete?state=nothing", board: false, immersive: false, ready: "review-complete", primary: "complete-primary", stress: false, tags: desktopOnly(["@demo:V3RvComplete.nothing", "@demo:V3RvCompleteClean.nothing"]) },
  { path: "/dev/ui/review/complete?state=partial", board: false, immersive: false, ready: "review-complete", primary: "complete-finish-last", stress: false, tags: () => [] },
  { path: "/dev/ui/review/share?state=generating", board: false, immersive: false, ready: "share-screen", stress: false, tags: desktopOnly(["@demo:V3RvShare.generating"]) },
  { path: "/dev/ui/review/share?state=ready", board: false, immersive: false, ready: "share-screen", stress: false, tags: desktopOnly(["@demo:V3RvShare.ready"]) },
  ...["explanation", "your_moves", "legend_moves", "practice"].map((t) => ({
    path: `/dev/ui/compare?state=default&tab=${t}`,
    board: true,
    immersive: true,
    ready: "compare-screen",
    stress: true,
    tags: desktopOnly([`@demo:V3LegendCompare.tab=${t}`]),
  })),
  ...["default", "engine_loading", "engine_failed", "offline"].map((s) => ({
    path: `/dev/ui/practice?state=${s}`,
    board: true,
    immersive: true,
    ready: "practice-screen",
    stress: true,
    tags: desktopOnly([`@demo:V3Practice.${s}`]),
  })),
  ...["default", "filters_open", "empty", "loading", "error"].map((s) => ({
    path: `/dev/ui/games?state=${s}`,
    board: false,
    immersive: false,
    ready: "games-archive",
    stress: true,
    tags: desktopOnly([`@demo:V3GamesArchive.${s}`, `@demo:V3GamesArchiveEmpty.${s}`, `@demo:V3GamesArchiveFilters.${s}`]),
  })),
  ...["analysing", "done", "legend"].map((slot) => ({
    path: `/dev/ui/game-over?slot=${slot}`,
    board: false,
    immersive: true,
    ready: "game-over-demo",
    stress: false,
    tags: (family: DeviceFamily) => {
      const state = slot === "analysing" ? "over_analysing" : slot === "legend" ? "over_legend" : null;
      if (!state) return [];
      return [...(family === "desktop" ? [`@demo:V3GameOverLegend.${state}`] : []), ...demoTags(family, state)];
    },
  })),
  { path: "/how-we-grade", board: false, immersive: false, ready: "hwg-page", stress: false, tags: desktopOnly(["@demo:V3HowWeGrade.default"]) },
];

const STRESS_ZOOM = 1.5;

/**
 * P1's tap-target floors (24 px, 44 px for primary chrome; ../helpers expectTapTargets) with the P3 exemptions:
 * - the eval graph's per-ply columns (`[data-testid="eval-graph"]`): a dense chart whose every jump has an equivalent
 *   ≥ 24 px control (the move list / strip and ←/→), the WCAG 2.5.8 "Equivalent" exception; the test checks that
 *   equivalent exists;
 * - the site footer of the public pages (How we grade): P1's marketing footer, outside the P3 screen (checked on the
 *   P3 content root instead).
 */
async function expectReviewTapTargets(page: Page, route: Route) {
  const graph = page.locator('[data-testid="eval-graph"]:visible');
  if (await graph.count()) {
    const equivalent = page.locator('[data-testid="review-moves"] button:visible, [data-testid="review-strip"] button:visible, [data-testid="nav-next"]:visible, [data-testid="bar-next"]:visible');
    expect(await equivalent.count(), "the eval graph's jumps have an equivalent control").toBeGreaterThan(0);
    await graph.evaluateAll((els) => els.forEach((el) => el.setAttribute("aria-hidden", "true")));
    try {
      await expectTapTargets(page, route.path === "/how-we-grade" ? { root: '[data-testid="hwg-stage"]' } : {});
    } finally {
      await graph.evaluateAll((els) => els.forEach((el) => el.removeAttribute("aria-hidden")));
    }
    return;
  }
  await expectTapTargets(page, route.path === "/how-we-grade" ? { root: '[data-testid="hwg-stage"]' } : {});
}

async function noDocumentScroll(page: Page) {
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
  }));
  expect(m.sh, "the document does not scroll vertically").toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, "no horizontal page scroll").toBeLessThanOrEqual(m.iw + 1);
}

async function inViewport(page: Page, testId: string) {
  const el = page.getByTestId(testId).filter({ visible: true }).first();
  await expect(el, `${testId} visible`).toBeVisible();
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y >= -1 && box.y + box.height <= vp.height + 1 && box.x >= -1 && box.x + box.width <= vp.width + 1, `${testId} inside the viewport`).toBe(true);
}

async function checkRoute(page: Page, route: Route, testInfo: TestInfo) {
  const zoom = Number(testInfo.project.metadata?.zoom ?? 1);
  await gotoStable(page, route.path);
  await expect(page.getByTestId(route.ready).first()).toBeVisible({ timeout: 30_000 });
  if (route.board) {
    // A modal confirm on phones may cover the board deliberately; the P3 states have none.
    await expectOneViewport(page, { board: true });
    const sq = await page.locator('[data-testid="chess-board"] [data-square="a1"]').first().boundingBox();
    expect(sq, "a1 on screen").not.toBeNull();
    expect(sq!.width, "squares ≥ 220/8 px").toBeGreaterThanOrEqual(27.5);
  } else {
    await noDocumentScroll(page);
    if (route.primary) await inViewport(page, route.primary);
  }
  if (route.ready === "games-archive" && route.path.includes("state=default")) {
    const list = page.getByTestId("games-list");
    expect(await list.evaluate((el) => el.scrollHeight >= el.clientHeight), "the list is its own scroller").toBe(true);
  }
  if (route.immersive) await expect(page.locator("[data-rc-tabbar]:visible"), "no tab bar on an immersive route").toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]:visible, [data-testid='game-toast']:visible"), "no toast over the screen").toHaveCount(0);
  await expectReviewTapTargets(page, route);
  testInfo.annotations.push({ type: "zoom", description: String(zoom) });
}

for (const family of Object.keys(REVIEW_BOARDS) as DeviceFamily[]) {
  test.describe(`review screens one viewport · ${family} @p3`, () => {
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(familyOf(testInfo) !== family, `${family} test`);
    });

    for (const route of ROUTES) {
      test(`${route.path}`, { tag: route.tags(family) }, async ({ page }, testInfo) => {
        await checkRoute(page, route, testInfo);
      });
      if (route.stress) {
        const path = `${route.path}${route.path.includes("?") ? "&" : "?"}stress=1`;
        test(`${path}`, async ({ page }, testInfo) => {
          test.skip(Number(testInfo.project.metadata?.zoom ?? 1) !== STRESS_ZOOM, "stress=1 runs at 150 %");
          await checkRoute(page, { ...route, path }, testInfo);
        });
      }
    }

    test("/r/<seeded live share>", { tag: ["@p3"] }, async ({ page }) => {
      test.setTimeout(120_000);
      const { prepareReviewData } = await import("../../specs/review/_lib/review");
      const refs = await prepareReviewData();
      const res = await page.goto(`/r/${refs.shares.live}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("share-page")).toHaveAttribute("data-state", "ok");
      await noDocumentScroll(page);
      await inViewport(page, "share-board");
      await expectTapTargets(page);
    });
  });
}
