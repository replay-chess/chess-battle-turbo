import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEvent } from "../index";
import { gameClientEvents, gameServerEvents, gameSocketEvents } from "./game";

const valid: { [K in keyof typeof gameClientEvents]: Record<string, unknown> } = {
  engine_init: { ok: true, cached: false, ms: 812, elo_floor: 1320, source: "origin" },
  hint_used: { level: 2 },
  undo_used: {},
  game_over_cta: { cta: "analyse" },
  share_game: { method: "pgn" },
  flip_board: { on: true },
  sound_toggled: { on: false },
  game_viewed: { role: "player", entry: "link", phase: "playing" },
  game_board_ready: { ms_to_board: 640, ms_to_join_ack: 820 },
  move_rejected: { code: "stale_ply" },
  illegal_move: { reason: "pinned" },
  premove_set: {},
  premove_dropped: { reason: "illegal" },
  promotion_picked: { piece: "n" },
  draw_offered: { implicit: false },
  draw_answered: { accepted: true },
  resign_opened: { ply: 12 },
  resign_confirmed: { ply: 12 },
  resign_cancelled: { ply: 12 },
  rematch_offered: {},
  rematch_answered: { accepted: false },
  reconnect: { duration_ms: 2_400, success: true, cause: "offline" },
  server_restart_notice_shown: { in_game: true },
  in_game_auth_refresh: { result: "ok" },
  game_server_error: { code: "sync_failed" },
  game_over_viewed: { method: "checkmate", result: "win" },
  spectate_started: { source: "live_list" },
  spectate_left: { duration_ms: 30_000 },
  shortcut_used: { key: "f" },
};

describe("game events", () => {
  for (const [name, schema] of Object.entries(gameClientEvents)) {
    const sample = valid[name as keyof typeof gameClientEvents];
    it(`${name} accepts its documented shape`, () => assert.equal(schema.safeParse(sample).success, true));
    it(`${name} refuses extra keys`, () => assert.equal(schema.safeParse({ ...sample, fen: "8/8/8/8/8/8/8/8 w - - 0 1" }).success, false));
  }
  it("engine_init allows a failed init without an Elo floor", () => {
    assert.equal(gameClientEvents.engine_init.safeParse({ ok: false, cached: false, ms: 8000, elo_floor: null, source: "r2" }).success, true);
  });
  it("hint_used only takes levels 1 and 2", () => {
    assert.equal(gameClientEvents.hint_used.safeParse({ level: 3 }).success, false);
  });
  it("bot_game_started / bot_game_completed accept their documented shapes and nothing else", () => {
    const started = { elo: 1200, color: "b", start_kind: "legend", reason: "rematch" };
    const completed = { result: "win", method: "checkmate", plies: 41, hints: 1, undos: 0 };
    assert.equal(gameServerEvents.bot_game_started.safeParse(started).success, true);
    assert.equal(gameServerEvents.bot_game_completed.safeParse(completed).success, true);
    assert.equal(gameServerEvents.bot_game_started.safeParse({ ...started, ref: "cm123" }).success, false);
    assert.equal(gameServerEvents.bot_game_completed.safeParse({ ...completed, pgn: "1. e4" }).success, false);
    assert.equal(gameServerEvents.bot_game_completed.safeParse({ ...completed, result: "won" }).success, false);
  });
  // regression: REGRESSION-2 — the socket's events were unregistered ("unregistered event" in the e2e audit).
  it("the socket events parse with the props LiveSession sends (mode, time_class, app_env) and refuse extras", () => {
    const common = { app_env: "test", mode: "friend", time_class: "blitz" };
    const samples = {
      game_started: { ...common, rated: false, tc: "5+3", study_s: 30, start: "position" },
      game_ended: { ...common, method: "resignation", result: "loss", plies: 42, duration_ms: 61_234, draw_offers: 1, premoves: 0 },
      game_aborted: { ...common, reason: "timeout", by: "self" },
      rematch_expired: { ...common, reason: "timeout" },
    };
    for (const [name, props] of Object.entries(samples)) {
      assert.deepEqual(parseEvent(name, props), { ok: true }, name);
      assert.equal(parseEvent(name, { ...props, fen: "8/8/8/8/8/8/8/8 w - - 0 1" }).ok, false, `${name} + fen`);
    }
    assert.equal(parseEvent("game_started", { ...samples.game_started, tc: "untimed" }).ok, true);
    assert.equal(parseEvent("game_started", { ...samples.game_started, tc: "0.5+0" }).ok, true);
    assert.equal(parseEvent("game_aborted", { ...samples.game_aborted, by: "w" }).ok, false);
    assert.equal(Object.keys(gameSocketEvents).length, 4);
  });
});
