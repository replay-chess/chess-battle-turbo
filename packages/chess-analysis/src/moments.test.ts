// Key moments, the clean game and the best decision (phase-03 plan §8.5, §8.6; §12.1 `CA/src/moments.test.ts`):
// GAME → plies [32, 36, 40]; spacing; fill only below 3 primaries and only with d ≥ 7; decided positions excluded;
// ≤ 3; ascending order; isClean for CLEAN; bestPly = 30; the clean-loss template; and the pass-2 helpers.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { GAME_MOMENTS, mockGradeInput } from "../fixtures/labels/design-mock";
import { classifyGame, type GradeRule, type PlyGrade } from "./classify";
import { encodeCp, encodeMate, J, type JudgementCode } from "./codec";
import {
  acceptMoves,
  bestPly,
  FILL_MIN_LOSS,
  isCleanGame,
  MAX_MOMENTS,
  momentCandidates,
  pass2Candidates,
  pickMoments,
  PV_MAX_PLIES,
  trimPv,
  worstMoment,
} from "./moments";
import { CLEAN_LOSS_LINE } from "./text/clean";
import { summarySentences } from "./text/summary";
import { INITIAL_FEN } from "./board";
import { replaySan, uciOf } from "./replay";

const gameInput = mockGradeInput("GAME");
const GAME_GRADES = classifyGame(gameInput);
const CLEAN_GRADES = classifyGame(mockGradeInput("CLEAN"));

/** A synthetic graded ply (White moves on even plies). */
function g(ply: number, code: JudgementCode, loss: number, winBefore = 50): PlyGrade {
  const rule: GradeRule = code === J.MISS ? "miss" : code >= J.INACCURACY ? "severity" : "best";
  return { ply, code, base: code, rule, winBefore, winAfter: winBefore - loss, loss };
}

/** Plies 0 … n − 1, BEST everywhere except the given ones. */
function game(n: number, special: PlyGrade[]): PlyGrade[] {
  const out: PlyGrade[] = [];
  for (let i = 0; i < n; i++) out.push(special.find((s) => s.ply === i) ?? g(i, J.BEST, 0));
  return out;
}

