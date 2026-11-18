// Aggregation (phase-06 plan §8.5, §12.1): k, L, gamesWith and phaseCount on handmade inputs; an error with two themes
// counts in both; time pressure counts blunders under a minute over M_lt1 and the loss of every error under a minute
// over M; rows without inputs are left out; corrupt arrays throw.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { err, gameInput } from "../../test/gen";
import { aggregate, patternAgg, phaseModeOf, ratePer100 } from "./aggregate";
import { analysedOf } from "./compute";
import { decodeGame } from "./records";

const at = new Date("2026-11-10T12:00:00Z");

describe("aggregate", () => {
  const games = analysedOf([
    gameInput({
      gameId: "1",
      color: "w",
      endedAt: at,
      phaseMoves: [10, 20, 10],
      clockMoves: [20, 10, 6, 4],
      errors: [
        err(["fork", "hangingPiece"], { winLoss: 30, phase: 1 }),
        err(["fork"], { winLoss: 10, phase: 0 }),
        err([], { judgement: 1, clockBucket: 4, winLoss: 40, phase: 2 }),
        err(["pin"], { judgement: 0, clockBucket: 4, winLoss: 8, phase: 2 }),
      ],
    }),
    gameInput({ gameId: "2", color: "b", endedAt: at, phaseMoves: [10, 30, 0], clockMoves: [40, 0, 0, 0], errors: [err(["fork"], { winLoss: 20, judgement: 1, clockBucket: 1 })] }),
    gameInput({ gameId: "3", color: "w", endedAt: at, unanalysed: true }),
    gameInput({ gameId: "4", color: "w", endedAt: at, noInputs: true, errors: [err(["fork"])] }),
  ]);

  it("leaves out unanalysed rows and rows without inputs", () => {
    assert.equal(games.length, 2);
  });

  it("counts k, L, gamesWith and phaseCount per theme; two themes count in both", () => {
    const a = aggregate(games);
    assert.equal(a.M, 80);
    assert.equal(a.Mlt1, 4);
    const fork = patternAgg(a, "fork");
    assert.equal(fork.k, 3);
    assert.equal(fork.L, 60);
    assert.equal(fork.games.size, 2);
    assert.deepEqual(fork.phaseCount, [1, 2, 0]);
    const hp = patternAgg(a, "hangingPiece");
    assert.equal(hp.k, 1);
    assert.equal(hp.L, 30);
    assert.equal(ratePer100(fork.k, a.M), 3.75);
    assert.equal(patternAgg(a, "skewer").k, 0);
  });

  it("time pressure: blunders under a minute over M_lt1, loss of every error under a minute over M", () => {
    const a = aggregate(games);
    assert.equal(a.tp.k, 1, "the lt1 mistake is not a blunder");
    assert.equal(a.tp.L, 48, "40 + 8: every error under a minute");
    assert.equal(ratePer100(a.tp.k, a.Mlt1), 25);
    assert.deepEqual(a.tp.phaseCount, [0, 0, 1]);
    assert.equal(patternAgg(a, "pin").eventsLt1, 1);
    assert.deepEqual(a.clockBlunders, [1, 0, 0, 1]);
    assert.deepEqual(a.clockMoves, [60, 10, 6, 4]);
    assert.deepEqual(a.phaseMoves, [20, 50, 10]);
  });

  it("phaseMode: the most events, ties to the middlegame then the opening", () => {
    assert.equal(phaseModeOf([3, 3, 3]), "middlegame");
    assert.equal(phaseModeOf([3, 1, 3]), "opening");
    assert.equal(phaseModeOf([0, 0, 2]), "endgame");
    assert.equal(phaseModeOf([0, 0, 0]), null);
  });

  it("refuses corrupt input arrays", () => {
    const g = gameInput({ gameId: "9", color: "w", endedAt: at, errors: [err(["fork"])] });
    assert.throws(() => decodeGame({ ...g, errorThemeN: [2] }), /Σ errorThemeN/);
    assert.throws(() => decodeGame({ ...g, errorThemeN: [] }), /errorThemeN entries/);
    assert.throws(() => decodeGame({ ...g, errorLog: [20_000] }), /ERROR_LOG_V1/);
    assert.equal(decodeGame({ ...g, stats: g.stats.slice(0, 29) }), null, "an older shorter STATS array reads as not computed");
  });
});
