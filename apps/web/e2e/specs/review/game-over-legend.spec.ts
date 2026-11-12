// The game-over legend block on real data (phase-03 plan §12.3 `game-over-legend.spec.ts`, §4.7; owner tests T13, T20)
// on desktop-1440@100 and iphone@100: a bot game from Morphy's Opera position (the content seed's legend position),
// played in the browser to 12.Ba4 and resigned → the card's `over_legend` block "You matched Morphy for N of M moves…"
// → Replay from Move N opens /practice?game=<ref>&ply=<n> at the position before the member's divergent move (the
// FEN is replayed from the game's own moves) → Compare with Morphy opens the comparison.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { Chess } from "chess.js";
import { OPERA_FEN } from "@repo/db/seed/review";
import { DEVICES, expect, gotoOk, test } from "./_lib/review";
import { gameTags } from "../game/tags";

const container = (p: Page) => p.locator('[data-testid="game-board-container"]');

async function ply(page: Page): Promise<number> {
  return Number(await container(page).getAttribute("data-ply"));
}

/**
 * Plays `uci` when the board offers it (a move dot or capture mark on the target) and waits for the engine's reply.
 * Returns false (and plays nothing) when the bot left Morphy's line so the move is not legal.
 */
async function playIfOffered(page: Page, uci: string): Promise<boolean> {
  await expect(container(page)).toHaveAttribute("data-current-turn", "w", { timeout: 90_000 });
  const before = await ply(page);
  const sq = (s: string) => page.locator(`[data-square="${s}"]`).filter({ visible: true }).first();
  const marks = sq(uci.slice(2, 4)).locator('[data-mark="dot"], [data-mark="capture"]').first();
  // A selection click can land before the board takes input (hydration, the engine's first think): select again.
  for (let attempt = 0; attempt < 3; attempt++) {
    await sq(uci.slice(0, 2)).click();
    const offered = await marks.waitFor({ state: "attached", timeout: 3_000 }).then(
      () => true,
      () => false,
    );
    if (offered) {
      await sq(uci.slice(2, 4)).click();
      await expect.poll(() => ply(page), { timeout: 90_000 }).toBeGreaterThanOrEqual(before + 2);
      return true;
    }
    // Deselect (a second click on a selected piece) only when the piece is selected.
    if ((await sq(uci.slice(0, 2)).locator('[data-mark="selected"]').count()) > 0) await sq(uci.slice(0, 2)).click();
  }
  return false;
}

async function resign(page: Page) {
  const menu = page.locator('[data-testid="game-menu-button"]:visible, [data-testid="game-menu-button-bar"]:visible').first();
  if (await menu.count()) await menu.click();
  await page.locator('[data-testid="resign-button"]:visible, [data-testid="resign-button-bar"]:visible').first().click();
  await page.locator('[data-testid="confirm-resign-button"]').click();
}

for (const device of ["desktop-1440", "iphone"] as const) {
  test.describe(`game over · legend · ${device}@100`, { tag: ["@p3", "@local-only"] }, () => {
    test.use(DEVICES[device]);

    test(
      "over_legend: matched N of M, Replay from Move N → practice at the divergence, Compare with Morphy",
      { tag: ["@state:V3GameOverLegend.over_legend", ...gameTags("state", ["over_legend"], device === "iphone" ? "iphone" : "desktop")] },
      async ({ member, page, reviewDb, telemetry }) => {
        test.setTimeout(420_000);
        await member("H");
        const pos = await reviewDb.$queryRaw<{ ref: string }[]>`SELECT "referenceId" AS ref FROM chess_positions WHERE fen = ${OPERA_FEN} LIMIT 1`;
        expect(pos[0], "the Opera position of the content seed").toBeTruthy();
        const created = await page.request.post("/api/games", {
          data: { mode: "BOT", start: { kind: "position", positionRef: pos[0]!.ref }, color: "w", botElo: 1200, tc: null },
          headers: { "Idempotency-Key": randomUUID() },
        });
        expect(created.status(), await created.text()).toBe(201);
        const ref = ((await created.json()) as { data: { game: { ref: string } } }).data.game.ref;

        await gotoOk(page, `/game/${ref}`);
        await expect(container(page)).toHaveAttribute("data-phase", "bot", { timeout: 120_000 });
        // Morphy's 10.Nxb5 and 11.Bxb5+, then the member's 12.Ba4 (Morphy played 12.O-O-O). The bot may leave the line
        // earlier (the "opponent left" variant of the block); the member then resigns there.
        expect(await playIfOffered(page, "c3b5"), "10.Nxb5 is legal from the Opera position").toBe(true);
        if (await playIfOffered(page, "c4b5")) await playIfOffered(page, "b5a4");
        await resign(page);

        const block = page.getByTestId("review-legend").filter({ visible: true }).first();
        await expect(block).toBeVisible({ timeout: 120_000 });
        await expect(block).toContainText(/You matched Morphy for \d+ of \d+ moves(, then left Morphy’s path| before the game left Morphy’s path)/);
        const replay = block.getByTestId("legend-replay");
        await expect(replay).toHaveText(/Replay from Move \d+/);
        const href = (await replay.getAttribute("href"))!;
        const m = /^\/practice\?game=([a-z0-9]+)&ply=(\d+)/.exec(href);
        expect(m, href).not.toBeNull();
        expect(m![1]).toBe(ref);

        // The expected position: the game's start, then its first `ply` moves.
        const snap = ((await (await page.request.get(`/api/games/${ref}`)).json()) as { data: { snapshot: { startFen: string; moves: string | string[] } } }).data.snapshot;
        const moves = typeof snap.moves === "string" ? snap.moves.split(" ").filter(Boolean) : snap.moves;
        const chess = new Chess(snap.startFen);
        for (const uci of moves.slice(0, Number(m![2]))) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        const board = chess.fen().split(" ").slice(0, 2).join(" ");

        await expect(block.getByTestId("legend-compare")).toHaveText(/Compare with Morphy/);
        const compareHref = await block.getByTestId("legend-compare").getAttribute("href");
        expect(compareHref).toBe(`/review/${ref}/legend`);

        await replay.click();
        await telemetry.expect("game_over_replay_clicked", {}, { source: "client" });
        await page.waitForURL(/\/practice\?game=/, { timeout: 60_000 });
        // Practice opens at the divergence. When that position is the engine's turn (the bot left Morphy's path), the
        // engine may already have replied by the time the board is read: then exactly one move was played from it
        // (regression: practice-divergence-reply-race; the reply landed before the read in 1 of 3 runs).
        const after = new Set(
          chess.moves({ verbose: true }).map((mv) => {
            const c = new Chess(chess.fen());
            c.move(mv.san);
            return c.fen().split(" ").slice(0, 2).join(" ");
          }),
        );
        await expect
          .poll(
            async () => {
              const el = page.getByTestId("practice-board");
              const fen = ((await el.getAttribute("data-fen")) ?? "").split(" ").slice(0, 2).join(" ");
              const played = Number((await el.getAttribute("data-moves")) ?? "-1");
              return (played === 0 && fen === board) || (played === 1 && after.has(fen)) ? "at the divergence" : `${played} move(s): ${fen}`;
            },
            { timeout: 60_000 },
          )
          .toBe("at the divergence");

        await gotoOk(page, compareHref!);
        await expect(page.getByTestId("compare-title")).toHaveText("You vs Morphy", { timeout: 120_000 });
      },
    );
  });
}
