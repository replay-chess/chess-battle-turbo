// The /dev/ui/game fixtures (P2 plan 4.9, DoD "every lit state reachable"): every one of the 55 states builds, every
// lit state derives itself, the unlit ones derive their named P2 fallback, and stress=1 is the testing-X9 game.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIT_STATES, UNLIT_STATES, deriveViewState } from "@repo/game-core/client/viewState";
import { splitMoves } from "@repo/game-core/rules/chess";
import { DESIGN_STATES, STRESS_NAMES, STRESS_PLIES, buildDemoFixture, isDesignState } from "./fixtures";

test("all 55 states build a fixture", () => {
  assert.equal(DESIGN_STATES.length, 55);
  for (const state of DESIGN_STATES) {
    const f = buildDemoFixture({ state });
    assert.equal(f.requested, state);
    assert.equal(f.game.state.serverNow, f.serverNow, `${state}: hydration snapshot pinned to the fixture time`);
  }
});

test("every lit state derives itself at the fixture time", () => {
  for (const state of LIT_STATES) {
    const f = buildDemoFixture({ state });
    assert.equal(f.derived, state, state);
    assert.equal(deriveViewState(f.game, f.serverNow).primary, state, state);
    assert.equal(f.lit, true);
    assert.deepEqual(f.notes, [], state);
  }
});

test("the unlit states render their P2 fallback with a note", () => {
  const expected: Record<string, string> = {
    tournament: "your_move",
    over_analysing: "over_checkmate_win",
    over_legend: "over_checkmate_win",
    over_tournament: "over_checkmate_win",
    over_guest: "over_checkmate_win",
  };
  for (const state of UNLIT_STATES) {
    const f = buildDemoFixture({ state });
    assert.equal(f.lit, false);
    assert.equal(f.derived, expected[state], state);
    assert.equal(f.notes.length, 1, state);
  }
  assert.equal(buildDemoFixture({ state: "over_tournament" }).game.state.mode, "TOURNAMENT");
});

test("side=b shows Black's store when Black reaches the same state, else the default seat with a note", () => {
  const promo = buildDemoFixture({ state: "over_checkmate_loss", side: "w" });
  assert.equal(promo.viewer, "b", "only Black is mated");
  assert.equal(promo.notes.length, 1);
  const stalemate = buildDemoFixture({ state: "over_stalemate", side: "b" });
  assert.equal(stalemate.viewer, "b");
  assert.equal(stalemate.derived, "over_stalemate");
  assert.deepEqual(stalemate.notes, []);
});

test("mode=spectate and mode=bot", () => {
  const spect = buildDemoFixture({ state: "over_checkmate_win", mode: "spectate" });
  assert.equal(spect.viewer, "spect");
  assert.equal(spect.derived, "over_spectator");
  const bot = buildDemoFixture({ state: "over_checkmate_win", mode: "bot" });
  assert.equal(bot.game.state.mode, "BOT");
  assert.ok(bot.game.bot, "bot view on");
  assert.equal(bot.derived, "over_checkmate_win");
});

test("variants: server restart, engine error, other tab", () => {
  const restart = buildDemoFixture({ state: "reconnecting", variant: "restart" });
  assert.ok(restart.game.restarting);
  assert.ok(restart.game.state.frozen);
  assert.equal(buildDemoFixture({ state: "bot", variant: "engine_error" }).game.bot?.engineError, true);
  assert.equal(buildDemoFixture({ state: "bot", variant: "other_tab" }).game.bot?.otherTab, true);
});

test("stress=1: 120 plies, 20-character names, three-digit move numbers, deterministic", () => {
  const a = buildDemoFixture({ state: "your_move", stress: true });
  const b = buildDemoFixture({ state: "your_move", stress: true });
  assert.equal(splitMoves(a.game.state.moves).length, STRESS_PLIES);
  assert.equal(a.game.state.moves, b.game.state.moves);
  assert.equal(a.game.state.players.w.displayName, STRESS_NAMES.w);
  assert.equal(STRESS_NAMES.w.length, 20);
  assert.equal(STRESS_NAMES.b.length, 20);
  assert.equal(a.derived, "your_move");
  const lastPly = a.game.state.startPly + STRESS_PLIES; // absolute ply of the last move
  const lastNo = Math.floor((lastPly - 1) / 2) + 1;
  assert.ok(lastNo >= 100, `move ${lastNo}`);
});

test("isDesignState", () => {
  assert.equal(isDesignState("your_move"), true);
  assert.equal(isDesignState("nope"), false);
  assert.equal(isDesignState(undefined), false);
});