describe("pickMoments", () => {
  it("GAME → plies 32 (fill), 36 (MISS), 40 (BLUNDER): the design's three moments", () => {
    const picks = pickMoments(GAME_GRADES, "w", "w");
    assert.deepEqual(
      picks.map((p) => p.ply),
      GAME_MOMENTS.map((m) => m.ply),
    );
    assert.deepEqual(
      picks.map((p) => [p.ply, p.code, p.fill]),
      [
        [32, J.INACCURACY, true],
        [36, J.MISS, false],
        [40, J.BLUNDER, false],
      ],
    );
    assert.ok(Math.abs((picks[0] as { loss: number }).loss - 9.9) < 0.1);
  });

  it("the opponent's side has its own moments (Black's 18…Bg3 blunder)", () => {
    assert.deepEqual(
      pickMoments(GAME_GRADES, "b", "w").map((p) => [p.ply, p.code]),
      [[35, J.BLUNDER]],
    );
  });

  it("skips a candidate within 3 plies of a picked one (a member ply 2 plies away)", () => {
    const grades = game(30, [g(10, J.BLUNDER, 30), g(12, J.MISTAKE, 12), g(16, J.MISTAKE, 11)]);
    assert.deepEqual(
      pickMoments(grades, "w", "w").map((p) => p.ply),
      [10, 16],
    );
  });

  it("fills with inaccuracies only below 3 primaries, and only with d ≥ 7", () => {
    const three = game(40, [g(4, J.BLUNDER, 20), g(12, J.MISTAKE, 11), g(20, J.MISTAKE, 10), g(28, J.INACCURACY, 9.9)]);
    assert.deepEqual(
      pickMoments(three, "w", "w").map((p) => p.ply),
      [4, 12, 20],
    );
    const one = game(40, [g(4, J.BLUNDER, 20), g(12, J.INACCURACY, FILL_MIN_LOSS), g(20, J.INACCURACY, 6.99)]);
    assert.deepEqual(
      pickMoments(one, "w", "w").map((p) => [p.ply, p.fill]),
      [
        [4, false],
        [12, true],
      ],
    );
  });

  it("never more than 3, ordered by ply, ranked by loss then MISS > BLUNDER > MISTAKE", () => {
    const many = game(60, [
      g(4, J.MISTAKE, 11),
      g(12, J.BLUNDER, 25),
      g(20, J.MISS, 25),
      g(28, J.MISTAKE, 14),
      g(36, J.BLUNDER, 16),
    ]);
    const picks = pickMoments(many, "w", "w");
    assert.equal(picks.length, MAX_MOMENTS);
    assert.deepEqual(
      picks.map((p) => p.ply),
      [12, 20, 36],
    );
    assert.deepEqual(
      momentCandidates(many, "w", "w").map((p) => p.ply),
      [20, 12, 36, 28, 4],
    );
    assert.equal(worstMoment(picks)?.ply, 20);
  });

  it("excludes decided positions (both Win% below 10, or both above 90)", () => {
    const grades = game(30, [g(4, J.BLUNDER, 5.5, 9.5), g(8, J.MISTAKE, 6, 96), g(12, J.MISTAKE, 10, 95)]);
    // ply 4: 9.5 → 4.0 (lost already); ply 8: 96 → 90 (still winning, both > 90 is false: 90 is not > 90).
    assert.deepEqual(
      pickMoments(grades, "w", "w").map((p) => p.ply),
      [8, 12],
    );
    const decided = game(30, [g(8, J.MISTAKE, 5.5, 96)]);
    assert.deepEqual(pickMoments(decided, "w", "w"), []);
  });

  it("skips plies without a known best move", () => {
    const grades = game(30, [g(10, J.BLUNDER, 30), g(20, J.MISTAKE, 12)]);
    assert.deepEqual(
      pickMoments(grades, "w", "w", { hasBest: (p) => p !== 10 }).map((p) => p.ply),
      [20],
    );
  });

  it("worstMoment prefers a primary over a bigger fill", () => {
    const picks = pickMoments(game(40, [g(4, J.MISTAKE, 10), g(20, J.INACCURACY, 9.9)]), "w", "w");
    assert.equal(worstMoment(picks)?.ply, 4);
    assert.equal(worstMoment([]), null);
  });
});

describe("clean game and best decision", () => {
  it("CLEAN is clean for the member, GAME is not", () => {
    assert.ok(isCleanGame(CLEAN_GRADES, "w", "w"));
    assert.ok(!isCleanGame(GAME_GRADES, "w", "w"));
  });

  it("an inaccuracy below the fill threshold keeps a game clean", () => {
    assert.ok(isCleanGame(game(20, [g(6, J.INACCURACY, 6.9)]), "w", "w"));
    assert.ok(!isCleanGame(game(20, [g(6, J.INACCURACY, 7)]), "w", "w"));
  });

  it("bestPly: CLEAN's 16.Qb8+ (ply 30, BRILLIANT)", () => {
    assert.equal(bestPly(CLEAN_GRADES, "w", "w"), 30);
  });

  it("bestPly: the first GREAT without a BRILLIANT, else the largest gain among real choices", () => {
    assert.equal(bestPly(game(20, [g(6, J.GREAT, 0), g(10, J.GREAT, 0)]), "w", "w"), 6);
    const gains = game(20, [
      { ...g(4, J.BEST, 0), winBefore: 50, winAfter: 58 },
      { ...g(8, J.FORCED, 0), winBefore: 40, winAfter: 70 },
      { ...g(12, J.EXCELLENT, 0), winBefore: 50, winAfter: 55 },
    ]);
    assert.equal(bestPly(gains, "w", "w"), 4);
    assert.equal(bestPly(game(10, []), "w", "w"), null);
  });

  it("the clean-loss template closes the summary of a clean game the member lost", () => {
    const s = summarySentences({
      accuracy: 93,
      oppAccuracy: 90,
      phaseAccuracy: [95, 92, -1],
      turningPoint: null,
      momentsCount: 0,
      isClean: true,
      result: "loss",
    });
    assert.equal(s.at(-1)?.t, CLEAN_LOSS_LINE);
    assert.equal(CLEAN_LOSS_LINE, "You kept the balance; the result came from elsewhere.");
  });
});

