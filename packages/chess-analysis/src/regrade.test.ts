// Engine-free regrades (phase-03 plan §8.14, P3-D28; §12.1 `CA/src/regrade.test.ts`): a GAME analysis re-graded
// from the stored arrays equals a fresh grading from the same arrays, and no engine is called (spies on process
// spawning and on fetch, the only ways this code could reach an engine).
import { strict as assert } from "node:assert";
import childProcess from "node:child_process";
import { describe, it, mock } from "node:test";
import { REVIEW_INPUTS } from "../fixtures/review-inputs";
import { gradeAnalysis, LINE_PV_MAX, type AnalysisInput, type AnalysisResult } from "./analysis";
import { encodeMove, J, NO_SECOND } from "./codec";
import { linesFromStored, regradeAnalysis, type StoredAnalysisRow } from "./regrade";
import { analysisEngine, GRADING_VERSION } from "./version";

/** What the worker's final batch writes for a fresh grading (the game_analyses columns a regrade reads). */
function storedRow(input: AnalysisInput, fresh: AnalysisResult, version = GRADING_VERSION): StoredAnalysisRow {
  return {
    version,
    engine: analysisEngine("sf18-armv8dp-0a1b2c3d"),
    evals: [...input.evals],
    second: [...input.second],
    best: [...input.best],
    judgements: fresh.judgements,
    // Through JSON, as the jsonb column returns it.
    lines: JSON.parse(JSON.stringify(fresh.lines)) as StoredAnalysisRow["lines"],
  };
}

describe("regradeAnalysis", () => {
  for (const name of Object.keys(REVIEW_INPUTS) as (keyof typeof REVIEW_INPUTS)[]) {
    it(`${name}: a regrade from the stored row equals the fresh grading`, () => {
      const input = REVIEW_INPUTS[name]();
      const fresh = gradeAnalysis(input);
      const regraded = regradeAnalysis({
        stored: storedRow(input, fresh),
        game: { startFen: input.startFen, startPly: input.startPly, moves: input.moves },
        members: input.members,
        ...(input.isBook ? { isBook: input.isBook } : {}),
      });
      const { version, changedPlies, ...rest } = regraded;
      assert.deepEqual(rest, fresh);
      assert.equal(version, GRADING_VERSION);
      assert.deepEqual(changedPlies, []);
    });
  }

  it("calls no engine: no process is spawned and nothing is fetched", () => {
    const input = REVIEW_INPUTS.GAME();
    const fresh = gradeAnalysis(input);
    const spawn = mock.method(childProcess, "spawn");
    const execFile = mock.method(childProcess, "execFile");
    const fetchSpy = mock.method(globalThis, "fetch");
    try {
      const out = regradeAnalysis({
        stored: storedRow(input, fresh, GRADING_VERSION - 1),
        game: { startFen: input.startFen, startPly: input.startPly, moves: input.moves },
        members: input.members,
        ...(input.isBook ? { isBook: input.isBook } : {}),
      });
      assert.equal(
        typeof (out as unknown as { then?: unknown }).then,
        "undefined",
        "synchronous: no await on an engine",
      );
      assert.equal(spawn.mock.callCount(), 0);
      assert.equal(execFile.mock.callCount(), 0);
      assert.equal(fetchSpy.mock.callCount(), 0);
    } finally {
      spawn.mock.restore();
      execFile.mock.restore();
      fetchSpy.mock.restore();
    }
  });

  it("an older version re-grades and reports the plies whose label changed", () => {
    const input = REVIEW_INPUTS.GAME();
    const fresh = gradeAnalysis(input);
    const old = storedRow(input, fresh, GRADING_VERSION - 1);
    // Pretend the old classifier called 44.Rxf6 "interesting" and 19.Qd2 a plain mistake.
    const judgements = [...old.judgements];
    judgements[44] = J.INTERESTING;
    judgements[36] = J.MISTAKE;
    const r = regradeAnalysis({
      stored: { ...old, judgements },
      game: { startFen: input.startFen, startPly: 0, moves: input.moves },
      members: input.members,
      ...(input.isBook ? { isBook: input.isBook } : {}),
    });
    assert.deepEqual(r.changedPlies, [36, 44]);
    assert.equal(r.judgements[36], J.MISS);
    assert.equal(r.judgements[44], J.GOOD);
  });

  it("refuses an analysis from another engine profile (that needs the engine again)", () => {
    const input = REVIEW_INPUTS.CLEAN();
    const fresh = gradeAnalysis(input);
    assert.throws(
      () =>
        regradeAnalysis({
          stored: { ...storedRow(input, fresh), engine: "sf17-x86/sf17-v3" },
          game: { startFen: input.startFen, startPly: 0, moves: input.moves },
          members: input.members,
        }),
      RangeError,
    );
  });

  it("keeps a moment's engine line and accept list through the stored lines", () => {
    const input = REVIEW_INPUTS.GAME();
    const withAlts = {
      ...input,
      lines: { ...input.lines, 36: { pv: ["f1f5", "g3h2", "g1h1"], accept: ["f1f5", "a1b1"] } },
    };
    const fresh = gradeAnalysis(withAlts);
    assert.deepEqual(fresh.lines["36"], { pv: "f1f5 g3h2 g1h1", alts: ["a1b1"], d: 301 });
    const back = linesFromStored(fresh.lines);
    assert.deepEqual(back[36], { pv: ["f1f5", "g3h2", "g1h1"], accept: ["f1f5", "a1b1"] });
    const r = regradeAnalysis({
      stored: storedRow(withAlts, fresh),
      game: { startFen: input.startFen, startPly: 0, moves: input.moves },
      members: input.members,
      ...(input.isBook ? { isBook: input.isBook } : {}),
    });
    const moment = r.reviews.w?.moments.find((m) => m.ply === 36);
    assert.deepEqual(moment?.accept, ["f1f5", "a1b1"]);
    assert.equal(moment?.pv, "f1f5 g3h2 g1h1");
  });
});

