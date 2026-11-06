// One viewport for the game screen (phase-02 plan 4.2, 12.7; DoD "board, both bars, both clocks and the controls in
// view on all 8 devices at 80–150 % zoom; no page scroll; no tab bar during a game; no toast over the board").
//
// /dev/ui/game?state=<s>&freeze=1 for every lit state on one project per device family at 100 % (and P1's PR tier:
// desktop-1280@125), and the 12 key states plus the stress=1 game on every project of the matrix. Each test belongs
// to one device family (it skips on the others), so the @demo tags name exactly the boards that ran.
import { expectTapTargets } from "../helpers";
import { expectOneViewport } from "../layout/assertions";
import { expect, gotoStable, shellModeFor, test } from "../layout/fixtures";
import { FAMILIES, demoTags, familyOf } from "./families";
import { LIT_STATES } from "../../../../../packages/game-core/src/client/viewState";

const ALL_STATES_PROJECTS = new Set([
  "desktop-1440@100",
  "desktop-1280@125",
  "ipad-landscape@100",
  "ipad-portrait@100",
  "iphone@100",
  "android@100",
]);
export const KEY_STATES = [
  "your_move",
  "study",
  "abort",
  "premove",
  "promotion",
  "draw_received",
  "resign_confirm",
  "reconnecting",
  "opp_disconnected",
  "bot",
  "spectate",
  "over_checkmate_win",
];

const MODE: Record<string, string> = { bot: "&mode=bot", spectate: "&mode=spectate", over_spectator: "&mode=spectate" };

for (const family of FAMILIES) {
  test.describe(`game one viewport · ${family} @p2`, () => {
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(familyOf(testInfo) !== family, `${family} test`);
    });

    for (const state of [...LIT_STATES, "stress"]) {
      const key = state === "stress" || KEY_STATES.includes(state);
      const tags = state === "stress" ? [] : demoTags(family, state);
      test(`${state}`, { tag: tags }, async ({ page }, testInfo) => {
        test.skip(!key && !ALL_STATES_PROJECTS.has(testInfo.project.name), "all-states run: one project per family");
        const path = state === "stress" ? "/dev/ui/game?stress=1&freeze=1" : `/dev/ui/game?state=${state}&freeze=1${MODE[state] ?? ""}`;
        await gotoStable(page, path);
        await expect(page.locator('[data-testid="game-board-container"]')).toBeVisible();
        const mode = await shellModeFor(page);
        // A modal confirm (the resign sheet on phones and narrow tablets) deliberately covers the board: the board
        // must still sit inside the viewport, but occlusion is the modal's job there.
        const modal = await page.locator('[role="dialog"]:visible').count();
        const s = await expectOneViewport(page, { board: modal === 0, nav: mode !== "tabbar" });
        if (modal) {
          const vp = page.viewportSize()!;
          const b = s.board!;
          expect(b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1, "board inside the viewport").toBe(true);
        }
        await expectTapTargets(page);

        // No tab bar during a game.
        await expect(page.locator("[data-rc-tabbar]:visible")).toHaveCount(0);
        // Both clocks on screen (every state but loading has them).
        if (state !== "loading") {
          const clocks = page.locator('[data-testid^="clock-"]:visible');
          await expect(clocks).toHaveCount(2);
          const vp = page.viewportSize()!;
          for (const c of await clocks.all()) {
            const b = (await c.boundingBox())!;
            expect(b.y >= 0 && b.y + b.height <= vp.height + 1 && b.x >= 0 && b.x + b.width <= vp.width + 1, "clock inside the viewport").toBe(true);
          }
        }
        // Squares ≥ 27.5 px.
        const sq = await page.locator('[data-square="a1"]').boundingBox();
        expect(sq!.width, "square size").toBeGreaterThanOrEqual(27.5);
        // Every result CTA is reachable (scrolled into view inside the panel, not clipped), and the page itself still
        // does not scroll; where BoardStage folds the strip (phone at 150 %), through the Result sheet instead.
        // regression: REGRESSION-2 — on phones BoardStage clipped the result card under the board, so Share / Analyse
        // / Rematch / Watch another could not be reached (and at 150 % nothing of the result was on screen).
        if (state.startsWith("over_")) {
          const reachable = (el: Element) => {
            const r = el.getBoundingClientRect();
            const x = r.x + r.width / 2;
            const y = r.y + r.height / 2;
            if (r.width === 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
            const hit = document.elementFromPoint(x, y);
            return !!hit && (hit === el || el.contains(hit));
          };
          const title = page.locator('[data-testid="game-result-title"]').first();
          await title.scrollIntoViewIfNeeded().catch(() => {});
          let zone = '[data-testid="zone-result"]';
          if (!(await title.evaluate(reachable))) {
            const open = page.locator('[data-testid="result-sheet-button"]');
            await expect(open, "folded layout: the Result sheet trigger").toBeVisible();
            await open.click();
            zone = '[data-testid="zone-result-sheet"]';
            await expect(page.locator(zone)).toBeVisible();
          }
          const ctas = page.locator(`${zone} :is(a, button):visible`);
          expect(await ctas.count(), "result CTAs").toBeGreaterThan(0);
          for (const cta of await ctas.all()) {
            await cta.scrollIntoViewIfNeeded();
            const label = (await cta.getAttribute("data-testid")) ?? (await cta.textContent());
            expect(await cta.evaluate(reachable), `result CTA ${label} reachable`).toBe(true);
          }
          expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight + 1), "no page scroll").toBe(true);
        }
      });
    }
  });
}