describe("pass-2 helpers", () => {
  const fen = gameInput.replay.fens[36] as string;

  it("trimPv keeps 3–8 plies and stops after the first capture sequence", () => {
    // Rxf5 Bh2+ Kh1: a capture, then quiet moves → cut after the capture run, but never below 3.
    assert.deepEqual(trimPv(fen, ["f1f5", "g3h2", "g1h1", "c7e7", "d2f2"]), ["f1f5", "g3h2", "g1h1"]);
    const start = replaySan(INITIAL_FEN, ["e4", "d5"]);
    // exd5 Qxd5 Nc3 Qa5 d4 …: the capture run ends before Nc3, and the 3-ply minimum keeps Nc3.
    const line = ["e4d5", "d8d5", "b1c3", "d5a5", "d2d4", "c7c6", "g1f3", "c8f5", "f1c4", "e7e6"];
    assert.deepEqual(trimPv(start.fens[2] as string, line), ["e4d5", "d8d5", "b1c3"]);
    // A quiet start, then a capture run (exd5 Nxd5), then quiet: cut right after the run.
    const later = ["g1f3", "g8f6", "e4d5", "f6d5", "c2c4", "d5b4", "d2d4", "c8f5", "b1a3"];
    assert.deepEqual(trimPv(start.fens[2] as string, later), ["g1f3", "g8f6", "e4d5", "f6d5"]);
  });

  it("trimPv stops at 8 plies of quiet moves and at the first illegal move", () => {
    const quiet = ["g1f3", "g8f6", "b1c3", "b8c6", "d2d3", "d7d6", "c1g5", "c8g4", "f1e2", "f8e7"];
    assert.equal(trimPv(INITIAL_FEN, quiet).length, PV_MAX_PLIES);
    assert.deepEqual(trimPv(INITIAL_FEN, ["e2e4", "e2e4"]), ["e2e4"]);
  });

  it("acceptMoves keeps MultiPV moves within 2 Win% of the best, best first", () => {
    const lines = [
      { uci: "f1f5", eval: encodeCp(350) },
      { uci: "d1d2", eval: encodeCp(330) },
      { uci: "e2d1", eval: encodeCp(200) },
    ];
    assert.deepEqual(acceptMoves(lines, "w"), ["f1f5", "d1d2"]);
    // Black to move: the scores are White POV, so lower is better for Black.
    assert.deepEqual(
      acceptMoves(
        [
          { uci: "a7a6", eval: encodeCp(-120) },
          { uci: "h7h6", eval: encodeCp(-110) },
          { uci: "g7g6", eval: encodeCp(-60) },
        ],
        "b",
      ),
      ["a7a6", "h7h6"],
    );
    assert.deepEqual(
      acceptMoves(
        [
          { uci: "e1g1", eval: encodeMate("w", 2) },
          { uci: "e1f1", eval: encodeMate("w", 4) },
        ],
        "w",
      ),
      ["e1g1", "e1f1"],
    );
    assert.deepEqual(acceptMoves([], "w"), []);
  });

  it("pass2Candidates: the member's moments first, then BRILLIANT candidates, at most 6 − reserve", () => {
    const clean = mockGradeInput("CLEAN");
    const plies = pass2Candidates({
      grades: CLEAN_GRADES,
      members: ["w"],
      startMover: "w",
      fens: clean.replay.fens,
      uci: clean.replay.uci,
    });
    assert.ok(plies.includes(30), `16.Qb8+ is a BRILLIANT candidate: ${plies.join(",")}`);
    const both = pass2Candidates({
      grades: GAME_GRADES,
      members: ["w", "b"],
      startMover: "w",
      fens: gameInput.replay.fens,
      uci: gameInput.replay.uci,
      reserve: 2,
    });
    assert.ok(both.length <= 4);
    assert.deepEqual(both.slice(0, 2), [36, 35]);
    assert.ok(both.includes(40));
  });

  it("the design's moment lines replay (GAME_MOMENTS)", () => {
    for (const m of GAME_MOMENTS) {
      const fenBefore = gameInput.replay.fens[m.ply] as string;
      assert.equal(uciOf(fenBefore, m.best), m.uci);
    }
  });
});
