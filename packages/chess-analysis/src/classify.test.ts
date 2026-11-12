// classify.ts (phase-03 plan §8.4, §12.1, §12.4; task A4 acceptance: green including the full GAME/CLEAN mock with
// the documented differences).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import {
  CLEAN,
  CLEAN_RD1_SECOND,
  DIFFERENCES,
  EXPECTED,
  GAME,
  MOCKS,
  USER_SIDE,
  mockEvals,
  mockGradeInput,
  type MockName,
} from "../fixtures/labels/design-mock";
import { edgeGradeInput, loadEdgeFiles } from "../fixtures/labels/edge";
import { INITIAL_FEN } from "./board";
import {
  BRILLIANT_RULE,
  GREAT_RULE,
  SEVERITY,
  classifyGame,
  classifyPly,
  countJudgements,
  gradeCodes,
  isSacrifice,
  plyLoss,
  severityOf,
  type PlyContext,
} from "./classify";
import { J, NO_SECOND, encodeMate, judgementKey } from "./codec";
import { replaySan } from "./replay";
import { winPct } from "./winpct";

const keys = (name: MockName) => classifyGame(mockGradeInput(name)).map((g) => judgementKey(g.code));

/** The position before CLEAN 16.Qb8+ (Opera Game) and its sacrifice reply. */
const OPERA_BEFORE_QB8 = (() =>
  replaySan(
    INITIAL_FEN,
    CLEAN.slice(0, 30).map((p) => p.san),
  ).fens[30] as string)();

function ctx(over: Partial<PlyContext>): PlyContext {
  return {
    ply: 10,
    mover: "w",
    fenBefore: INITIAL_FEN,
    played: "e2e4",
    legalCount: 20,
    evalBefore: 0,
    evalAfter: 0,
    second: NO_SECOND,
    best: null,
    reply: null,
    book: false,
    oppPrev: null,
    ...over,
  };
}

describe("rule 4: severity thresholds (≥)", () => {
  it("labels exactly at 5, 10 and 15", () => {
    assert.equal(severityOf(4.9999), null);
    assert.equal(severityOf(SEVERITY.INACCURACY), J.INACCURACY);
    assert.equal(severityOf(9.9999), J.INACCURACY);
    assert.equal(severityOf(SEVERITY.MISTAKE), J.MISTAKE);
    assert.equal(severityOf(14.9999), J.MISTAKE);
    assert.equal(severityOf(SEVERITY.BLUNDER), J.BLUNDER);
  });

  it("flips at the nearest integer evals on each side of every threshold (edge fixture)", () => {
    const g = loadEdgeFiles().find((f) => f.name === "thresholds")?.games[0];
    assert.ok(g);
    const grades = classifyGame(edgeGradeInput(g));
    const losses = grades.map((x) => x.loss);
    for (const [i, side, t] of [
      [0, "below", 5],
      [1, "above", 5],
      [2, "below", 10],
      [3, "above", 10],
      [4, "below", 15],
      [5, "above", 15],
    ] as const) {
      const d = losses[i] as number;
      assert.ok(side === "below" ? d < t && d > t - 0.1 : d >= t && d < t + 0.1, `ply ${i}: ${d}`);
    }
    assert.deepEqual(
      grades.map((x) => judgementKey(x.code)),
      g.expected,
    );
  });
});

