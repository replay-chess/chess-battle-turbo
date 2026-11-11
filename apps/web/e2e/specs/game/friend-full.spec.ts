// T1–T3, T9 (phase-02 plan 1.2, 12.6) † @smoke: a friend game end to end.
//
// 1. The /play path on a legend position: waiting (link, Copy, Cancel) → B joins through the link → study for both
//    (30 s ring, moves locked) → both "I'm ready" end it early → first-move window (abort for the side to move,
//    "Clock not started" for the other).
// 2. The design's main line (`L.MAIN` of packages/chess-fixtures/design/V3Game.json, the Opera Game) from the
//    initial position to 17.Rd8#: over_checkmate_win / loss with the mate and win badges, a PGN with `%clk`, and the
//    socket's game_started / game_ended exactly once per player (PostHog sink).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import {
  byColor,
  expect,
  expectServerEvents,
  finishedSnapshot,
  firstLegendRef,
  joinViaLink,
  planEvent,
  playLine,
  seatLetters,
  startSeeded,
  test,
} from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

const DESIGN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../packages/chess-fixtures/design/V3Game.json");

/** L.MAIN as UCI, replayed with chess.js (a typo in the design fixture fails here, not later). */
function mainLine(): { uci: string[]; finalFen: string; lastSan: string } {
  const main = (JSON.parse(readFileSync(DESIGN, "utf8")) as { lines: { MAIN: { startFen: string; san: string[] } } }).lines.MAIN;
  const chess = new Chess(main.startFen);
  const uci = main.san.map((san) => {
    const m = chess.move(san);
    return m.from + m.to + (m.promotion ?? "");
  });
  return { uci, finalFen: chess.fen(), lastSan: main.san.at(-1)! };
}

test.describe("friend game", { tag: p2("@smoke", "@local-only") }, () => {
  test(
    "create from /play on a legend, join by link, study, ready, first move",
    { tag: gameTags("state", ["waiting", "study", "abort", "their_move"]) },
    async ({ seat, telemetry }, testInfo) => {
      const [la, lb] = seatLetters(testInfo, ["A", "B"], ["C", "D"]);
      const a = await seat(la);
      const b = await seat(lb);
      const legend = await firstLegendRef(a);

      await a.page.goto(`/play?legend=${legend}`, { timeout: 180_000 });
      await a.page.getByTestId("mode-friend").click();
      await a.page.getByTestId("start-game-button").click();
      await a.page.getByTestId("go-to-game-button").click({ timeout: 150_000 });
      await a.page.waitForURL(/\/game\//, { timeout: 120_000, waitUntil: "commit" });
      const ref = new URL(a.page.url()).pathname.split("/game/")[1]!;
      await a.waitPhase("waiting", 120_000);
      await expect(a.page.getByTestId("zone-waiting")).toContainText(/Waiting for opponent/i);
      await expect(a.byTestId("copy-challenge-link")).toBeVisible();
      await expect(a.byTestId("cancel-challenge")).toBeVisible();

      await joinViaLink(b, ref);
      await a.waitPhase(/^study/, 60_000);
      await b.waitPhase(/^study/, 60_000);
      await expect(a.page.getByTestId("zone-study")).toBeVisible();
      await planEvent(telemetry, "game_viewed", { role: "player", entry: "link" }, { source: "client" });

      await a.page.getByTestId("study-ready").click();
      await b.page.getByTestId("study-ready").click();
      const s = await byColor(a, b);
      const turn = await s.w.turn();
      const other = turn === "w" ? "b" : "w";
      await s[turn].waitPhase("abort", 30_000);
      await s[other].waitPhase("their_move");
      await expect(s[turn].page.getByTestId("zone-abort")).toBeVisible();

      // First moves on both sides; the clocks start after the second.
      const p0 = await s.w.ply();
      await s[turn].board.playValidMove(turn);
      await s[other].waitPhase("abort");
      await s[other].board.playValidMove(other);
      await s.w.waitPly(p0 + 2);
      await expect(s[turn].page.locator('[data-testid="game-board-container"]')).toHaveAttribute("data-phase", /your_move|check/);
      // Leave the game finished (the creator resigns), so it is not left for a restore.
      await s[turn].board.resign();
      await s[turn].waitPhase("over_resign_loss");
      void ref;
    },
  );

  test(
    "the main line to 17.Rd8#: result, badges, PGN with clocks, telemetry once per player",
    {
      tag: [
        ...gameTags("state", ["abort", "your_move", "their_move", "check", "over_checkmate_win", "over_checkmate_loss"]),
        "@state:V3GameCheck.check",
        "@state:V3MoveBoard.orient=w",
        "@state:V3MoveBoard.orient=b",
        "@state:V3MoveBoard.mover=w",
        "@state:V3MoveBoard.mover=b",
        "@state:V3MoveBoard.mover=",
      ],
    },
    async ({ seat, seedGame, telemetry }, testInfo) => {
      test.setTimeout(300_000);
      const { uci, finalFen, lastSan } = mainLine();
      expect(uci).toHaveLength(33);
      // Other users on the phone project: the desktop copy of this test runs at the same time in CI (seatLetters).
      const [la, lb] = seatLetters(testInfo, ["A", "B"], ["C", "D"]);
      const a = await seat(la);
      const b = await seat(lb);
      telemetry.forbid(lastSan);
      telemetry.forbid(finalFen.split(" ")[0]!);
      const g = await seedGame("G-THREEFOLD", a, b); // initial position, 5+0, no study
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);
      // 11.Bxb5+ (ply 21): Black is in check on their move.
      await playLine(s, uci.slice(0, 21));
      await s.b.waitPhase("check");
      await playLine(s, uci.slice(21, -1));
      await s.w.move(uci.at(-1)!);
      await s.w.waitPhase("over_checkmate_win");
      await s.b.waitPhase("over_checkmate_loss");
      await expect(s.b.page.locator('[data-badge="mate"]')).toHaveCount(1);
      await expect(s.b.page.locator('[data-badge="win"]')).toHaveCount(1);
      await planEvent(telemetry, "game_over_viewed", { method: "checkmate" }, { source: "client" });

      const snap = await finishedSnapshot(s.w, g.ref);
      expect(snap.result).toMatchObject({ method: "checkmate", winner: "w" });

      // Share → Download PGN.
      await s.w.byTestId("share-button").click();
      const [download] = await Promise.all([s.w.page.waitForEvent("download"), s.w.page.getByTestId("download-pgn").click()]);
      const pgn = readFileSync((await download.path())!, "utf8");
      expect(pgn).toContain("%clk");
      expect(pgn).toContain(lastSan);
      expect(pgn.match(/\{\[%clk /g)).toHaveLength(33);
      await telemetry.expect("share_game", { method: "pgn" }, { source: "client" });

      // The socket's product events, once per player and none for anyone else (plan 10.1).
      // Filtered by this game's start props: friend-full's first test (A and B again, often in a parallel worker) starts
      // a 5+3 legend game with study. regression: REGRESSION-2 (webkit-iphone saw game_started ×4).
      await expectServerEvents(telemetry, "game_started", [a, b], 2, { tc: "5+0", start: "initial", study_s: 0 });
      await expectServerEvents(telemetry, "game_ended", [a, b], 2, { method: "checkmate", plies: 33 });
    },
  );
});
