// Screen-reader announcements (P2 plan 4.4 LiveRegions): moves polite, a check on the viewer / a disconnect / game
// over assertive.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { reduceClient } from "@repo/game-core/client/reducer";
import { announce, speakSan } from "./announce";
import { buildDemoFixture } from "./demo/fixtures";

test("speakSan", () => {
  assert.equal(speakSan("Nf3"), "knight f3");
  assert.equal(speakSan("Nxf3+"), "knight takes f3, check");
  assert.equal(speakSan("exd5"), "e takes d5");
  assert.equal(speakSan("e4"), "e4");
  assert.equal(speakSan("Nbd7"), "knight b d7");
  assert.equal(speakSan("O-O"), "castles kingside");
  assert.equal(speakSan("O-O-O+"), "castles queenside, check");
  assert.equal(speakSan("b8=Q#"), "b8 promotes to queen, checkmate");
  assert.equal(speakSan("Rd8#"), "rook d8, checkmate");
});

test("an own move is announced politely as You", () => {
  const f = buildDemoFixture({ state: "your_move" });
  const prev = f.game;
  const m = new Chess(prev.state.fen).moves({ verbose: true }).find((x) => x.san === "Bxb5+")!;
  const next = reduceClient(prev, { type: "move", uci: m.from + m.to, clientMoveId: "c", now: 1, serverNow: 1 }).store;
  assert.deepEqual(announce(prev, next, f.serverNow), { polite: "You: bishop takes b5, check." });
});

test("an opponent move that checks the viewer is assertive and named", () => {
  const f = buildDemoFixture({ state: "their_move" }); // Black's seat, White to move
  const prev = f.game;
  const s = prev.state;
  const m = new Chess(s.fen).moves({ verbose: true }).find((x) => x.san === "Bxb5+")!;
  const next = { ...prev, state: { ...s, moves: `${s.moves} ${m.from}${m.to}`, inCheck: true, turn: "b" as const } };
  const a = announce(prev, next, f.serverNow);
  assert.equal(a.polite, undefined);
  assert.equal(a.assertive, `${s.players.w.displayName}: bishop takes b5, check.`);
});

test("game over is assertive with the result card's title and method", () => {
  const before = buildDemoFixture({ state: "your_move" });
  const after = buildDemoFixture({ state: "over_resign_win" });
  const prev = { ...before.game, state: { ...after.game.state, phase: "playing" as const, result: null } };
  const a = announce(prev, after.game, after.serverNow);
  assert.match(a.assertive ?? "", /^Game over\. Victory\. martin_k resigned\. Resignation · move \d+\.$/);
});

test("the opponent disconnecting is assertive; losing the own connection is polite", () => {
  const f = buildDemoFixture({ state: "your_move" });
  const prev = f.game;
  const s = prev.state;
  const left = { ...prev, state: { ...s, players: { ...s.players, b: { ...s.players.b, online: false } } } };
  assert.deepEqual(announce(prev, left, f.serverNow), { assertive: "martin_k disconnected." });
  const down = { ...prev, conn: "reconnecting" as const };
  assert.deepEqual(announce(prev, down, f.serverNow), { polite: "Connection lost. Reconnecting." });
});

test("nothing for a snapshot that rewinds, another game, or no change", () => {
  const f = buildDemoFixture({ state: "your_move" });
  assert.deepEqual(announce(f.game, f.game, f.serverNow), {});
  const other = { ...f.game, state: { ...f.game.state, ref: "cother" } };
  assert.deepEqual(announce(f.game, other, f.serverNow), {});
  const rewound = { ...f.game, state: { ...f.game.state, moves: f.game.state.moves.split(" ").slice(0, -1).join(" ") } };
  assert.deepEqual(announce(f.game, rewound, f.serverNow), {});
});