describe("rule 3: mate rules", () => {
  it("MateCreated: cpBefore −1000 / −800 / −500 → INACCURACY / MISTAKE / BLUNDER", () => {
    const after = encodeMate("b", 5);
    assert.equal(classifyPly(ctx({ evalBefore: -1000, evalAfter: after })).code, J.INACCURACY);
    assert.equal(classifyPly(ctx({ evalBefore: -800, evalAfter: after })).code, J.MISTAKE);
    assert.equal(classifyPly(ctx({ evalBefore: -500, evalAfter: after })).code, J.BLUNDER);
    assert.equal(classifyPly(ctx({ evalBefore: -500, evalAfter: after })).rule, "mate_created");
    // From Black's side: Black was +1200 and allows a White mate. The −999/−700 bands are for a mover who was
    // already lost, so this is a BLUNDER.
    assert.equal(classifyPly(ctx({ mover: "b", evalBefore: -1200, evalAfter: encodeMate("w", 2) })).code, J.BLUNDER);
  });

  it("MateLost: the mover had mate, then cpAfter > 999 / > 700 / else, or now being mated", () => {
    const before = encodeMate("w", 2);
    assert.equal(classifyPly(ctx({ evalBefore: before, evalAfter: 1200 })).code, J.INACCURACY);
    assert.equal(classifyPly(ctx({ evalBefore: before, evalAfter: 800 })).code, J.MISTAKE);
    assert.equal(classifyPly(ctx({ evalBefore: before, evalAfter: 300 })).code, J.BLUNDER);
    assert.equal(classifyPly(ctx({ evalBefore: before, evalAfter: encodeMate("b", 4) })).code, J.BLUNDER);
    assert.equal(classifyPly(ctx({ evalBefore: before, evalAfter: 300 })).rule, "mate_lost");
  });

  it("MateDelayed: a slower mate gets no negative label", () => {
    const g = classifyPly(ctx({ evalBefore: encodeMate("w", 1), evalAfter: encodeMate("w", 6), best: "d2d4" }));
    assert.equal(g.code, J.EXCELLENT);
    assert.equal(g.loss, 0);
  });

  it("runs the mate edge fixtures (Scholar's Mate, the missed mate, lost/delayed/created variants)", () => {
    const file = loadEdgeFiles().find((f) => f.name === "mates");
    assert.ok(file);
    for (const g of file.games) {
      assert.deepEqual(
        classifyGame(edgeGradeInput(g)).map((x) => judgementKey(x.code)),
        g.expected,
        g.id,
      );
    }
  });
});

describe("rule 5: MISS", () => {
  it("is GAME ply 36 (19.Qd2 missing Rxf5 after 18…Bg3??)", () => {
    const grades = classifyGame(mockGradeInput("GAME"));
    const ply36 = grades[36];
    assert.ok(ply36);
    assert.equal(ply36.code, J.MISS);
    assert.equal(ply36.base, J.BLUNDER);
    assert.ok((grades[35]?.loss ?? 0) >= 10, "the opponent's previous ply lost ≥ 10");
  });

  it("is not a MISS when the opponent's previous move was only an inaccuracy", () => {
    const base = { evalBefore: 290, evalAfter: -62 };
    const miss = classifyPly(ctx({ ...base, oppPrev: { loss: 36, evalBefore: -130 } }));
    assert.equal(miss.code, J.MISS);
    const notMiss = classifyPly(ctx({ ...base, oppPrev: { loss: 7, evalBefore: -130 } }));
    assert.equal(notMiss.code, J.BLUNDER);
    // GAME ply 40 (21.Bxc6?? after 20…Re8, a quiet move): BLUNDER.
    assert.equal(classifyGame(mockGradeInput("GAME"))[40]?.code, J.BLUNDER);
  });

  it("needs cpBefore ≥ 200 and a winning-chances jump of 0.6 without a mate", () => {
    const opp = { loss: 30, evalBefore: -130 };
    assert.equal(classifyPly(ctx({ evalBefore: 190, evalAfter: -200, oppPrev: opp })).code, J.BLUNDER);
    // The opponent's blunder only took White from +100 to +290: the jump is too small.
    assert.equal(
      classifyPly(ctx({ evalBefore: 290, evalAfter: -62, oppPrev: { loss: 30, evalBefore: 100 } })).code,
      J.BLUNDER,
    );
  });

  it("never replaces an INACCURACY", () => {
    const g = classifyPly(ctx({ evalBefore: 300, evalAfter: 200, oppPrev: { loss: 40, evalBefore: -300 } }));
    assert.equal(g.code, J.INACCURACY);
  });
});

