// DB record → GameState/GameSnapshot (plan 5.1, 7.1.2, 8.10): roles, spectator one-ply cut, results, bots.
import assert from "node:assert/strict";
import { test } from "node:test";
import { endMethodFromDb, endMethodToDb, outcomeToDb, phaseToDb, snapshotOf, type GameRecord } from "../src/snapshot";
import { INITIAL_FEN } from "../src/constants";
import { LEGEND_FEN, LEGEND_MOVES } from "./helpers";

const T = 1_700_000_000_000;
const base: GameRecord = {
  referenceId: "cgame0000000000000000000001",
  status: "IN_PROGRESS",
  mode: "FRIEND",
  rated: false,
  timeClass: "BLITZ",
  startingFen: LEGEND_FEN,
  startPly: 18,
  studySeconds: 30,
  moves: LEGEND_MOVES.slice(0, 4).join(" "),
  moveClocksMs: [300_000, 300_000, 290_000, 285_000],
  fen: null,
  initialTimeSeconds: 300,
  incrementSeconds: 3,
  whiteTimeMs: 290_000,
  blackTimeMs: 285_000,
  clockRunning: "w",
  phase: "PLAYING",
  phaseEndsAt: null,
  lastMoveAt: T - 2_000,
  endMethod: null,
  outcome: null,
  completedAt: null,
  updatedAt: T - 2_000,
  botElo: null,
  meta: { header: "C41 · Philidor", prefixSan: ["e4", "e5"], prefixStartMoveNo: 1, rev: 0 },
  white: { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 },
  black: { ref: "cuserblack0000000000000001", name: "martin_k", avatarUrl: "https://x/a.png", rating: 1212 },
};

test("player snapshot: moves, clocks, header, watchable", () => {
  const s = snapshotOf(base, { role: "player", color: "w" }, T);
  assert.equal(s.moves.split(" ").length, 4);
  assert.deepEqual(s.clocks, { w: 290_000, b: 285_000, run: "w", at: T - 2_000 });
  assert.equal(s.turn, "w");
  assert.equal(s.header.right, "Friend game · 5+3");
  assert.equal(s.timeClass, "blitz");
  assert.equal(s.tc?.label, "5+3");
  assert.equal(s.watchable, true);
  assert.equal(s.you.color, "w");
  assert.equal(s.players.b.initials, "MK");
  assert.equal(s.prefix.sans, "e4 e5");
  assert.equal(s.status, "IN_PROGRESS");
});

test("spectator snapshot: one ply behind while playing, no offers; full line once ended", () => {
  const s = snapshotOf(base, { role: "spectator" }, T);
  assert.equal(s.moves.split(" ").length, 3);
  assert.equal(s.clocksMs.length, 3);
  assert.equal(s.turn, "b");
  assert.equal(s.header.right, "Watching · Blitz 5+3");
  assert.equal(s.drawOffer, null);
  const done = snapshotOf(
    { ...base, status: "COMPLETED", endMethod: "RESIGNATION", outcome: "BLACK", completedAt: T },
    { role: "spectator" },
    T,
  );
  assert.equal(done.moves.split(" ").length, 4);
  assert.deepEqual(done.result, { winner: "b", method: "resignation", ply: 22, endedAt: T });
  assert.equal(done.clocks.run, null);
  assert.equal(done.phase, "ended");
});

test("aborted games carry abortedBy; DB enum mappings round trip", () => {
  const s = snapshotOf(
    {
      ...base,
      status: "ABORTED",
      moves: "",
      moveClocksMs: [],
      endMethod: "ABORTED",
      outcome: "NONE",
      meta: { abortedBy: "timeout" },
    },
    { role: "player", color: "b" },
    T,
  );
  assert.deepEqual(s.result, { winner: null, method: "aborted", ply: 18, endedAt: T - 2_000, abortedBy: "timeout" });
  assert.equal(endMethodToDb("fifty_move"), "FIFTY_MOVE");
  assert.equal(endMethodFromDb("TIMEOUT_VS_INSUFFICIENT"), "timeout_vs_insufficient");
  assert.equal(endMethodFromDb("OTHER"), null);
  assert.equal(outcomeToDb(null, "aborted"), "NONE");
  assert.equal(outcomeToDb(null, "agreement"), "DRAW");
  assert.equal(phaseToDb("first_move"), "FIRST_MOVE");
});

test("study and first-move deadlines come from phaseEndsAt; bot games are private and always `playing`", () => {
  const study = snapshotOf(
    { ...base, moves: "", moveClocksMs: [], phase: "STUDY", phaseEndsAt: T + 20_000 },
    { role: "player", color: "w" },
    T,
  );
  assert.deepEqual(study.study, { endsAt: T + 20_000, ready: { w: false, b: false } });
  const fm = snapshotOf(
    { ...base, moves: LEGEND_MOVES[0]!, moveClocksMs: [300_000], phase: "FIRST_MOVE", phaseEndsAt: T + 9_000 },
    { role: "player", color: "b" },
    T,
  );
  assert.deepEqual(fm.firstMove, { side: "b", deadlineAt: T + 9_000 });
  const bot = snapshotOf(
    {
      ...base,
      mode: "BOT",
      black: null,
      botElo: 1600,
      startingFen: INITIAL_FEN,
      startPly: 0,
      moves: "",
      moveClocksMs: [],
      phase: null,
    },
    { role: "player", color: "w" },
    T,
  );
  assert.equal(bot.watchable, false);
  assert.equal(bot.phase, "playing");
  assert.deepEqual([bot.players.b.isBot, bot.players.b.displayName, bot.bot?.elo], [true, "Engine 1600", 1600]);
  assert.equal(bot.header.right, "vs Engine 1600 · unrated");
});
