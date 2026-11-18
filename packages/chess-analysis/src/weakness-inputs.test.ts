// weakness-inputs.ts (phase-06 plan §8.3.2, §12.1, §12.5): computeSideInputs on the design mock game and on real CC0
// Lichess games (fixtures/weakness-inputs.ts). The golden file pins the output every call site must reproduce (the
// worker's final batch, the B-W1 backfill, the heal, J5); the real games are also re-derived here from the raw
// export arrays (centisecond clocks, Lichess evals) without clock.ts or the codec's encoder.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { CC0_CASES, designClocks, weaknessInputCases, weaknessInputsGolden, type WeaknessInputCase } from "../fixtures/weakness-inputs";
import { STATS_V1_LENGTH, J, decodeErrorLogs, decodeMove, decodeStatsV1, encodeMate, moverAt } from "./codec";
import { replayUci } from "./replay";
import { Chess } from "chess.js";
import { ERROR_THEMES_DROPPED, META_THEMES, tagErrorPly, tagThemes, type ErrorPlyInput } from "./themes/index";
import { WEAKNESS_INPUTS_VERSION, computeSideInputs, phaseOfPly } from "./weakness-inputs";

const require = createRequire(import.meta.url);
const CASES = weaknessInputCases();
const GOLDEN = weaknessInputsGolden();
const byName = (name: string): WeaknessInputCase => {
  const c = CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no case ${name}`);
  return c;
};
const run = (c: WeaknessInputCase) => computeSideInputs(c.game, c.analysis, c.side);
const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
const sideErrorPlies = (c: WeaknessInputCase, codes: readonly number[]) => {
  const start = replayUci(c.game.startingFen, []).startMover;
  return c.analysis.judgements.flatMap((j, i) => (moverAt(i, start) === c.side.color && codes.includes(j) ? [i] : []));
};

describe("computeSideInputs: the golden fixtures", () => {
  it("every case equals its golden output (the pin every call site shares)", () => {
    assert.deepEqual(Object.keys(GOLDEN), CASES.map((c) => c.name));
    for (const c of CASES) assert.deepEqual(run(c), GOLDEN[c.name], c.name);
    assert.equal(WEAKNESS_INPUTS_VERSION, 1);
  });

  it("a caller's own replay gives the same output (the worker passes the pipeline's replay)", () => {
    for (const c of CASES) {
      const replay = replayUci(c.game.startingFen, c.game.moves.toString().split(" "));
      assert.deepEqual(computeSideInputs(c.game, c.analysis, c.side, { replay }), GOLDEN[c.name], c.name);
    }
  });

  it("the design game, member White: two errors, hand-checked", () => {
    const out = run(byName("design-game-w"));
    // Ply 36 is a MISS (code 11) and ply 40 a BLUNDER (12); ply 32 is an INACCURACY and is not logged. Both are
    // middlegame plies (the Divider puts the middlegame at ply 30). White's clock before ply 36 is its clock after
    // ply 34: 590 000 − 17·32 000 = 46 000 ms, under a minute (bucket 4); before ply 40: 590 000 − 19·32 000 → 5 000.
    // MISS:    (2 << 12) | (1 << 10) | (4 << 7) | 30 = 9758
    // BLUNDER: (1 << 12) | (1 << 10) | (4 << 7) | 23 = 5655
    assert.deepEqual(out.errorLog, [9758, 5655]);
    assert.deepEqual(out.errorThemeN, [1, 2]);
    assert.deepEqual(out.errorThemes, ["hangingPiece", "rc:defendedTarget", "rc:missedThreat"]);
    const s = decodeStatsV1(out.stats);
    assert.ok(s);
    assert.equal(s.moves, 15); // 27 White plies − 12 BOOK
    assert.deepEqual(s.phaseErrors, [0, 2, 0]);
    assert.deepEqual(s.clockErrors, [0, 0, 0, 2]);
    assert.equal(s.converted, false); // White lost
    assert.equal(s.bookExitWin, 48);
    assert.deepEqual(designClocks(4), [590_000, 595_000, 558_000, 582_000]);
  });

  it("the design game, member Black: the blunder at ply 35 with five minutes left; a conversion", () => {
    const out = run(byName("design-game-b"));
    // (1 << 12) | (1 << 10) | (1 << 7) | 36 = 5284: Black's clock before ply 35 = 595 000 − 16·13 000 = 387 000 (> 5 min).
    assert.deepEqual(out.errorLog, [5284]);
    const s = decodeStatsV1(out.stats);
    assert.equal(s?.reachedPlus3, true);
    assert.equal(s?.converted, true);
  });

  it("a game from a set-up position (odd startPly) has no book exit", () => {
    const c = byName("design-from-19-b");
    assert.equal(c.game.startPly, 19);
    const out = run(c);
    assert.equal(out.stats[29], -1);
    assert.equal(decodeStatsV1(out.stats)?.bookExitWin, null);
    // The same blunder, now ply offset 16 of the set-up game.
    assert.deepEqual(out.errorLog, [5284]);
  });
});

describe("computeSideInputs: invariants on every case", () => {
  it("the counters add up and the arrays line up", () => {
    for (const c of CASES) {
      const out = run(c);
      const s = decodeStatsV1(out.stats);
      assert.ok(s, c.name);
      assert.equal(out.stats.length, STATS_V1_LENGTH);
      assert.equal(sum(s.phaseMoves), s.moves, `${c.name}: phases`);
      assert.equal(sum(s.pieceMoves), s.moves, `${c.name}: pieces`);
      assert.ok(sum(s.clockMoves) <= s.moves, `${c.name}: clocks`);
      const errors = out.errorLog.length;
      assert.equal(sum(s.phaseErrors), errors, `${c.name}: phase errors`);
      assert.equal(sum(s.pieceErrors), errors, `${c.name}: piece errors`);
      const log = decodeErrorLogs(out.errorLog);
      assert.equal(sum(s.clockErrors), log.filter((e) => e.clockBucket > 0).length, `${c.name}: clock errors`);
      assert.equal(out.errorThemeN.length, errors, `${c.name}: errorThemeN per error`);
      assert.equal(sum(out.errorThemeN), out.errorThemes.length, `${c.name}: Σ errorThemeN`);
      assert.ok(out.errorThemeN.every((k) => k >= 0 && k <= 8));
      for (const t of out.errorThemes) {
        assert.ok(!META_THEMES.includes(t) && !["opening", "middlegame", "endgame", "mate", "rc:timePressure"].includes(t), `${c.name}: ${t}`);
      }
    }
  });

  it("logs the side's MISTAKE, BLUNDER and MISS plies in ascending ply order, never an inaccuracy", () => {
    let inaccuracies = 0;
    for (const c of CASES) {
      const plies = sideErrorPlies(c, [J.MISTAKE, J.BLUNDER, J.MISS]);
      const log = decodeErrorLogs(run(c).errorLog);
      assert.equal(log.length, plies.length, c.name);
      plies.forEach((p, k) => {
        const j = c.analysis.judgements[p];
        assert.equal(log[k]?.judgement, j === J.MISTAKE ? 0 : j === J.BLUNDER ? 1 : 2, `${c.name} ply ${p}`);
        const ph = phaseOfPly(p, c.analysis);
        assert.equal(log[k]?.phase, ph === "opening" ? 0 : ph === "middlegame" ? 1 : 2, `${c.name} ply ${p}`);
      });
      inaccuracies += sideErrorPlies(c, [J.INACCURACY]).length;
    }
    assert.ok(inaccuracies > 0, "the fixtures contain inaccuracies, and none was logged");
  });
});

describe("computeSideInputs: real games re-derived from the raw CC0 export", () => {
  interface Raw {
    moves: string;
    clocks?: number[];
    analysis?: ({ eval: number } | { mate: number })[];
    clock?: { initial: number };
  }
  const raw = (JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/import/source/cc0-pool.json"), "utf8")) as { games: Raw[] }).games;
  // Win% as research §1 defines it, written out here: cp clamped to ±1000, a mate counts as ±1000.
  const win = (cpWhite: number, side: "w" | "b") => {
    const cp = Math.max(-1000, Math.min(1000, side === "w" ? cpWhite : -cpWhite));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  };
  const cpOfRaw = (a: { eval: number } | { mate: number } | undefined, fallback: number) =>
    a === undefined ? fallback : "mate" in a ? (a.mate > 0 ? 1000 : -1000) : a.eval;

  for (const [index, color] of CC0_CASES) {
    it(`cc0 game ${index} (${color}): clock buckets and Win% losses from the export's own arrays`, () => {
      const c = byName(`cc0-${index}-${color}`);
      const g = raw[index] as Raw;
      const plies = sideErrorPlies(c, [J.MISTAKE, J.BLUNDER, J.MISS]);
      const log = decodeErrorLogs(run(c).errorLog);
      assert.ok(plies.length > 0, "the game has errors to check");
      plies.forEach((p, k) => {
        // The clock before ply p: the same side's centiseconds two plies back, or the initial time.
        const ms = p >= 2 ? (g.clocks?.[p - 2] as number) * 10 : (g.clock?.initial ?? 0) * 1000;
        const bucket = ms < 60_000 ? 4 : ms < 120_000 ? 3 : ms < 300_000 ? 2 : 1;
        assert.equal(log[k]?.clockBucket, bucket, `ply ${p}: ${ms} ms`);
        // analysis[i] is the eval after ply i; the mated final position counts as −1000 for the mated side.
        const before = p === 0 ? 20 : cpOfRaw(g.analysis?.[p - 1], 0);
        // Ply p odd is Black's move: a Black mate leaves White mated (−1000 from White's side), and vice versa.
        const mated = p % 2 === 1 ? -1000 : 1000;
        const after = cpOfRaw(g.analysis?.[p], mated);
        const loss = Math.min(100, Math.round(Math.max(0, win(before, color) - win(after, color))));
        assert.equal(log[k]?.winLoss, loss, `ply ${p}`);
      });
    });
  }

  it("covers each clock bucket, each phase and each judgement across the real games", () => {
    const seen = { clock: new Set<number>(), phase: new Set<number>(), judgement: new Set<number>() };
    for (const [i, color] of CC0_CASES) {
      for (const e of decodeErrorLogs(run(byName(`cc0-${i}-${color}`)).errorLog)) {
        seen.clock.add(e.clockBucket);
        seen.phase.add(e.phase);
        seen.judgement.add(e.judgement);
      }
    }
    assert.deepEqual([...seen.clock].sort(), [1, 2, 3, 4]);
    assert.deepEqual([...seen.phase].sort(), [0, 1, 2]);
    assert.deepEqual([...seen.judgement].sort(), [0, 1, 2]);
  });
});