describe("rule 6: BRILLIANT and the sacrifice check", () => {
  it("is CLEAN ply 30, 16.Qb8+ (a queen sacrifice that forces mate)", () => {
    const grades = classifyGame(mockGradeInput("CLEAN"));
    assert.equal(grades[30]?.code, J.BRILLIANT);
    assert.ok(isSacrifice(OPERA_BEFORE_QB8, "b3b8", "d7b8"));
  });

  it("is not BRILLIANT for a non-mating sacrifice when cpBefore > +300, and is at ≤ +300", () => {
    const qb8 = { fenBefore: OPERA_BEFORE_QB8, played: "b3b8", best: "b3b8", reply: "d7b8", legalCount: 40 };
    const high = classifyPly(ctx({ ...qb8, evalBefore: 350, evalAfter: 360 }));
    assert.equal(high.code, J.BEST);
    const low = classifyPly(ctx({ ...qb8, evalBefore: BRILLIANT_RULE.MAX_CP_BEFORE - 20, evalAfter: 290 }));
    assert.equal(low.code, J.BRILLIANT);
    // Same evals, but a reply the position does not allow (Ke7 walks into the g5 bishop): no sacrifice proven.
    assert.equal(classifyPly(ctx({ ...qb8, evalBefore: 280, evalAfter: 290, reply: "e8e7" })).code, J.BEST);
    // A sacrifice that loses more than 2 Win% (here when another move was best) is not BRILLIANT.
    assert.equal(classifyPly(ctx({ ...qb8, best: "c1b1", evalBefore: 280, evalAfter: 240 })).code, J.GOOD);
  });

  it("counts an exchange sacrifice but not a plain trade", () => {
    assert.equal(isSacrifice("6k1/6p1/5n2/8/8/8/5R2/6K1 w - - 0 1", "f2f6", "g7f6"), true);
    // Nxd5 Nxd5 and the bishop wins the knight back: a trade, not a sacrifice.
    assert.equal(isSacrifice("6k1/8/5n2/3p4/8/1BN5/8/6K1 w - - 0 1", "c3d5", "f6d5"), false);
    assert.equal(isSacrifice(INITIAL_FEN, "e2e4", null), false);
    // A legal reply that captures nothing.
    assert.equal(isSacrifice(INITIAL_FEN, "e2e4", "e7e5"), false);
    // A reply that is not legal after the played move proves nothing.
    assert.equal(isSacrifice(INITIAL_FEN, "e2e4", "e2e4"), false);
  });

  it("uses the pass-2 PV's reply when the PV starts with the played move", () => {
    const replay = replaySan(OPERA_BEFORE_QB8, ["Qb8+", "Nxb8", "Rd8#"]);
    const evals = [280, 290, 300, encodeMate("w", 0)];
    const withPv = classifyGame({ replay, evals, pvs: { 0: ["b3b8", "d7b8", "d1d8"] } });
    assert.equal(withPv[0]?.code, J.BRILLIANT);
    // Without a PV or a stored best reply there is no reply to check: not a sacrifice, so BEST at best.
    const without = classifyGame({ replay, evals });
    assert.notEqual(without[0]?.code, J.BRILLIANT);
  });
});

describe("rule 6: GREAT from the stored second", () => {
  const great = { played: "e2e4", best: "e2e4" };

  it("needs a gap ≥ 10 with an outcome-class change, inside 10 ≤ Wb ≤ 90", () => {
    // Wbest 63.46 (hold) vs Wsecond 28.48 (lose).
    assert.equal(classifyPly(ctx({ ...great, evalBefore: 150, evalAfter: 150, second: -250 })).code, J.GREAT);
    // The only move that keeps the win: Wbest 82.44 (win) vs Wsecond 59.10 (hold).
    assert.equal(classifyPly(ctx({ ...great, evalBefore: 420, evalAfter: 420, second: 100 })).code, J.GREAT);
    // Same class (hold vs hold) although the gap is ≥ 10.
    assert.equal(classifyPly(ctx({ ...great, evalBefore: 150, evalAfter: 150, second: -60 })).code, J.BEST);
    // Wb above 90 (CLEAN 14.Rd1: +680 before, second +150).
    const rd1 = classifyPly(ctx({ ...great, evalBefore: 680, evalAfter: 800, second: CLEAN_RD1_SECOND }));
    assert.ok(rd1.winBefore > GREAT_RULE.MAX_WIN_BEFORE);
    assert.equal(rd1.code, J.BEST);
    // No second move, or not the best move.
    assert.equal(classifyPly(ctx({ ...great, evalBefore: 150, evalAfter: 150 })).code, J.BEST);
    assert.equal(
      classifyPly(ctx({ played: "d2d4", best: "e2e4", evalBefore: 150, evalAfter: 150, second: -250 })).code,
      J.EXCELLENT,
    );
  });
});

