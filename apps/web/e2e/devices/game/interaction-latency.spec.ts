// Interaction latency of the game board (phase-02 plan 12.8 "Interaction latency", 9; FIX-A: the perf spec was
// missing). Chromium desktop only (CDP), on /dev/ui/game?state=your_move with a 4× CPU throttle:
//   - drop → painted ≤ 33 ms (pointerup to the first frame showing the new ply);
//   - ≤ 4 ms of scripting per applied move (CDP Performance.getMetrics ScriptDuration around one move);
//   - a drag runs at ≥ 50 fps (frames counted while the pointer moves for ~1 s).
// Runs on desktop-1440@100 only (one measurement, not one per zoom level).
import type { CDPSession, Page } from "@playwright/test";
import { expect, gotoStable, test } from "../layout/fixtures";

const PROJECT = "desktop-1440@100";

async function scriptMs(cdp: CDPSession): Promise<number> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return (metrics.find((m) => m.name === "ScriptDuration")?.value ?? 0) * 1000;
}

async function movablePair(page: Page) {
  const from = page.locator("[data-square][data-movable]").first();
  await from.click();
  const to = page.locator("[data-square][data-target]").first();
  await expect(to).toBeVisible();
  const fromSq = await from.getAttribute("data-square");
  const toSq = await to.getAttribute("data-square");
  await from.click(); // deselect
  return { from: page.locator(`[data-square="${fromSq}"]`), to: page.locator(`[data-square="${toSq}"]`) };
}

test.describe("interaction latency @p2 @perf", () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, `${PROJECT} only`);
  });

  test("drop → paint ≤ 33 ms, ≤ 4 ms scripting per move, drag ≥ 50 fps at 4× throttle", async ({ page }) => {
    await gotoStable(page, "/dev/ui/game?state=your_move&freeze=1");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    try {
      const { from, to } = await movablePair(page);
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;

      // Drag frames: count rAF callbacks while the pointer moves for ~1 s.
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number; __counting: boolean };
        w.__frames = 0;
        w.__counting = true;
        const tick = () => {
          if (!w.__counting) return;
          w.__frames++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const t0 = Date.now();
      const steps = 60;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await page.mouse.move(a.x + a.width / 2 + (b.x - a.x) * k, a.y + a.height / 2 + (b.y - a.y) * k);
      }
      const elapsed = Math.max(1, Date.now() - t0);
      const frames = await page.evaluate(() => {
        const w = window as unknown as { __frames: number; __counting: boolean };
        w.__counting = false;
        return w.__frames;
      });
      const fps = (frames * 1000) / elapsed;

      // Drop → paint: pointerup stamped in the page, then the first frame after data-ply changes.
      await page.evaluate(() => {
        const w = window as unknown as { __drop: number; __paint: Promise<number> };
        const board = document.querySelector('[data-testid="game-board-container"]')!;
        const start = board.getAttribute("data-ply");
        w.__paint = new Promise<number>((resolve) => {
          const obs = new MutationObserver(() => {
            if (board.getAttribute("data-ply") === start) return;
            obs.disconnect();
            requestAnimationFrame(() => resolve(performance.now()));
          });
          obs.observe(board, { attributes: true, attributeFilter: ["data-ply"] });
        });
        window.addEventListener("pointerup", () => (w.__drop = performance.now()), { once: true, capture: true });
      });
      const scriptBefore = await scriptMs(cdp);
      await page.mouse.up();
      const dropToPaint = await page.evaluate(async () => {
        const w = window as unknown as { __drop: number; __paint: Promise<number> };
        return (await w.__paint) - w.__drop;
      });
      const scripting = (await scriptMs(cdp)) - scriptBefore;

      testInfo().annotations.push({
        type: "perf",
        description: `drop→paint ${dropToPaint.toFixed(1)} ms · scripting ${scripting.toFixed(2)} ms · drag ${fps.toFixed(0)} fps`,
      });
      // Throttled numbers include the 4× factor; the budgets are the plan's.
      expect(dropToPaint, "drop → paint (ms)").toBeLessThanOrEqual(33);
      expect(scripting, "scripting per applied move (ms)").toBeLessThanOrEqual(4);
      expect(fps, "drag fps").toBeGreaterThanOrEqual(50);
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
    }
  });
});

const testInfo = () => test.info();
