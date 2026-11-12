// Practice from a position on real data (phase-03 plan §12.3 `practice.spec.ts`; owner tests T14, T20) on
// desktop-1440@100 and iphone@100, member A, the seeded GAME:
// - a throttled engine WASM → `engine_loading` with a percentage → `default`; e4 → the engine replies; Take Back;
//   Reset; `engine_init{ok:true}` and `practice_started`;
// - an aborted WASM → `engine_failed` + Retry;
// - offline after the engine loaded → the `offline` banner, and play continues (the engine is in the browser).
import type { Page } from "@playwright/test";
import { boardInView, DEVICES, expect, gotoOk, noDocumentScroll, test } from "./_lib/review";

const WASM = /sf18-[0-9a-f]+\/.*\.wasm(\?|$)/;
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 600;
const btn = (page: Page, id: string) => page.getByTestId(isPhone(page) ? `practice-bar-${id}` : `practice-${id}`).filter({ visible: true }).first();

async function play(page: Page, from: string, to: string) {
  const board = page.getByTestId("practice-board");
  await board.locator(`[data-square="${from}"]`).click();
  await board.locator(`[data-square="${to}"]`).click();
}

for (const device of ["desktop-1440", "iphone"] as const) {
  test.describe(`practice · ${device}@100`, { tag: ["@p3"] }, () => {
    test.use(DEVICES[device]);

    test(
      "engine_loading (throttled WASM) → default; e4, the reply, Take Back, Reset",
      { tag: ["@state:V3Practice.engine_loading", "@state:V3Practice.default"] },
      async ({ member, page, seeded, telemetry }) => {
        test.setTimeout(300_000);
        await member("A");
        await page.route(WASM, async (route) => {
          await new Promise((r) => setTimeout(r, 2_500));
          await route.continue();
        });
        await gotoOk(page, `/practice?game=${seeded.GAME}&ply=0`);
        const screen = page.getByTestId("practice-screen");
        await expect(screen).toHaveAttribute("data-state", "engine_loading", { timeout: 60_000 });
        await expect(page.getByTestId("practice-loading")).toContainText(/Starting the engine · \d+%/);
        await expect(page.getByTestId("practice-loading")).toContainText("First load only: about 7 MB");
        await expect(screen).toHaveAttribute("data-state", "default", { timeout: 120_000 });
        await telemetry.expect("engine_init", { ok: true }, { source: "client" });
        // A direct ?game=&ply= link with no referrer counts as from "review" (features/practice/copy.ts practiceFrom).
        await telemetry.expect("practice_started", { from: "review", ply_bucket: 0 }, { source: "client", count: 1 });
        await boardInView(page, "practice-board");
        await noDocumentScroll(page);

        const board = page.getByTestId("practice-board");
        await play(page, "e2", "e4");
        await expect(board).toHaveAttribute("data-moves", "2", { timeout: 60_000 });
        await btn(page, "takeback").click();
        await expect(board).toHaveAttribute("data-moves", "0");
        await telemetry.expect("practice_action", { action: "takeback" }, { source: "client" });
        await play(page, "d2", "d4");
        await expect(board).toHaveAttribute("data-moves", "2", { timeout: 60_000 });
        await btn(page, "reset").click();
        await expect(board).toHaveAttribute("data-moves", "0");
        await telemetry.expect("practice_action", { action: "reset" }, { source: "client" });
        telemetry.forbid("e2e4");
      },
    );

    test("an aborted WASM → engine_failed + Retry", { tag: ["@state:V3Practice.engine_failed"] }, async ({ member, page, seeded }) => {
      test.setTimeout(240_000);
      await member("A");
      await page.route(WASM, (route) => route.abort());
      await gotoOk(page, `/practice?game=${seeded.GAME}&ply=10`);
      await expect(page.getByTestId("practice-screen")).toHaveAttribute("data-state", "engine_failed", { timeout: 90_000 });
      await expect(page.getByTestId("practice-failed")).toBeVisible();
      await expect(page.getByTestId("practice-retry")).toBeVisible();
      await page.unroute(WASM);
      await page.getByTestId("practice-retry").click();
      await expect(page.getByTestId("practice-screen")).toHaveAttribute("data-state", "default", { timeout: 120_000 });
    });

    test("offline after load: the banner, and play continues", { tag: ["@state:V3Practice.offline"] }, async ({ context, member, page, seeded }) => {
      test.setTimeout(240_000);
      await member("A");
      await gotoOk(page, `/practice?game=${seeded.GAME}&ply=0`);
      await expect(page.getByTestId("practice-screen")).toHaveAttribute("data-state", "default", { timeout: 120_000 });
      await context.setOffline(true);
      try {
        await expect(page.getByTestId("practice-offline")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId("practice-screen")).toHaveAttribute("data-state", "offline");
        await play(page, "g1", "f3");
        await expect(page.getByTestId("practice-board")).toHaveAttribute("data-moves", "2", { timeout: 60_000 });
      } finally {
        await context.setOffline(false);
      }
    });
  });
}
