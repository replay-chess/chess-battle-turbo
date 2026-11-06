// The real game route on the device matrix (phase-02 plan 12.7; FIX-A: the spec was missing).
//
//   - a real fixture game: member A creates a bot game through POST /api/games (no socket, so it runs against the
//     matrix's plain `next build && next start`) and /game/<ref> must hold one viewport at 100 % and 150 % on the
//     8 base devices: the board inside the viewport, no page scroll, both bars, both clocks and the controls in view;
//   - the stress=1 fixture game (120 plies, 20-character names, a 3-digit move number, the longest header) at 150 %
//     on every device (testing X9).
//
// Needs member A's Clerk login (.env.test, loaded by the config) and a server with the dev database. Without the
// login the real-game half skips; the stress half always runs.
import { randomUUID } from "node:crypto";
import { clerkSetup } from "@clerk/testing/playwright";
import { signIn } from "../../fixtures/auth";
import { expectOneViewport } from "../layout/assertions";
import { expect, gotoStable, shellModeFor, test } from "../layout/fixtures";

const MEMBER = "A";
const zoomOf = (name: string) => Number(name.split("@")[1] ?? "100");

test.describe("game live route @p2", () => {
  test("a real bot game holds one viewport", async ({ page }, testInfo) => {
    const zoom = zoomOf(testInfo.project.name);
    test.skip(zoom !== 100 && zoom !== 150, "100 % and 150 % only");
    const email = process.env[`E2E_USER_${MEMBER}_EMAIL`];
    test.skip(!email || !process.env.CLERK_SECRET_KEY, `E2E_USER_${MEMBER}_EMAIL / CLERK_SECRET_KEY not set`);
    test.setTimeout(180_000);
    await clerkSetup();
    await signIn(page, email!, process.env[`E2E_USER_${MEMBER}_PASSWORD`] ?? "");
    const res = await page.request.post("/api/games", {
      data: { mode: "BOT", start: { kind: "initial" }, color: "w", botElo: 600, tc: { initialSeconds: 600, incrementSeconds: 0 } },
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(res.status(), await res.text()).toBe(201);
    const ref = ((await res.json()) as { data: { game: { ref: string } } }).data.game.ref;
    await gotoStable(page, `/game/${ref}`);
    await expect(page.locator('[data-testid="game-board-container"]')).toBeVisible();
    const mode = await shellModeFor(page);
    await expectOneViewport(page, { board: true, nav: mode !== "tabbar" });
    // Abort it again (fewer than two plies), so member A does not collect open bot games.
    await page.request.post(`/api/games/${ref}/complete`, {
      data: { rev: 1, moves: [], clocksMs: [], result: "aborted", method: "aborted", assists: { hints: 0, undos: 0 }, endedAtClient: Date.now() },
    });
  });

  test("the stress=1 game at 150 %", async ({ page }, testInfo) => {
    test.skip(zoomOf(testInfo.project.name) !== 150, "150 % only");
    await gotoStable(page, "/dev/ui/game?stress=1&freeze=1");
    await expect(page.locator('[data-testid="game-board-container"]')).toBeVisible();
    const mode = await shellModeFor(page);
    await expectOneViewport(page, { board: true, nav: mode !== "tabbar" });
  });
});