describe("rule 6: BEST, EXCELLENT, GOOD", () => {
  it("uses d < 0.5 for BEST when the best move is unknown", () => {
    assert.equal(classifyPly(ctx({ evalBefore: 5, evalAfter: 0 })).code, J.BEST);
    assert.equal(classifyPly(ctx({ evalBefore: 15, evalAfter: 0 })).code, J.EXCELLENT);
    assert.equal(classifyPly(ctx({ evalBefore: 15, evalAfter: 0, best: "d2d4" })).code, J.EXCELLENT);
    assert.equal(classifyPly(ctx({ evalBefore: 35, evalAfter: 0, best: "d2d4" })).code, J.GOOD);
  });
});

describe("rules 1–2: FORCED and BOOK (edge fixtures)", () => {
  for (const name of ["forced-recapture", "book", "terminal", "promotion"]) {
    it(`${name}`, () => {
      const file = loadEdgeFiles().find((f) => f.name === name);
      assert.ok(file);
      assert.equal(file.provenance, "constructed");
      for (const g of file.games) {
        const input = edgeGradeInput(g);
        assert.deepEqual(
          classifyGame(input).map((x) => judgementKey(x.code)),
          g.expected,
          g.id,
        );
        if (g.final === "stalemate") assert.equal(input.replay.final.stalemate, true, g.id);
        if (g.final === "threefold") assert.equal(input.replay.final.threefold, true, g.id);
      }
    });
  }

  it("FORCED: the recapture is the only legal move", () => {
    const g = loadEdgeFiles().find((f) => f.name === "forced-recapture")?.games[0];
    assert.ok(g);
    assert.equal(edgeGradeInput(g).replay.legal[1], 1);
  });

  it("BOOK is never given after a non-book ply, past ply 30, or from a FEN start", () => {
    const file = loadEdgeFiles().find((f) => f.name === "book");
    assert.ok(file);
    for (const g of file.games) {
      const codes = gradeCodes(classifyGame(edgeGradeInput(g)));
      const firstNonBook = codes.findIndex((c) => c !== J.BOOK);
      if (firstNonBook >= 0)
        assert.ok(
          codes.slice(firstNonBook).every((c) => c !== J.BOOK),
          g.id,
        );
      assert.ok(
        codes.slice(30).every((c) => c !== J.BOOK),
        g.id,
      );
    }
    const fen = file.games.find((g) => g.id === "fen-start");
    assert.ok(fen);
    assert.ok(gradeCodes(classifyGame(edgeGradeInput(fen))).every((c) => c !== J.BOOK));
  });
});

