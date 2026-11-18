// Chess-correctness fixtures `FX/weakness/clock-games/` (phase-06 plan §12.5; FIX-1). Six CC0 Lichess games with %clk
// and %eval (an increment game 3+2 among them), with expected errors whose clock bucket and Win% loss were read from
// the movetext independently of the code under test (expected.json; spot-checked by hand, see the hand-back). The
// inputs the four call sites store (CA computeSideInputs through the J5 pipeline, with the pinned Stockfish answers)
// must match them; a seventh case starts the longest of them from a FEN at an odd ply (`startPly` 21), where the first
// two plies use the base time (plan §8.3.1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { decodeErrorLog, encodeMove, ERROR_LOG_JUDGEMENTS, MOVE_UNKNOWN } from "@repo/chess-analysis/codec";
import { computeSideInputs } from "@repo/chess-analysis/weakness-inputs";
import { WEAKNESS_PHASES } from "@repo/chess-analysis/codec";
import type { BaselineSampleFile } from "./fixture";
import { loadBook } from "./grade";
import { finishSide, prepareSide, pvText, type PositionFacts } from "./side";

const require = createRequire(import.meta.url);
const dir = require.resolve("@repo/chess-fixtures/weakness/clock-games/expected.json").replace(/expected\.json$/, "");
const sample = JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/weakness/baseline-sample.json"), "utf8")) as BaselineSampleFile;
type Expected = { sampleId: string; color: "w" | "b"; timeControl: string; increment: number; errors: { ply: number; judgement: string; phase: string; clockBucket: number; clockSec: number; winLossFromEval: number }[] };
const expected = (JSON.parse(readFileSync(`${dir}expected.json`, "utf8")) as { games: Record<string, Expected> }).games;
const { book } = loadBook();

function prepared(id: string) {
  const s = sample.sides.find((x) => x.item.id === id)!;
  const p = prepareSide(s.item, sample.start, book);
  assert.ok(p.ok, id);
  if (!p.ok) throw new Error(id);
  const facts = new Map<number, PositionFacts>(Object.entries(s.facts).map(([k, v]) => [Number(k), v]));
  return { s, side: p.side, facts };
}

describe("FX weakness/clock-games (6 CC0 Lichess games, hand-checked clocks and losses)", () => {
  it("holds six games with %clk and %eval, an increment game among them, each the sample's own movetext", () => {
    const names = Object.keys(expected);
    assert.equal(names.length, 6);
    assert.ok(names.some((n) => expected[n]!.increment > 0 && expected[n]!.timeControl === "180+2"), "a 3+2 game");
    for (const n of names) {
      const pgn = readFileSync(`${dir}${n}.pgn`, "utf8");
      const s = sample.sides.find((x) => x.item.id === expected[n]!.sampleId)!;
      assert.ok(pgn.includes(s.item.movetext), `${n}: the movetext`);
      assert.match(pgn, /\[%clk \d+:\d\d:\d\d/);
      assert.match(pgn, /\[%eval /);
      assert.match(pgn, new RegExp(`\\[TimeControl "${expected[n]!.timeControl.replace("+", "\\+")}"\\]`));
      assert.doesNotMatch(pgn, /\[(White|Black) "(?!\?)/, "no player names");
    }
  });

  it("the stored ERROR_LOG_V1 of each side: judgement, phase, clock bucket and Win% loss of every error, in ply order", () => {
    let errors = 0;
    for (const [n, e] of Object.entries(expected)) {
      const { side, facts } = prepared(e.sampleId);
      const log = finishSide(side, facts).inputs.errorLog.map(decodeErrorLog);
      assert.equal(log.length, e.errors.length, `${n}: error count`);
      e.errors.forEach((x, k) => {
        const got = log[k]!;
        assert.equal(ERROR_LOG_JUDGEMENTS[got.judgement], x.judgement, `${n} ply ${x.ply}: judgement`);
        assert.equal(WEAKNESS_PHASES[got.phase], x.phase, `${n} ply ${x.ply}: phase`);
        assert.equal(got.clockBucket, x.clockBucket, `${n} ply ${x.ply}: clock bucket (${x.clockSec} s before the move)`);
        assert.ok(Math.abs(got.winLoss - x.winLossFromEval) <= 1, `${n} ply ${x.ply}: Win% loss ${got.winLoss} vs ${x.winLossFromEval} read from %eval`);
        errors++;
      });
    }
    assert.ok(errors >= 20, `${errors} errors checked`);
  });

  it("a game from a FEN at an odd ply: offsets from startPly, the base time before the first two plies", () => {
    const name = Object.keys(expected).sort((a, b) => Math.max(...expected[b]!.errors.map((x) => x.ply)) - Math.max(...expected[a]!.errors.map((x) => x.ply)))[0]!;
    const e = expected[name]!;
    const { side, facts } = prepared(e.sampleId);
    const K = 21;
    const n = side.replay.uci.length;
    const lines: Record<string, { pv: string }> = {};
    for (const i of side.errors) if (i >= K && (facts.get(i)?.pv.length ?? 0) > 0) lines[String(i - K)] = { pv: pvText(facts.get(i)!.pv) };
    // The engine's best moves, as finishSide stores them.
    const best = [...side.best];
    for (const need of side.needs) {
      const f = facts.get(need.index);
      best[need.index] = f?.best ? encodeMove(f.best) : MOVE_UNKNOWN;
    }
    const full = finishSide(side, facts);
    const fromFen = computeSideInputs(
      {
        startingFen: side.replay.fens[K]!,
        startPly: K,
        moves: side.replay.uci.slice(K),
        moveClocksMs: side.game.moveClocksMs.slice(K),
        initialTimeSeconds: side.game.initialTimeSeconds,
        timeClass: side.game.timeClass,
      },
      {
        evals: side.evals.slice(K),
        best: best.slice(K),
        judgements: side.judgements.slice(K),
        lines,
        middlegamePly: side.middlegamePly === null ? null : Math.max(0, side.middlegamePly - K),
        endgamePly: side.endgamePly === null ? null : Math.max(0, side.endgamePly - K),
      },
      { color: e.color, result: side.result },
    );
    const after = e.errors.filter((x) => x.ply >= K);
    const log = fromFen.errorLog.map(decodeErrorLog);
    assert.equal(log.length, after.length);
    assert.ok(n > K + 10);
    after.forEach((x, k) => {
      const got = log[k]!;
      assert.equal(ERROR_LOG_JUDGEMENTS[got.judgement], x.judgement);
      assert.equal(WEAKNESS_PHASES[got.phase], x.phase, `ply ${x.ply}`);
      // The mover's first two plies of a set-up game read the base time (≥ 180 s here: bucket by it); later ones the %clk.
      const baseSec = Number(e.timeControl.split("+")[0]);
      const want = x.ply - K < 2 ? (baseSec >= 300 ? 1 : baseSec >= 120 ? 2 : baseSec >= 60 ? 3 : 4) : x.clockBucket;
      assert.equal(got.clockBucket, want, `ply ${x.ply}`);
      assert.ok(Math.abs(got.winLoss - x.winLossFromEval) <= 1);
    });
    // The same errors as the full game from ply 21 on: the stored themes only depend on the position and the line.
    const fullAfter = full.inputs.errorLog.length - after.length;
    const themesFrom = (inp: typeof full.inputs, skip: number) => {
      let off = 0;
      for (let i = 0; i < skip; i++) off += inp.errorThemeN[i]!;
      return inp.errorThemes.slice(off);
    };
    assert.deepEqual(fromFen.errorThemes, themesFrom(full.inputs, fullAfter));
  });
});