describe("computeSideInputs: the tagger call and the clock rules", () => {
  const design = () => byName("design-game-w");

  it("uses the stored pass-2 line when present, the best move otherwise, and the next position's best as the refutation", () => {
    const c = design();
    const calls: ErrorPlyInput[] = [];
    computeSideInputs(c.game, c.analysis, c.side, { tagger: (i) => (calls.push(i), []) });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]?.bestLine, (c.analysis.lines?.["36"]?.pv ?? "").split(" "));
    assert.equal(calls[0]?.phase, "MIDDLEGAME");
    assert.equal(calls[0]?.evalBest, c.analysis.evals[36]);
    // Ply 37's best move (its stored line when flagged, else best[37]).
    const next = c.analysis.lines?.["37"]?.pv.split(" ")[0] ?? decodeMove(c.analysis.best[37] ?? 0);
    assert.equal(calls[0]?.refuteUci, next);

    const noLines = { ...c.analysis, lines: {} };
    const calls2: ErrorPlyInput[] = [];
    computeSideInputs(c.game, noLines, c.side, { tagger: (i) => (calls2.push(i), []) });
    assert.deepEqual(calls2[0]?.bestLine, [decodeMove(c.analysis.best[36] ?? 0)]);
    assert.deepEqual(calls2[1]?.bestLine, [decodeMove(c.analysis.best[40] ?? 0)]);
  });

  it("keeps at most 8 themes per error and drops the meta, phase and mate tags", () => {
    const c = design();
    const many = ["fork", "pin", "skewer", "hangingPiece", "sacrifice", "trappedPiece", "discoveredAttack", "doubleCheck", "exposedKing"];
    const out = computeSideInputs(c.game, c.analysis, c.side, { tagger: () => many });
    assert.deepEqual(out.errorThemeN, [8, 8]);
    assert.deepEqual(out.errorThemes.slice(0, 8), many.slice(0, 8));
  });

  it("an untimed game and a DAILY game count no clock slots and log bucket 0", () => {
    for (const game of [{ ...design().game, moveClocksMs: [] }, { ...design().game, timeClass: "DAILY" }]) {
      const out = computeSideInputs(game, design().analysis, design().side);
      const s = decodeStatsV1(out.stats);
      assert.deepEqual(s?.clockMoves, [0, 0, 0, 0]);
      assert.deepEqual(s?.clockErrors, [0, 0, 0, 0]);
      assert.equal(s?.moves, 15);
      assert.ok(decodeErrorLogs(out.errorLog).every((e) => e.clockBucket === 0));
    }
  });

  it("refuses rows that do not belong together", () => {
    const c = design();
    assert.throws(() => computeSideInputs(c.game, { ...c.analysis, evals: c.analysis.evals.slice(1) }, c.side), RangeError);
    assert.throws(() => computeSideInputs(c.game, { ...c.analysis, judgements: c.analysis.judgements.slice(3) }, c.side), RangeError);
    assert.throws(() => computeSideInputs({ ...c.game, moves: "e2e4 e2e4" }, c.analysis, c.side), RangeError);
  });
});

