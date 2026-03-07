import {
  test,
  expect,
  ChessBoardHelper,
  createTournamentViaApi,
  deleteTournamentViaApi,
} from "../fixtures";
import type { Page } from "@playwright/test";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the find-match API from a page context. Returns the API response data.
 */
async function callFindMatchApi(
  page: Page,
  tournamentRefId: string,
): Promise<{ status: string; gameReferenceId?: string }> {
  return page.evaluate(async (refId: string) => {
    const res = await fetch("/api/tournament/find-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tournamentReferenceId: refId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `find-match failed: ${res.status}`);
    return data.data as { status: string; gameReferenceId?: string };
  }, tournamentRefId);
}

/**
 * Safely call find-match, returning null on server errors (500s from
 * transaction conflicts) instead of throwing.
 */
async function tryFindMatch(
  page: Page,
  tournamentRefId: string,
): Promise<{ status: string; gameReferenceId?: string } | null> {
  try {
    return await callFindMatchApi(page, tournamentRefId);
  } catch {
    return null;
  }
}

/**
 * Play a game between two already-matched players on a known game page.
 * Navigates both to the game, plays 2 rounds of moves, then one player resigns.
 */
async function playMatchedGame(pageX: Page, pageY: Page, gameRefId: string) {
  const boardX = new ChessBoardHelper(pageX);
  const boardY = new ChessBoardHelper(pageY);

  await Promise.all([
    pageX.goto(`/game/${gameRefId}`, { waitUntil: "domcontentloaded" }),
    pageY.goto(`/game/${gameRefId}`, { waitUntil: "domcontentloaded" }),
  ]);

  await Promise.all([
    boardX.waitForBoard().then(() => boardX.waitForGameStarted()),
    boardY.waitForBoard().then(() => boardY.waitForGameStarted()),
  ]);

  const [colorX, colorY] = await Promise.all([
    boardX.detectPlayerColor(),
    boardY.detectPlayerColor(),
  ]);
  expect(colorX).not.toBe(colorY);

  const boardByColor: Record<string, ChessBoardHelper> = {
    w: colorX === "w" ? boardX : boardY,
    b: colorX === "b" ? boardX : boardY,
  };

  const startingTurn = await boardX.getCurrentTurn();
  const otherTurn = startingTurn === "w" ? "b" : "w";

  for (let i = 0; i < 2; i++) {
    await boardByColor[startingTurn]!.waitForTurn(startingTurn);
    await boardByColor[startingTurn]!.playValidMove(startingTurn);

    await boardByColor[otherTurn]!.waitForTurn(otherTurn);
    await boardByColor[otherTurn]!.playValidMove(otherTurn);
  }

  const resignBoard = boardByColor[startingTurn]!;
  const winnerBoard = boardByColor[otherTurn]!;
  await resignBoard.waitForTurn(startingTurn);
  await resignBoard.resign();

  await expect(resignBoard.gameResult()).toContainText("Defeat", { timeout: 10_000 });
  await expect(winnerBoard.gameResult()).toContainText("Victory", { timeout: 10_000 });
}

/**
 * All players search for a match with staggered sequential calls.
 * Tracks already-played game IDs to avoid navigating to stale finished games
 * that the server still reports as IN_GAME due to async DB updates.
 *
 * Returns a Map of gameReferenceId → [page, page] representing matched pairs.
 */
async function searchForMatches(
  players: Page[],
  tournamentRefId: string,
  playedGameIds: Set<string>,
): Promise<Map<string, Page[]>> {
  // Navigate all players to the tournament page (ensures auth context)
  await Promise.all(
    players.map((p) =>
      p.goto(`/tournament/${tournamentRefId}`, { waitUntil: "domcontentloaded" }),
    ),
  );

  const games = new Map<string, Page[]>();
  const matched = new Set<Page>();

  const addMatch = (page: Page, gameRefId: string) => {
    if (!games.has(gameRefId)) games.set(gameRefId, []);
    games.get(gameRefId)!.push(page);
    matched.add(page);
  };

  const isNewMatch = (result: { status: string; gameReferenceId?: string } | null) =>
    result &&
    (result.status === "MATCHED" || result.status === "IN_GAME") &&
    result.gameReferenceId &&
    !playedGameIds.has(result.gameReferenceId);

  // Phase 1: Sequential search with stagger — avoids transaction lock contention.
  // Shuffle so pairing order varies each round.
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  for (const page of shuffled) {
    const result = await tryFindMatch(page, tournamentRefId);
    if (isNewMatch(result)) {
      addMatch(page, result!.gameReferenceId!);
    }
    // Wait for the transaction to commit before the next player searches
    await delay(300 + Math.random() * 400);
  }

  // Phase 2: Poll unmatched players — they were the "first searcher" in a pair
  // and need to retry to discover the game created when their opponent matched.
  for (let round = 0; round < 20 && matched.size < players.length; round++) {
    await delay(500 + Math.random() * 500);
    for (const page of players) {
      if (matched.has(page)) continue;
      const result = await tryFindMatch(page, tournamentRefId);
      if (isNewMatch(result)) {
        addMatch(page, result!.gameReferenceId!);
      }
    }
  }

  if (matched.size < players.length) {
    throw new Error(
      `${players.length - matched.size} player(s) failed to match after polling`,
    );
  }

  return games;
}

/**
 * Simulate realistic tournament play: all players search for matches,
 * the server's FIFO matchmaking pairs them, they play, then search again.
 * Repeats until the target number of games is reached.
 */
async function playTournamentGames(
  players: Page[],
  tournamentRefId: string,
  targetGames: number,
) {
  let gamesPlayed = 0;
  const playedGameIds = new Set<string>();

  while (gamesPlayed < targetGames) {
    console.log(
      `\n── Tournament round: searching for matches (${gamesPlayed}/${targetGames} games played) ──`,
    );

    const matchedGames = await searchForMatches(players, tournamentRefId, playedGameIds);

    for (const [gameRefId, pairedPlayers] of matchedGames) {
      if (pairedPlayers.length !== 2) {
        console.warn(`Unexpected pairing size ${pairedPlayers.length} for game ${gameRefId}, skipping`);
        continue;
      }
      if (gamesPlayed >= targetGames) break;

      gamesPlayed++;
      playedGameIds.add(gameRefId);
      console.log(`Playing game ${gamesPlayed}/${targetGames} (ref: ${gameRefId.slice(0, 8)}…)`);
      await playMatchedGame(pairedPlayers[0]!, pairedPlayers[1]!, gameRefId);
    }

    if (matchedGames.size === 0) {
      throw new Error(
        `No matches found with ${players.length} players — matchmaking may be stuck`,
      );
    }

    // Breather between rounds for server state (game status) to settle
    if (gamesPlayed < targetGames) {
      await delay(1000);
    }
  }

  console.log(`\n── All ${gamesPlayed} tournament games completed ──`);
}

test.describe("Tournament", () => {
  test("full tournament lifecycle: create, join, play 10 games, end, verify leaderboard", async ({
    playerJ,
    playerK,
    playerL,
    playerM,
  }) => {
    test.setTimeout(720_000);

    // ── PHASE 1: CREATE TOURNAMENT ──
    const tournamentRefId = await createTournamentViaApi(
      playerJ.page,
      `E2E Test Tournament ${Date.now()}`,
    );

    try {
      // ── PHASE 2: JOIN - K, L, M join via /join-tournament/ page (J is auto-joined as creator) ──
      for (const player of [playerK, playerL, playerM]) {
        await player.page.goto(`/join-tournament/${tournamentRefId}`, { waitUntil: "domcontentloaded" });
        const joinBtn = player.page.locator('[data-testid="join-tournament-button"]');
        await joinBtn.waitFor({ timeout: 30_000 });
        await joinBtn.click();
        // Wait for redirect to tournament page
        await player.page.waitForURL(`**/tournament/${tournamentRefId}`, { timeout: 30_000 });
      }

      // ── PHASE 3: VERIFY LOBBY STATE ──
      await playerJ.page.goto(`/tournament/${tournamentRefId}`, { waitUntil: "domcontentloaded" });
      await expect(playerJ.page.getByText("4 players")).toBeVisible({ timeout: 15_000 });

      // ── PHASE 4: START TOURNAMENT ──
      await playerJ.page.evaluate(async (refId: string) => {
        const res = await fetch("/api/tournament/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentReferenceId: refId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Start tournament failed: ${res.status}`);
        }
      }, tournamentRefId);
      await playerJ.page.reload({ waitUntil: "domcontentloaded" });
      await expect(playerJ.page.locator('[data-testid="tournament-status"]')).toContainText(
        "ACTIVE",
        { timeout: 15_000 },
      );

      // ── PHASE 5: PLAY 10 GAMES ──
      // All 4 players search with stagger, server pairs them via FIFO matchmaking,
      // they play, then search again. ~2 games per round → ~5 rounds for 10 games.
      const allPlayers = [playerJ.page, playerK.page, playerL.page, playerM.page];
      await playTournamentGames(allPlayers, tournamentRefId, 10);

      // ── PHASE 6: END TOURNAMENT ──
      // Navigate to tournament page first (players are still on the last game page)
      await playerJ.page.goto(`/tournament/${tournamentRefId}`, { waitUntil: "domcontentloaded" });
      await playerJ.page.evaluate(async (refId: string) => {
        const res = await fetch("/api/tournament/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentReferenceId: refId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `End tournament failed: ${res.status}`);
        }
      }, tournamentRefId);
      await playerJ.page.reload({ waitUntil: "domcontentloaded" });
      await expect(playerJ.page.locator('[data-testid="tournament-status"]')).toContainText(
        "COMPLETED",
        { timeout: 15_000 },
      );

      // ── PHASE 7: VERIFY LEADERBOARD ──
      const leaderboard = playerJ.page.locator('[data-testid="leaderboard"]');
      await expect(leaderboard).toBeVisible({ timeout: 15_000 });

      // 4 participants in the main leaderboard + 1 "Your Rank" card for the viewing player
      const rows = leaderboard.locator('[data-testid="leaderboard-row"]').filter({ visible: true });
      await expect(rows).toHaveCount(5, { timeout: 15_000 });
    } finally {
      // ── PHASE 8: CLEANUP — delete tournament and all associated games ──
      console.log(`\n── Cleaning up tournament ${tournamentRefId} ──`);
      try {
        await deleteTournamentViaApi(tournamentRefId);
        console.log(`── Tournament ${tournamentRefId} and games deleted ──`);
      } catch (cleanupError) {
        console.error("Tournament cleanup failed (non-fatal):", cleanupError);
      }
    }
  });
});
