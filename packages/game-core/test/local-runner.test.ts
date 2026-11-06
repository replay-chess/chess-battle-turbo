// Local runner for bot games (plan 5.3.2, 8.14, 12.1) and its journal; every `complete` body it produces must pass
// the server's adjudication (the forged-complete guard).
import assert from "node:assert/strict";
import { test } from "node:test";
import { adjudicate } from "../src/adjudicate";
import { chooseResume, journalKey, parseJournal, serializeJournal } from "../src/local/journal";
import * as local from "../src/local/runner";
import { snapshotOf, type GameRecord } from "../src/snapshot";
import { INITIAL_FEN } from "../src/constants";

const T = 1_700_000_000_000;

function snapshot(over: Partial<GameRecord> = {}, color: "w" | "b" = "w") {
  const human = { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 };
  const record: GameRecord = {
    referenceId: "cbot00000000000000000001",
    status: "IN_PROGRESS",
    mode: "BOT",
    rated: false,
    timeClass: "RAPID",
    startingFen: INITIAL_FEN,
    studySeconds: 0,
    moves: "",
    moveClocksMs: [],
    fen: null,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    whiteTimeMs: 600_000,
    blackTimeMs: 600_000,
    clockRunning: null,
    phase: "PLAYING",
    phaseEndsAt: null,
    lastMoveAt: T,
    endMethod: null,
    outcome: null,
    completedAt: null,
    updatedAt: T,
    botElo: 1400,
    meta: { rev: 0 },
    white: color === "w" ? human : null,
    black: color === "b" ? human : null,
    ...over,
  };
  return snapshotOf(record, { role: "player", color }, T);
}

const ok = (r: local.LocalResult): local.LocalGame => {
  assert.ok(r.ok, JSON.stringify(r));
  return (r as { game: local.LocalGame }).game;
};

test("start colours: the human plays Black, the bot moves first; player views", () => {
  const s = snapshot({}, "b");
  assert.equal(s.players.w.isBot, true);
  assert.equal(s.players.w.displayName, "Engine 1400");
  assert.equal(s.bot?.elo, 1400);
  assert.equal(s.header.right, "vs Engine 1400 · unrated");
  const g = local.createLocalGame(s, T);
  assert.equal(g.human, "b");
  const bad = local.humanMove(g, "e7e5", T + 10);
  assert.deepEqual(bad, { ok: false, reason: "not_your_turn" });
  const after = ok(local.botMove(g, "e2e4", T + 500));
  assert.equal(after.state.turn, "b");
});

test("clocks start after two plies; then the mover is charged", () => {
  let g = local.createLocalGame(snapshot(), T);
  g = ok(local.humanMove(g, "e2e4", T + 5_000));
  assert.deepEqual([g.state.clocks.w, g.state.clocks.run], [600_000, null]);
  g = ok(local.botMove(g, "e7e5", T + 6_000));
  assert.deepEqual([g.state.clocks.run, g.state.clocks.at], ["w", T + 6_000]);
  g = ok(local.humanMove(g, "g1f3", T + 16_000));
  assert.equal(g.state.clocks.w, 590_000);
  assert.deepEqual(g.state.clocksMs, [600_000, 600_000, 590_000]);
  assert.equal(g.rev, 3);
});

test("undo on your turn takes back two plies; while the bot thinks only yours; clocks restored", () => {
  let g = local.createLocalGame(snapshot(), T);
  g = ok(local.humanMove(g, "e2e4", T + 1_000));
  g = ok(local.botMove(g, "e7e5", T + 2_000));
  g = ok(local.humanMove(g, "g1f3", T + 12_000)); // w 590 000
  g = ok(local.botMove(g, "b8c6", T + 14_000));
  const before = g.state.clocks;
  const two = local.undo(g, T + 20_000, { botThinking: false });
  assert.ok(two);
  assert.deepEqual(two.sans, ["Nf3", "Nc6"]);
  assert.equal(two.firstPly, 3);
  assert.equal(two.game.state.moves, "e2e4 e7e5");
  assert.deepEqual(
    [two.game.state.clocks.w, two.game.state.clocks.b, two.game.state.clocks.run],
    [600_000, 600_000, "w"],
  );
  assert.equal(two.game.assists.undos, 1);
  assert.equal(two.game.rev, g.rev + 1);
  assert.notDeepEqual(two.game.state.clocks, before);

  const thinking = ok(local.humanMove(two.game, "d2d4", T + 25_000));
  const one = local.undo(thinking, T + 26_000, { botThinking: true });
  assert.deepEqual(one?.sans, ["d4"]);
  assert.equal(one?.game.state.moves, "e2e4 e7e5");
  assert.equal(local.undo(local.createLocalGame(snapshot(), T), T, { botThinking: false }), null, "nothing to undo");
});

