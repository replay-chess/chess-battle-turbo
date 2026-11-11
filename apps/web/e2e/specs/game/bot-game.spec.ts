// T14 / T15 (phase-02 plan 1.2, 5.3, 12.6) † @smoke: a bot game from /play ("Play the Machine") runs on the device:
// the engine loads (R2 base URL or the same-origin /workers/sf18-<hash>/ fallback) and `engine_init{ok}` fires once;
// Hint twice (piece, then arrow + SAN), Undo (your move and the reply), a reload resumes at the same ply, resign
// completes exactly once; `bot_game_started` and `bot_game_completed{hints: 2, undos: 1}` reach the sink once each.
import type { Request } from "@playwright/test";
import { expect, expectServerEvents, finishedSnapshot, seatLetters, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("bot game", { tag: p2("@smoke", "@local-only") }, () => {
  test(
    "play the machine: hint ×2, undo, reload, resign",
    { tag: [...gameTags("state", ["bot"]), "@state:V3GameBot.bot"] },
    async ({ seat, telemetry }, testInfo) => {
      test.setTimeout(300_000);
      // Another user on the phone project: the desktop copy runs at the same time in CI and the bot_game_* counts are
      // per user (seatLetters).
      const [letter] = seatLetters(testInfo, ["E"], ["G"]);
      const me = await seat(letter);
      const page = me.page;
      const requests: string[] = [];
      page.on("request", (r: Request) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/workers/") || u.pathname.startsWith("/api/games") || u.hostname !== "localhost") requests.push(`${r.method()} ${u.host}${u.pathname}`);
      });

      await page.goto("/play", { timeout: 180_000 });
      // "Play the Machine" is the default mode; Start creates the game (POST /api/games).
      await page.getByTestId("start-game-button").click();
      await page.waitForURL(/\/game\//, { timeout: 120_000 });
      const ref = new URL(page.url()).pathname.split("/game/")[1]!;
      await me.waitPhase("bot", 120_000);
      await expect(page.getByTestId("game-header-right").or(page.getByTestId("game-topbar-title")).first()).toContainText(/Engine \d+|unrated/i);
      await expect
        .poll(() => requests.filter((r) => /sf18-[0-9a-f]+\/.*\.wasm$/.test(r)).length, { timeout: 90_000 })
        .toBeGreaterThan(0);
      await telemetry.expect("engine_init", { ok: true }, { source: "client", count: 1, timeout: 60_000 });

      // Colour "auto": if the engine has White, wait for its first move.
      const color = (await me.color())!;
      await expect(page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-current-turn", color, { timeout: 60_000 });
      const p0 = await me.ply();
      await me.board.playValidMove(color);
      await me.waitPly(p0 + 2, 60_000); // our move and the engine's reply

      // The hint line shows in the status line and the coach zone (the engine searches first: allow for a cold WASM).
      const hintLine = page.locator('[data-testid="game-status"], [data-testid="zone-coach"]');
      await page.locator('[data-testid="hint-button"]:visible, [data-testid="hint-button-bar"]:visible').first().click();
      await expect(hintLine.filter({ hasText: /Hint 1 of 2/ }).first()).toBeVisible({ timeout: 90_000 });
      await page.locator('[data-testid="hint-button"]:visible, [data-testid="hint-button-bar"]:visible').first().click();
      await expect(hintLine.filter({ hasText: /Hint 2 of 2: play / }).first()).toBeVisible({ timeout: 90_000 });
      await expect(page.locator("[data-arrow]")).toHaveCount(1);

      await page.locator('[data-testid="undo-button"]:visible, [data-testid="undo-button-bar"]:visible').first().click();
      await me.waitPly(p0);
      await expect(page.getByTestId("game-toast")).toContainText(/Took back/i);

      await me.board.playValidMove(color);
      await me.waitPly(p0 + 2, 60_000);
      // Reload resumes at the same ply (the local journal).
      await page.reload({ timeout: 180_000 });
      await me.waitPhase("bot", 120_000);
      await me.waitPly(p0 + 2, 30_000);

      const completes = () => requests.filter((r) => r.startsWith("POST") && r.endsWith("/complete")).length;
      await me.board.resign();
      await expect(page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
      await expect.poll(completes, { timeout: 30_000 }).toBe(1);
      await page.waitForTimeout(2_000);
      expect(completes()).toBe(1);
      expect((await finishedSnapshot(me, ref)).status).toBe("COMPLETED");

      await expectServerEvents(telemetry, "bot_game_started", [me], 1);
      await expectServerEvents(telemetry, "bot_game_completed", [me], 1, { hints: 2, undos: 1, method: "resignation", result: "loss" });
      // No game traffic to the socket server.
      expect(me.link.connections).toBe(0);
    },
  );
});
