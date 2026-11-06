// lib/games/checkpoint.server.ts, access.server.ts and complete-bot-game.server.ts pure parts (phase-02 plan §7.1.3,
// §7.1.4, §11.1): the rev guard, rev_gap, suffix-only replay (counted with a replay spy), illegal moves, the clock
// columns, the roles, and the stored complete result. The SQL itself runs in games.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CheckpointBody } from "@repo/contracts/http/games";
import { replay } from "@repo/game-core/rules/chess";
import { ApiError } from "@/lib/api/api-error";
import { isWatchableMode, roleIn } from "./access.server";
import { assertBotPlayer, checkpointSql, isPrefix, lastClocks, movesOf, planCheckpoint, storedRevOf } from "./checkpoint.server";
import { storedResult } from "./complete-bot-game.server";
import type { GameRow } from "./snapshot.server";

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";

function row(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 1n,
    referenceId: "cgame000000000000000000000",
    status: "IN_PROGRESS",
    mode: "BOT",
    rated: false,
    timeClass: "RAPID",
    creatorId: 5n,
    opponentId: 2n,
    whitePlayerId: 5n,
    blackPlayerId: null,
    botElo: 1200,
    chessPositionId: null,
    openingId: null,
    startingFen: INITIAL,
    startPly: 0,
    studySeconds: 0,
    moves: "e2e4 e7e5",
    moveClocksMs: [],
    plyCount: 2,
    fen: AFTER_E4_E5,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    whiteTimeMs: 600000,
    blackTimeMs: 600000,
    clockRunning: null,
    phase: "PLAYING",
    phaseEndsAt: null,
    lastMoveAt: null,
    endMethod: null,
    outcome: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    meta: { v: 1, rev: 4 },
    whiteName: "Ann",
    blackName: "Engine 1200",
    whiteRating: null,
    blackRating: 1200,
    rematchOfRef: null,
    wRef: "cviewer00000000000000000000",
    wName: "Ann",
    wAvatar: null,
    bRef: null,
    bName: null,
    bAvatar: null,
    ...overrides,
  };
}

const body = (b: Partial<CheckpointBody>): CheckpointBody => ({ rev: 5, moves: ["e2e4", "e7e5"], clocksMs: [], assists: { hints: 0, undos: 0 }, ...b });

function spy() {
  const calls: { fen: string; plies: number }[] = [];
  return {
    calls,
    replay: (fen: string, moves: readonly string[]) => {
      calls.push({ fen, plies: moves.length });
      return replay(fen, moves);
    },
  };
}

