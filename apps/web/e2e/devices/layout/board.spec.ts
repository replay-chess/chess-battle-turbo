// BoardStage geometry on every matrix project (SPEC 10.6, 04 §5.4).
import { boardHits, stageGeometry } from "./assertions";
import { expect, gotoStable, test } from "./fixtures";
import { GAME_ROUTE, HUB_ROUTE } from "./routes";

/**
 * Golden board edges for the game route (04 §5.4), recomputed with the real
 * nav widths and bar heights. Soft: they flag an accidental constant change.
 */
const GOLDEN: Record<string, number> = {
  "desktop-1440@100": 760,
  "desktop-1440@150": 496,
  "desktop-1280@125": 500,
  "ipad-portrait@100": 760,
  "iphone-safari@150": 259,
};

for (const path of [GAME_ROUTE, HUB_ROUTE]) {
  test(`board geometry ${path} @p1`, async ({ page }, testInfo) => {
    await gotoStable(page, path);
    const g = await stageGeometry(page);
    expect(g.stage && g.col && g.board && g.aside && g.bottomBar, "stage regions present").toBeTruthy();
    const stage = g.stage!;
    const board = g.board!;
    const aside = g.aside!;

    // Side vs stack, from the stage's own size (the container queries in board-stage.css).
    const expectedMode = stage.width < 590 || stage.height >= stage.width ? "stack" : "side";
    expect(g.mode, `stage ${Math.round(stage.width)}x${Math.round(stage.height)}`).toBe(expectedMode);
    if (expectedMode === "side") {
      expect(aside.x, "side: aside right of the board").toBeGreaterThanOrEqual(board.x + board.width - 0.5);
      expect(Math.abs(aside.height - g.col!.height), "side: aside height equals the column").toBeLessThanOrEqual(1);
    } else {
      const bar = g.bottomBar!;
      expect(aside.y, "stack: aside under the bottom bar").toBeGreaterThanOrEqual(bar.y + bar.height - 0.5);
    }

    expect(board.width, "board >= 220px").toBeGreaterThanOrEqual(219.5);
    expect(Math.abs(board.width - board.height), "board is square").toBeLessThan(1);
    expect(await boardHits(page, board), "corners and centre not occluded").toEqual([true, true, true, true, true]);

    const golden = GOLDEN[testInfo.project.name];
    if (path === GAME_ROUTE && golden !== undefined) {
      expect.soft(board.width, `golden board size on ${testInfo.project.name}`).toBeCloseTo(golden, -1);
    }
  });
}