test("end detection, resign, abort (< 2 plies only), draws; every complete body adjudicates", () => {
  const verify = (g: local.LocalGame) => {
    const body = local.completeBody(g, T + 99_000);
    assert.ok(body);
    const r = adjudicate({
      startFen: g.state.startFen,
      moves: body.moves,
      clocksMs: body.clocksMs,
      initialMs: g.state.tc?.initialMs ?? null,
      incMs: g.state.tc?.incrementMs ?? 0,
      humanSide: g.human,
      claim: { result: body.result, method: body.method },
    });
    assert.ok(r.ok, JSON.stringify(r));
    return body;
  };
  let g = local.createLocalGame(snapshot(), T);
  for (const [i, uci] of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"].entries()) {
    g = ok(i % 2 === 0 ? local.humanMove(g, uci, T + i * 1_000) : local.botMove(g, uci, T + i * 1_000));
  }
  assert.ok(g.ended);
  assert.deepEqual(verify(g), { ...verify(g), result: "w", method: "checkmate" });
  assert.equal(g.state.result?.ply, 7);

  const r = ok(local.resign(ok(local.humanMove(local.createLocalGame(snapshot(), T), "e2e4", T)), T + 1));
  assert.equal(verify(r).result, "b");

  const a = ok(local.abort(local.createLocalGame(snapshot(), T), T));
  assert.equal(verify(a).result, "aborted");
  assert.equal(a.state.result?.abortedBy, "w");
  let two = ok(local.humanMove(local.createLocalGame(snapshot(), T), "e2e4", T));
  two = ok(local.botMove(two, "e7e5", T + 1));
  assert.deepEqual(local.abort(two, T + 2), { ok: false, reason: "not_allowed" });
  const drawn = ok(local.drawAnswered(two, true, T + 3));
  assert.equal(verify(drawn).method, "agreement");
});

test("flag on tick; pause while hidden on the human's turn", () => {
  let g = local.createLocalGame(snapshot({ initialTimeSeconds: 60, whiteTimeMs: 60_000, blackTimeMs: 60_000 }), T);
  g = ok(local.humanMove(g, "e2e4", T));
  g = ok(local.botMove(g, "e7e5", T + 1_000));
  g = local.hide(g, T + 2_000);
  assert.ok(g.paused);
  assert.equal(local.tick(g, T + 500_000), g, "no flag while hidden");
  g = local.show(g, T + 32_000); // 30 s hidden do not count
  assert.equal(local.tick(g, T + 31_000 + 59_000).ended, false);
  const flagged = local.tick(g, T + 31_000 + 60_001);
  assert.ok(flagged.ended);
  assert.deepEqual([flagged.state.result?.method, flagged.state.result?.winner], ["timeout", "b"]);
});

test("journal (de)serialisation, rev on undo, resume order", () => {
  let g = local.createLocalGame(snapshot(), T);
  g = ok(local.humanMove(g, "e2e4", T + 1_000));
  g = ok(local.botMove(g, "e7e5", T + 2_000));
  g = local.hintShown(g, 1);
  const j = local.toJournal(g, T + 3_000);
  assert.equal(journalKey("cbot1"), "rc:bot:cbot1");
  const back = parseJournal(serializeJournal(j));
  assert.deepEqual(back, j);
  assert.equal(parseJournal("{bad"), null);
  assert.equal(parseJournal(JSON.stringify({ ...j, moves: ["e2e9"] })), null);
  assert.equal(parseJournal(null), null);
  assert.equal(chooseResume(back, 2), "journal");
  assert.equal(chooseResume(back, 3), "snapshot");
  assert.equal(chooseResume(null, 0), "snapshot");
  const resumed = local.resumeFromJournal(snapshot(), j, T + 10_000);
  assert.ok(resumed);
  assert.equal(resumed.state.moves, "e2e4 e7e5");
  assert.equal(resumed.rev, j.rev);
  assert.equal(resumed.assists.hints, 1);
  assert.deepEqual([resumed.state.clocks.run, resumed.state.clocks.at], ["w", T + 10_000]);
  const undone = local.undo(ok(local.humanMove(resumed, "g1f3", T + 11_000)), T + 12_000, { botThinking: true });
  assert.ok(undone && undone.game.rev > resumed.rev);
  assert.equal(local.checkpointBody(undone.game).rev, undone.game.rev);
});