describe("checkpoint plan", () => {
  it("rev guard: an older or equal rev is skipped (a 204 no-op), a game that ended is skipped", () => {
    assert.deepEqual(planCheckpoint(row(), body({ rev: 4 })), { skip: { applied: false, reason: "stale_rev" } });
    assert.deepEqual(planCheckpoint(row(), body({ rev: 1 })), { skip: { applied: false, reason: "stale_rev" } });
    assert.deepEqual(planCheckpoint(row({ status: "COMPLETED" }), body({ rev: 9 })), { skip: { applied: false, reason: "not_in_progress" } });
  });

  it("a rev more than 64 ahead is 409 conflict {reason: rev_gap}", () => {
    assert.throws(
      () => planCheckpoint(row(), body({ rev: 4 + 65 })),
      (e: unknown) => e instanceof ApiError && e.code === "conflict" && e.details?.reason === "rev_gap",
    );
    assert.ok(!("skip" in planCheckpoint(row(), body({ rev: 4 + 64 }))));
    assert.equal(storedRevOf(null), 0);
    assert.equal(storedRevOf({ rev: "x" }), 0);
  });

  it("a prefix-extending body replays only the new suffix from the stored FEN", () => {
    const s = spy();
    const plan = planCheckpoint(row(), body({ moves: ["e2e4", "e7e5", "g1f3", "b8c6"] }), s);
    assert.deepEqual(s.calls, [{ fen: AFTER_E4_E5, plies: 2 }]);
    assert.ok(!("skip" in plan));
    if (!("skip" in plan)) {
      assert.equal(plan.plyCount, 4);
      assert.match(plan.fen, /^r1bqkbnr\/pppp1ppp\/2n5\/4p3\/4P3\/5N2\/PPPP1PPP\/RNBQKB1R w/);
    }
  });

  it("a diverging body (an undo, another line) replays the whole list from the start", () => {
    const s = spy();
    planCheckpoint(row(), body({ moves: ["d2d4"] }), s);
    assert.deepEqual(s.calls, [{ fen: INITIAL, plies: 1 }]);
  });

  it("an illegal move is 422 illegal_moves with the absolute index", () => {
    assert.throws(
      () => planCheckpoint(row(), body({ moves: ["e2e4", "e7e5", "e1e3"] })),
      (e: unknown) => e instanceof ApiError && e.code === "illegal_moves" && e.details?.index === 2,
    );
  });

  it("clock columns: each side's clock after its last ply (Black-to-move starts too)", () => {
    assert.deepEqual(lastClocks(INITIAL, [59000, 58000, 57000]), { w: 57000, b: 58000 });
    assert.deepEqual(lastClocks("8/8/8/8/8/8/k7/K7 b - - 0 1", [59000]), { w: null, b: 59000 });
    assert.deepEqual(lastClocks(INITIAL, []), { w: null, b: null });
  });

  it("helpers and the guarded UPDATE", () => {
    assert.deepEqual(movesOf(" e2e4  e7e5 "), ["e2e4", "e7e5"]);
    assert.deepEqual(movesOf(""), []);
    assert.equal(isPrefix(["a"], ["a", "b"]), true);
    assert.equal(isPrefix(["a", "c"], ["a", "b"]), false);
    const sql = checkpointSql(1n, 5n, body({}), { fen: AFTER_E4_E5, plyCount: 2, w: null, b: null });
    const text = sql.strings.join("?").replace(/\s+/g, " ");
    assert.match(text, /COALESCE\(\(meta->>'rev'\)::int, 0\) < \?/);
    assert.match(text, /status = 'IN_PROGRESS' AND mode IN \('BOT', 'LEGEND_BOT'\)/);
    assert.match(text, /"whitePlayerId" = \? OR "blackPlayerId" = \?/);
  });
});

describe("who may checkpoint / complete / read", () => {
  it("players of the bot game only: 404 unknown, 403 other members, 409 not_bot_game for a live game", () => {
    assert.throws(() => assertBotPlayer(null, 5n), (e: unknown) => e instanceof ApiError && e.code === "not_found");
    assert.throws(() => assertBotPlayer(row(), 9n), (e: unknown) => e instanceof ApiError && e.code === "forbidden");
    assert.throws(
      () => assertBotPlayer(row({ mode: "FRIEND" }), 5n),
      (e: unknown) => e instanceof ApiError && e.code === "conflict" && e.details?.reason === "not_bot_game",
    );
    assert.equal(assertBotPlayer(row(), 5n).side, "w");
  });

  it("roles come from the colour columns; legacy rows fall back to creator/opponent; spectators only on live modes", () => {
    assert.deepEqual(roleIn(row(), 5n), { role: "player", color: "w" });
    assert.deepEqual(roleIn(row({ whitePlayerId: null, blackPlayerId: 7n }), 7n), { role: "player", color: "b" });
    assert.deepEqual(roleIn(row({ whitePlayerId: null, blackPlayerId: null, opponentId: 8n }), 8n), { role: "player", color: null });
    assert.deepEqual(roleIn(row(), 9n), { role: "none" });
    assert.deepEqual(roleIn(row({ mode: "ONLINE", blackPlayerId: 6n }), 9n), { role: "spectator" });
    assert.deepEqual(roleIn(row(), null), { role: "none" });
    assert.equal(isWatchableMode("TOURNAMENT"), true);
    assert.equal(isWatchableMode("LEGEND_BOT"), false);
  });
});

describe("stored complete result", () => {
  it("maps the stored end; unknown ends are not expressible", () => {
    assert.deepEqual(storedResult({ status: "ABORTED", outcome: "NONE", endMethod: "ABORTED" }), {
      status: "ABORTED",
      outcome: "NONE",
      method: "aborted",
      analysis: { status: "none" },
    });
    assert.deepEqual(storedResult({ status: "COMPLETED", outcome: "WHITE", endMethod: "FIFTY_MOVE" }), {
      status: "COMPLETED",
      outcome: "WHITE",
      method: "fifty_move",
      analysis: { status: "none" },
    });
    assert.equal(storedResult({ status: "COMPLETED", outcome: "WHITE", endMethod: "OTHER" }), null);
    assert.equal(storedResult({ status: "CANCELLED", outcome: null, endMethod: null }), null);
  });
});