describe("tagErrorPly (the thin wrapper over the P5 tagger)", () => {
  interface PuzzleFile {
    with: [string, string, string, number, string][];
  }
  const puzzles = (theme: string) =>
    (JSON.parse(readFileSync(require.resolve(`@repo/chess-fixtures/puzzles/${theme}.json`), "utf8")) as PuzzleFile).with.slice(0, 25);
  /** A CC0 puzzle as an error ply: the position after the setup move, the solution as the best line, another move played. */
  const asError = (fen: string, moves: string, mateIn: number | null): ErrorPlyInput => {
    const [setup, ...line] = moves.split(" ");
    const chess = new Chess(fen);
    const m = chess.move({ from: setup!.slice(0, 2), to: setup!.slice(2, 4), promotion: setup![4] });
    const played = chess.moves({ verbose: true }).find((x) => `${x.from}${x.to}${x.promotion ?? ""}` !== line[0]);
    const solver = chess.turn();
    return {
      fenBefore: chess.fen(),
      bestLine: line,
      playedUci: played ? `${played.from}${played.to}${played.promotion ?? ""}` : (line[0] as string),
      refuteUci: null,
      evalBest: mateIn === null ? 250 * (solver === "w" ? 1 : -1) : encodeMate(solver, mateIn),
      phase: "MIDDLEGAME",
      setupUci: setup!,
      setupCaptured: !!m.captured,
    };
  };

  it("returns the tagger's own keys, in its order, without meta, phase and generic mate tags", () => {
    for (const [theme, mateIn] of [["mateIn1", 1], ["fork", null], ["hangingPiece", null], ["backRankMate", 2]] as const) {
      for (const [, fen, moves] of puzzles(theme)) {
        const e = asError(fen, moves, mateIn);
        const full = tagThemes({
          fen: e.fenBefore,
          line: e.bestLine,
          setupUci: e.setupUci ?? null,
          setupCaptured: e.setupCaptured ?? false,
          cp: mateIn === null ? 250 : null,
          mateIn,
          review: { playedUci: e.playedUci, refuteUci: null, pv: e.bestLine, phase: "MIDDLEGAME" },
        }).themes;
        const got = tagErrorPly(e);
        assert.deepEqual(got, full.filter((t) => !ERROR_THEMES_DROPPED.has(t)).slice(0, 8), `${theme} ${fen}`);
        assert.ok(got.length <= 8);
        for (const t of got) assert.ok(!META_THEMES.includes(t) && !["opening", "middlegame", "endgame", "mate"].includes(t), t);
      }
    }
  });

  it("keeps the named mates: a missed mate in one is tagged mateIn1, never the generic mate", () => {
    const tagged = puzzles("mateIn1").map(([, fen, moves]) => tagErrorPly(asError(fen, moves, 1)));
    const hits = tagged.filter((t) => t.includes("mateIn1")).length;
    assert.ok(hits / tagged.length >= 0.85, `${hits}/${tagged.length} mate-in-one errors tagged mateIn1`);
    assert.ok(tagged.every((t) => !t.includes("mate")));
  });

  it("an error with no known best move has nothing to tag", () => {
    const e = asError(...(puzzles("fork")[0]!.slice(1, 3) as [string, string]), null);
    assert.deepEqual(tagErrorPly({ ...e, bestLine: [] }), []);
    assert.deepEqual(tagErrorPly({ ...e, bestLine: [""] }), []);
  });
});
