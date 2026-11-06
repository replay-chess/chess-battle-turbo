// Which store changes play which sounds (P2 plan 4.6.2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { absPly, reduceClient, type ClientAction, type ClientGame } from "@repo/game-core/client/reducer";
import { buildDemoFixture } from "../demo/fixtures";
import type { Side } from "@repo/game-core/machine/types";
import { moveSound, OPPONENT_GAIN, soundCues } from "./events";

const step = (g: ClientGame, a: ClientAction) => reduceClient(g, a).store;

function pick(fen: string, want: (m: { san: string; flags: string }) => boolean): string {
  const m = new Chess(fen).moves({ verbose: true }).find((x) => want({ san: x.san, flags: x.flags }));
  assert.ok(m, "a matching legal move");
  return m.from + m.to + (m.promotion ?? "");
}
const quiet = (m: { san: string; flags: string }) => m.flags === "n" && !/[+#]/.test(m.san);
const capture = (m: { san: string; flags: string }) => m.flags.includes("c") && !/[+#]/.test(m.san);

test("moveSound: check wins, then promotion, castle, capture", () => {
  assert.equal(moveSound({ san: "Nf3", flags: "n" }), "move");
  assert.equal(moveSound({ san: "Nxf3", flags: "c" }), "capture");
  assert.equal(moveSound({ san: "exd6", flags: "e" }), "capture");
  assert.equal(moveSound({ san: "O-O", flags: "k" }), "castle");
  assert.equal(moveSound({ san: "O-O-O", flags: "q" }), "castle");
  assert.equal(moveSound({ san: "b8=Q", flags: "np" }), "promote");
  assert.equal(moveSound({ san: "Bxb5+", flags: "c" }), "check");
  assert.equal(moveSound({ san: "Rd8#", flags: "n" }), "check");
});

test("own move: the optimistic move plays at full gain; the ack that confirms it plays nothing", () => {
  const prev = buildDemoFixture({ state: "your_move" }).game;
  const uci = pick(prev.state.fen, quiet);
  const next = step(prev, { type: "move", uci, clientMoveId: "c1", now: 1, serverNow: 1 });
  assert.deepEqual(soundCues(prev, next), [{ name: "move", gain: 1 }]);
  const toast = step(next, { type: "toastClear" });
  assert.deepEqual(soundCues(next, toast), []);
});

test("opponent move: same files at a lower gain", () => {
  const prev = buildDemoFixture({ state: "their_move" }).game; // Black's seat, White to move
  const s = prev.state;
  const uci = pick(s.fen, capture);
  const next = step(prev, {
    type: "event",
    now: 2,
    event: {
      name: "move:applied",
      payload: { seq: s.seq + 1, ref: s.ref, ply: absPly(s) + 1, uci, san: "x", by: s.turn, clocks: s.clocks },
    },
  } as ClientAction);
  assert.equal(next.state.moves.split(" ").at(-1), uci);
  assert.deepEqual(soundCues(prev, next), [{ name: "capture", gain: OPPONENT_GAIN }]);
});

test("a snapshot replace (join, sync) plays no move sound", () => {
  const prev = buildDemoFixture({ state: "your_move" }).game;
  const uci = pick(prev.state.fen, quiet);
  const moved = step(prev, { type: "move", uci, clientMoveId: "c1", now: 1, serverNow: 1 });
  const replaced = step(prev, { type: "replace", state: moved.state, reason: "sync", now: 2 });
  assert.equal(replaced.animate, false);
  assert.deepEqual(soundCues(prev, replaced), []);
});

test("game end plays game-end only, for players and spectators", () => {
  const prev = buildDemoFixture({ state: "your_move" }).game;
  const ended = { ...prev, state: { ...prev.state, phase: "ended" as const } };
  assert.deepEqual(soundCues(prev, ended), [{ name: "game-end", gain: 1 }]);
  const spect = buildDemoFixture({ state: "spectate" }).game;
  const spectEnded = { ...spect, state: { ...spect.state, phase: "ended" as const } };
  assert.deepEqual(soundCues(spect, spectEnded), [{ name: "game-end", gain: 1 }]);
});

test("spectators hear no move sounds", () => {
  const prev = buildDemoFixture({ state: "spectate" }).game;
  const uci = pick(prev.state.fen, quiet);
  const next = { ...prev, state: { ...prev.state, moves: `${prev.state.moves} ${uci}`.trim() } };
  assert.deepEqual(soundCues(prev, next), []);
});

test("notify on a draw offer, a rematch offer and the opponent leaving; premove and illegal cues", () => {
  const playing = buildDemoFixture({ state: "your_move" }).game;
  const opp: Side = playing.state.you.color === "w" ? "b" : "w";
  const offer = { ...playing, state: { ...playing.state, drawOffer: { by: opp, ply: 1 } } };
  assert.deepEqual(soundCues(playing, offer), [{ name: "notify", gain: 1 }]);
  const left = {
    ...playing,
    state: { ...playing.state, players: { ...playing.state.players, [opp]: { ...playing.state.players[opp], online: false } } },
  };
  assert.deepEqual(soundCues(playing, left), [{ name: "notify", gain: 1 }]);

  const ended = buildDemoFixture({ state: "over_checkmate_win" }).game;
  const rematch = { ...ended, state: { ...ended.state, rematch: { by: opp, expiresAt: 1, offersUsed: 1 } } };
  assert.deepEqual(soundCues(ended, rematch), [{ name: "notify", gain: 1 }]);

  const theirs = buildDemoFixture({ state: "their_move" }).game;
  const pre = step(theirs, { type: "premove", uci: "e7e6", now: 1 });
  assert.ok(pre.premove);
  assert.deepEqual(soundCues(theirs, pre), [{ name: "premove", gain: 1 }]);

  const ill = step(playing, { type: "illegal", from: "a1", to: "a8", now: 1 });
  assert.deepEqual(soundCues(playing, ill), [{ name: "illegal", gain: 1 }]);
});

test("the game going live plays game-start", () => {
  const abort = buildDemoFixture({ state: "abort" }).game;
  const live = { ...abort, state: { ...abort.state, phase: "playing" as const } };
  assert.deepEqual(soundCues(abort, live), [{ name: "game-start", gain: 1 }]);
});