describe("gradeAnalysis", () => {
  it("stores lines for flagged plies only: errors, brilliant/great and moments", () => {
    const game = gradeAnalysis(REVIEW_INPUTS.GAME());
    assert.deepEqual(Object.keys(game.lines), ["32", "35", "36", "40"]);
    assert.deepEqual(game.lines["35"], { pv: "f5h7", alts: [], d: 362 });
    const clean = gradeAnalysis(REVIEW_INPUTS.CLEAN());
    assert.deepEqual(Object.keys(clean.lines), ["30"]);
  });

  it("cuts a stored pv to whole moves within 200 characters", () => {
    const input = REVIEW_INPUTS.GAME();
    const long = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? "f1f5" : "g3h2"));
    const r = gradeAnalysis({ ...input, lines: { ...input.lines, 36: { pv: long, accept: ["f1f5"] } } });
    const pv = r.lines["36"]!.pv;
    assert.ok(pv.length <= LINE_PV_MAX);
    assert.equal(pv.split(" ").length, 40);
  });

  it("counts, accuracy and phases come from the same arrays", () => {
    const r = gradeAnalysis(REVIEW_INPUTS.GAME());
    assert.equal(r.totalPlies, 54);
    assert.equal(r.counts.w[J.MISS], 1);
    assert.equal(r.counts.w[J.BLUNDER], 1);
    assert.equal(r.counts.b[J.BLUNDER], 1);
    assert.equal(Math.round(r.accuracy.w as number), 78);
    assert.deepEqual(r.division, { middlegamePly: 30, endgamePly: null });
    assert.equal(r.phaseAccuracy.w[2], -1);
  });

  it("refuses incomplete evals (the worker grades only finished pass-1 arrays)", () => {
    const input = REVIEW_INPUTS.CLEAN();
    assert.throws(() => gradeAnalysis({ ...input, evals: input.evals.slice(0, -1) }), RangeError);
  });

  // regression: regrade-sacrifice-reply (FIX-1). The sacrifice check reads the opponent's reply from the pass-2 PV.
  // A pass-2 ply that came out BEST was not stored in `lines`, so a regrade fell back to the stored best move of the
  // next position (here the capture dxe5) and called the same ply BRILLIANT.
  it("a pass-2 ply that is not flagged keeps its PV, so the regrade equals the fresh grading", () => {
    const input: AnalysisInput = {
      startFen: "4k3/8/3p4/8/8/5N2/8/4K3 w - - 0 1",
      startPly: 0,
      moves: ["f3e5", "e8e7"],
      evals: [100, 100, 100],
      second: [NO_SECOND, NO_SECOND, NO_SECOND],
      best: [encodeMove("f3e5"), encodeMove("d6e5"), encodeMove("e1d2")],
      lines: { 0: { pv: ["f3e5", "e8e7"], accept: ["f3e5"] } },
      members: [{ side: "w", result: null }],
    };
    const fresh = gradeAnalysis(input);
    assert.equal(fresh.judgements[0], J.BEST);
    assert.equal(fresh.lines["0"]?.pv, "f3e5 e8e7");
    const regraded = regradeAnalysis({
      stored: storedRow(input, fresh),
      game: { startFen: input.startFen, startPly: 0, moves: input.moves },
      members: input.members,
    });
    assert.deepEqual(regraded.judgements, fresh.judgements);
    assert.deepEqual(regraded.changedPlies, []);
  });
});