describe("design mocks (labels/design-mock.ts)", () => {
  for (const name of ["GAME", "CLEAN"] as const) {
    it(`${name}: every ply gets the expected label (the mock's q with the documented differences)`, () => {
      assert.deepEqual(keys(name), [...EXPECTED[name]]);
    });
  }

  it("reproduces the mock on every member ply except the documented differences", () => {
    for (const name of ["GAME", "CLEAN"] as const) {
      const ours = keys(name);
      MOCKS[name].forEach((p, i) => {
        const diff = DIFFERENCES.find((d) => d.name === name && d.ply === i);
        if (diff) {
          assert.equal(diff.mock, p.q, `${name} ${i}: the difference quotes the mock`);
          assert.equal(diff.san, p.san);
          assert.equal(diff.side, i % 2 === 0 ? "w" : "b");
          assert.notEqual(diff.ours, diff.mock);
          assert.equal(ours[i], diff.ours);
        } else {
          assert.equal(ours[i], p.q, `${name} ply ${i} ${p.san}`);
        }
      });
    }
    const memberDiffs = DIFFERENCES.filter((d) => d.side === USER_SIDE[d.name]).map((d) => `${d.name} ${d.ply}`);
    assert.deepEqual(memberDiffs, ["GAME 44", "CLEAN 12", "CLEAN 16", "CLEAN 20", "CLEAN 26", "CLEAN 28"]);
  });

  it("keeps the plan's fixed points (GAME 32/36/40, CLEAN 30/31)", () => {
    // GAME 32 INACCURACY (d ≈ 9.8), 36 MISS, 40 BLUNDER (d ≈ 23); CLEAN 30 BRILLIANT, 31 FORCED.
    const g = classifyGame(mockGradeInput("GAME"));
    assert.equal(g[32]?.code, J.INACCURACY);
    assert.ok(Math.abs((g[32]?.loss ?? 0) - 9.86) < 0.05);
    assert.equal(g[36]?.code, J.MISS);
    assert.equal(g[40]?.code, J.BLUNDER);
    assert.ok(Math.abs((g[40]?.loss ?? 0) - 23.3) < 0.1);
    const c = classifyGame(mockGradeInput("CLEAN"));
    assert.equal(c[30]?.code, J.BRILLIANT);
    assert.equal(c[31]?.code, J.FORCED);
  });

  it("keeps book transpositions BOOK (GAME plies whose mock best differs from the move played)", () => {
    const g = classifyGame(mockGradeInput("GAME"));
    const transposed = GAME.flatMap((p, i) => (p.q === "book" && p.best !== p.san ? [i] : []));
    assert.ok(transposed.length >= 5);
    for (const i of transposed) assert.equal(g[i]?.code, J.BOOK, `ply ${i}`);
  });

  it("stores CLEAN's mate stand-ins as the real mates of the Opera Game", () => {
    const evals = mockEvals("CLEAN");
    const replay = replaySan(
      INITIAL_FEN,
      CLEAN.map((p) => p.san),
    );
    // After 16.Qb8+ Black has exactly one move (Nxb8) and 17.Rd8# follows: White mates in 1.
    assert.equal(replay.legal[31], 1);
    assert.equal(evals[31], encodeMate("w", 1));
    const afterNxb8 = new Chess(replay.fens[32]);
    afterNxb8.move("Rd8#");
    assert.equal(afterNxb8.isCheckmate(), true);
    assert.equal(evals[32], encodeMate("w", 1));
    assert.equal(replay.final.checkmate, true);
    assert.equal(evals[33], encodeMate("w", 0));
  });

  it("quotes Win% figures in the differences that match the grader", () => {
    const rd1 = classifyGame(mockGradeInput("CLEAN"))[26];
    assert.ok(rd1);
    assert.ok(Math.abs(rd1.winBefore - 92.44) < 0.01);
    assert.ok(Math.abs(winPct(CLEAN_RD1_SECOND) - 63.46) < 0.01);
    assert.ok(Math.abs(plyLoss(-371, -427, "w") - 3.14) < 0.01);
  });
});

describe("classifyGame", () => {
  it("grades only plies whose after-eval is known (streaming during pass 1)", () => {
    const full = mockGradeInput("GAME");
    const partial = classifyGame({ ...full, evals: full.evals.slice(0, 21) });
    assert.equal(partial.length, 20);
    assert.deepEqual(partial, classifyGame(full).slice(0, 20));
  });

  it("is deterministic: the same arrays give the same grades (engine-free regrades)", () => {
    for (const name of ["GAME", "CLEAN"] as const) {
      assert.deepEqual(classifyGame(mockGradeInput(name)), classifyGame(mockGradeInput(name)));
    }
  });

  it("never emits INTERESTING or leaves a ply ungraded (all fixtures)", () => {
    const all = [
      ...classifyGame(mockGradeInput("GAME")),
      ...classifyGame(mockGradeInput("CLEAN")),
      ...loadEdgeFiles().flatMap((f) => f.games.flatMap((g) => classifyGame(edgeGradeInput(g)))),
    ];
    assert.ok(all.length > 150);
    assert.ok(all.every((g) => g.code !== J.INTERESTING && g.code !== J.UNGRADED));
  });

  it("counts judgements per side (13 slots, index = code)", () => {
    const codes = gradeCodes(classifyGame(mockGradeInput("GAME")));
    const counts = countJudgements(codes, "w");
    assert.equal(counts.w.length, 13);
    assert.equal(counts.w[0], 0);
    assert.equal(counts.w.reduce((a, b) => a + b, 0) + counts.b.reduce((a, b) => a + b, 0), 54);
    assert.equal(counts.w[J.MISS], 1);
    assert.equal(counts.w[J.BLUNDER], 1);
    assert.equal(counts.w[J.INACCURACY], 1);
    assert.equal(counts.b[J.BLUNDER], 1);
    assert.equal(counts.w[J.BOOK], 12);
    assert.deepEqual(countJudgements([J.BEST, 0, J.GOOD], "b"), {
      w: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      b: [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    });
  });
});
