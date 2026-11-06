import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LADDER,
  allowsMateInOne,
  chooseBotMove,
  defaultBotElo,
  engineSetup,
  ladderRow,
  mulberry32,
  parseEloFloor,
} from "../src/bot/strength";
import { advanceHint, hintView, nextHintLevel } from "../src/bot/hints";
import { botAcceptsDraw, botThinkDelayMs, canOfferDrawToBot, drawAnswerDelayMs } from "../src/local/drawPolicy";
import { INITIAL_FEN } from "../src/constants";

test("ladder rows (plan 8.13)", () => {
  assert.deepEqual(
    LADDER.map((r) => r.elo),
    [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200],
  );
  assert.deepEqual(ladderRow(400).weaken, { altPct: 0.35, maxLossCp: 300, randomPct: 0.1 });
  assert.equal(ladderRow(1200).nodes, 6000);
  assert.equal(ladderRow(1300).elo, 1200); // ties go to the lower rung
  assert.equal(ladderRow(2200).nodes, 250_000);
  const low = engineSetup(ladderRow(800), 1320);
  assert.deepEqual(low.options, [
    ["UCI_LimitStrength", "false"],
    ["Skill Level", "2"],
    ["MultiPV", "4"],
  ]);
  assert.equal(low.go, "go nodes 1500");
  const high = engineSetup(ladderRow(1800), 1320);
  assert.deepEqual(high.options.slice(0, 2), [
    ["UCI_LimitStrength", "true"],
    ["UCI_Elo", "1800"],
  ]);
});

test("default Elo from a rating: rounded to 100, clamped to 400–2200, else 1200", () => {
  assert.equal(defaultBotElo(1184), 1200);
  assert.equal(defaultBotElo(1150), 1200);
  assert.equal(defaultBotElo(1149), 1100);
  assert.equal(defaultBotElo(150), 400);
  assert.equal(defaultBotElo(2900), 2200);
  assert.equal(defaultBotElo(null), 1200);
});

test("the UCI_Elo floor fallback", () => {
  const uci = "id name Stockfish 18\noption name UCI_Elo type spin default 1320 min 1320 max 3190\nuciok";
  assert.equal(parseEloFloor(uci), 1320);
  assert.equal(parseEloFloor("uciok"), null);
  const fb = engineSetup(ladderRow(1400), 1450);
  assert.ok(fb.floorFallback);
  assert.equal(fb.go, "go nodes 12000");
  assert.deepEqual(fb.options[1], ["Skill Level", "7"]);
  assert.ok(!engineSetup(ladderRow(1400), 1320).floorFallback);
});

test("weakened choice is seeded by ref + ply and never allows mate in one", () => {
  const fen = INITIAL_FEN;
  const lines = [
    { uci: "e2e4", cp: 30 },
    { uci: "d2d4", cp: 25 },
    { uci: "g1f3", cp: 20 },
    { uci: "f2f3", cp: -400 },
  ];
  const a = chooseBotMove({ ref: "cref", ply: 0, fen, row: ladderRow(400), lines });
  const b = chooseBotMove({ ref: "cref", ply: 0, fen, row: ladderRow(400), lines });
  assert.equal(a, b);
  assert.equal(chooseBotMove({ ref: "cref", ply: 0, fen, row: ladderRow(2000), lines }), "e2e4");
  const picks = new Set<string>();
  for (let ply = 0; ply < 200; ply++) picks.add(chooseBotMove({ ref: "x", ply, fen, row: ladderRow(400), lines }));
  assert.ok(picks.has("e2e4") && picks.size > 1);
  assert.ok(!picks.has("f2f3"), "a line losing 430 cp is never an alternative at 400 (< 300 cp)");
  // After 1.f3 e5 2.g4?? Black mates with Qh4; White must never choose g2g4 randomly in that spot.
  const danger = "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2";
  assert.ok(allowsMateInOne(danger, "g2g4"));
  for (let ply = 0; ply < 300; ply++) {
    const mv = chooseBotMove({ ref: "y", ply, fen: danger, row: ladderRow(400), lines: [{ uci: "e2e4", cp: 0 }] });
    assert.notEqual(mv, "g2g4");
  }
  const r = mulberry32(42);
  const xs = [r(), r(), r()];
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("hint levels name the piece, then the move; a new position resets the level", () => {
  assert.equal(hintView(1, INITIAL_FEN, "g1f3")?.text, "Hint 1 of 2: look at your knight.");
  assert.equal(hintView(1, INITIAL_FEN, "e2e4")?.text, "Hint 1 of 2: look at your pawn on e2.");
  const two = hintView(2, INITIAL_FEN, "g1f3");
  assert.equal(two?.text, "Hint 2 of 2: play Nf3.");
  assert.deepEqual(two?.arrow, { from: "g1", to: "f3", color: "#0369a1" });
  const castle = "r3kbnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/R3KBNR w KQkq - 6 5";
  assert.equal(hintView(2, castle, "e1c1")?.text, "Hint 2 of 2: castle long, O-O-O.");
  let t = null as ReturnType<typeof advanceHint> | null;
  assert.equal(nextHintLevel(t, INITIAL_FEN), 1);
  t = advanceHint(t, INITIAL_FEN, 1);
  assert.equal(nextHintLevel(t, INITIAL_FEN), 2);
  t = advanceHint(t, INITIAL_FEN, 2);
  assert.equal(nextHintLevel(t, INITIAL_FEN), null);
  assert.equal(nextHintLevel(t, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"), 1);
});

test("bot draw policy and think time (plan 8.15)", () => {
  assert.equal(botAcceptsDraw({ plies: 60, evalCp: 29 }), true);
  assert.equal(botAcceptsDraw({ plies: 59, evalCp: 0 }), false);
  assert.equal(botAcceptsDraw({ plies: 80, evalCp: -30 }), false);
  assert.equal(botAcceptsDraw({ plies: 80, evalCp: null }), false);
  assert.equal(canOfferDrawToBot(1), false);
  assert.equal(drawAnswerDelayMs(0), 1500);
  assert.equal(drawAnswerDelayMs(0.999), 2499);
  assert.equal(botThinkDelayMs({ rand: 0, legalMoves: 20, remainingMs: 600_000 }), 450);
  assert.equal(botThinkDelayMs({ rand: 1, legalMoves: 40, remainingMs: 600_000 }), 1000);
  assert.equal(botThinkDelayMs({ rand: 1, legalMoves: 40, remainingMs: 20_000 }), 400);
  assert.equal(botThinkDelayMs({ rand: 0.5, legalMoves: 40, remainingMs: 5_000 }), 100);
  assert.equal(botThinkDelayMs({ rand: 0.5, legalMoves: 40, remainingMs: null }), 650);
});
