// codec.ts (phase-03 plan §8.16, §12.1): the 10,000-sample round trip and mergePlies.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import {
  J,
  JUDGEMENT_CHARS,
  JUDGEMENT_ENUM,
  JUDGEMENT_KEYS,
  MATE_MAX_MOVES,
  MOVE_CODE_MAX,
  NO_SECOND,
  decodeBestTokens,
  decodeEval,
  decodeJudgements,
  decodeMove,
  decodeSecond,
  deltaFit,
  encodeBestTokens,
  encodeCp,
  encodeEval,
  encodeJudgements,
  encodeMate,
  encodeMove,
  evalFor,
  fromEngineScore,
  isMateEval,
  judgementEnum,
  judgementFromKey,
  judgementKey,
  mateMoves,
  mergePlies,
  moveLabel,
  moveNo,
  moverAt,
  squareIndex,
  squareName,
  type PliesDelta,
  type PliesState,
  type ReviewStatus,
} from "./codec";

/** Deterministic PRNG (mulberry32), so the property test is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES = 10_000;

describe("judgement codes", () => {
  it("keeps the append-only code table of §6.1", () => {
    assert.deepEqual(
      [J.UNGRADED, J.BRILLIANT, J.GREAT, J.BEST, J.EXCELLENT, J.GOOD, J.BOOK, J.FORCED, J.INTERESTING],
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.deepEqual([J.INACCURACY, J.MISTAKE, J.MISS, J.BLUNDER], [9, 10, 11, 12]);
    assert.equal(JUDGEMENT_CHARS, ".BGbEgkFNIMSX");
    assert.equal(new Set(JUDGEMENT_CHARS).size, 13);
    assert.equal(JUDGEMENT_KEYS.length, 12);
    assert.equal(JUDGEMENT_ENUM.length, 13);
  });

  it("maps codes, keys, chars and enum names both ways", () => {
    for (let code = 1; code <= 12; code++) {
      const key = judgementKey(code);
      assert.ok(key);
      assert.equal(judgementFromKey(key), code);
      assert.equal(judgementEnum(code), key.toUpperCase());
    }
    assert.equal(judgementKey(0), null);
    assert.equal(judgementEnum(0), null);
    assert.throws(() => judgementKey(13), RangeError);
    assert.throws(() => decodeJudgements("bZ"), RangeError);
  });

  it("round-trips 10,000 random judgement strings", () => {
    const r = rng(7);
    for (let s = 0; s < SAMPLES; s++) {
      const codes = Array.from({ length: Math.floor(r() * 12) }, () => Math.floor(r() * 13));
      const j = encodeJudgements(codes);
      assert.equal(j.length, codes.length);
      assert.deepEqual(decodeJudgements(j), codes);
    }
  });
});

describe("MoveCode", () => {
  it("numbers squares a1 = 0 … h8 = 63", () => {
    assert.equal(squareIndex("a1"), 0);
    assert.equal(squareIndex("h1"), 7);
    assert.equal(squareIndex("e4"), 28);
    assert.equal(squareIndex("h8"), 63);
    for (let i = 0; i < 64; i++) assert.equal(squareIndex(squareName(i)), i);
    assert.throws(() => squareIndex("i9"), RangeError);
  });

  it("encodes from + 64·to + 4096·promo", () => {
    assert.equal(encodeMove("e2e4"), 12 + 64 * 28);
    assert.equal(encodeMove("a7a8q"), 48 + 64 * 56 + 4096 * 4);
    assert.equal(encodeMove("a7a8n"), 48 + 64 * 56 + 4096 * 1);
    assert.equal(encodeMove("h7g8q"), 63 - 8 + 64 * 62 + 4096 * 4);
    assert.ok(MOVE_CODE_MAX <= 32767, "fits smallint");
    assert.equal(decodeMove(0), null);
    assert.throws(() => encodeMove("e2e2"), RangeError);
    assert.throws(() => encodeMove("e2e4k"), RangeError);
    assert.throws(() => decodeMove(64 * 5 + 5), RangeError); // from = to
    assert.throws(() => decodeMove(MOVE_CODE_MAX + 1), RangeError);
  });

  it("round-trips 10,000 legal moves from random positions (random playouts, all promotions)", () => {
    const r = rng(42);
    let samples = 0;
    let promotions = 0;
    let chess = new Chess();
    while (samples < SAMPLES) {
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0 || chess.isDraw() || chess.history().length > 120) {
        chess = new Chess();
        continue;
      }
      const m = moves[Math.floor(r() * moves.length)];
      assert.ok(m);
      const uci = `${m.from}${m.to}${m.promotion ?? ""}`;
      const code = encodeMove(uci);
      assert.ok(code > 0 && code <= MOVE_CODE_MAX);
      assert.equal(decodeMove(code), uci);
      if (m.promotion) promotions++;
      chess.move(m);
      samples++;
    }
    // Under-promotions are rare in random play; cover every promotion piece explicitly.
    for (const p of ["n", "b", "r", "q"]) {
      for (const uci of [`a7a8${p}`, `h2h1${p}`, `b7a8${p}`, `g2h1${p}`])
        assert.equal(decodeMove(encodeMove(uci)), uci);
    }
    assert.ok(promotions > 0, "the playouts reached at least one promotion");
  });

  it("round-trips best-token strings with unknown entries", () => {
    const r = rng(3);
    for (let s = 0; s < 1000; s++) {
      const codes = Array.from({ length: 1 + Math.floor(r() * 20) }, () => {
        if (r() < 0.2) return 0;
        const from = Math.floor(r() * 64);
        const to = (from + 1 + Math.floor(r() * 63)) % 64;
        return from + 64 * to + 4096 * Math.floor(r() * 5);
      });
      const tokens = encodeBestTokens(codes);
      assert.deepEqual(
        decodeBestTokens(tokens),
        codes.map((c) => decodeMove(c)),
      );
    }
    assert.deepEqual(decodeBestTokens(""), []);
    assert.equal(encodeBestTokens([encodeMove("e2e4"), 0]), "e2e4 -");
  });
});

describe("evals", () => {
  it("round-trips 10,000 random centipawn and mate scores, and the second sentinel", () => {
    const r = rng(11);
    for (let s = 0; s < SAMPLES; s++) {
      if (r() < 0.5) {
        const cp = Math.round((r() * 2 - 1) * 20000);
        const e = encodeCp(cp);
        assert.equal(e, Math.max(-9999, Math.min(9999, cp)));
        assert.deepEqual(decodeEval(e), { kind: "cp", cp: e });
        assert.equal(encodeEval(decodeEval(e)), e);
        assert.equal(isMateEval(e), false);
      } else {
        const winner = r() < 0.5 ? "w" : "b";
        const moves = Math.floor(r() * (MATE_MAX_MOVES + 1));
        const e = encodeMate(winner, moves);
        assert.equal(e, (winner === "w" ? 1 : -1) * (30000 - moves));
        assert.deepEqual(decodeEval(e), { kind: "mate", winner, moves });
        assert.equal(encodeEval(decodeEval(e)), e);
        assert.equal(isMateEval(e), true);
        assert.equal(mateMoves(e), moves);
      }
    }
    assert.equal(decodeSecond(NO_SECOND), null);
    assert.deepEqual(decodeSecond(-35), { kind: "cp", cp: -35 });
    assert.equal(isMateEval(NO_SECOND), false);
    assert.throws(() => decodeEval(NO_SECOND), RangeError);
    assert.throws(() => decodeEval(15000), RangeError);
  });

  it("stores n = 0 as the side to move being checkmated", () => {
    assert.equal(encodeMate("w", 0), 30000);
    assert.equal(encodeMate("b", 0), -30000);
    assert.throws(() => encodeMate("w", MATE_MAX_MOVES + 1), RangeError);
  });

  it("converts engine scores (side-to-move POV) to White POV", () => {
    assert.equal(fromEngineScore({ cp: -35 }, "w"), -35);
    assert.equal(fromEngineScore({ cp: -35 }, "b"), 35);
    assert.equal(fromEngineScore({ cp: 12345 }, "w"), 9999);
    assert.equal(fromEngineScore({ mate: 3 }, "w"), 29997); // White to move mates in 3
    assert.equal(fromEngineScore({ mate: 3 }, "b"), -29997); // Black to move mates in 3
    assert.equal(fromEngineScore({ mate: -2 }, "w"), -29998); // White is mated in 2
    assert.equal(fromEngineScore({ mate: -1 }, "b"), 29999); // Black is mated in 1
    assert.equal(fromEngineScore({ mate: 0 }, "b"), 30000); // Black is checkmated
  });

  it("re-signs evals for a side without changing mate distance", () => {
    assert.equal(evalFor(120, "b"), -120);
    assert.equal(evalFor(-29997, "b"), 29997);
    assert.equal(Object.is(evalFor(0, "b"), 0), true);
  });
});

describe("ply numbering", () => {
  it("follows moveNo(i) = floor((startPly + i) / 2) + 1", () => {
    assert.equal(moveNo(0, 0), 1);
    assert.equal(moveNo(1, 0), 1);
    assert.equal(moveNo(32, 0), 17);
    assert.equal(moveLabel(32, 0), "17.");
    assert.equal(moveLabel(33, 0), "17…");
    // A FEN start with Black to move at move 10: startPly 19.
    assert.equal(moveLabel(0, 19), "10…");
    assert.equal(moveLabel(1, 19), "11.");
    assert.equal(moverAt(0, "b"), "b");
    assert.equal(moverAt(1, "b"), "w");
  });
});

describe("mergePlies", () => {
  type Doc = { status: ReviewStatus; analysis: PliesState | null; ref: string };
  const doc = (over: Partial<PliesState> = {}, status: ReviewStatus = "running"): Doc => ({
    ref: "g1",
    status,
    analysis: { gradedPlies: 2, totalPlies: 6, evals: [15, 30, 25], best: "e2e4 e7e5", j: "kk", ...over },
  });
  const delta = (over: Partial<PliesDelta> = {}): PliesDelta => ({
    from: 2,
    gradedPlies: 4,
    totalPlies: 6,
    evals: [25, 40, -10],
    best: "g1f3 b8c6",
    j: "bX",
    ...over,
  });

  it("splices evals, best tokens and j chars from `from`", () => {
    const next = mergePlies(doc(), delta());
    assert.deepEqual(next.analysis, {
      gradedPlies: 4,
      totalPlies: 6,
      evals: [15, 30, 25, 40, -10],
      best: "e2e4 e7e5 g1f3 b8c6",
      j: "kkbX",
    });
    assert.equal(next.ref, "g1");
    assert.equal(next.status, "running");
  });

  it("overwrites an overlap from the last checkpoint and keeps padded tails", () => {
    const padded = doc({ best: "e2e4 e7e5 - - - -", j: "kk...." });
    const next = mergePlies(padded, delta({ from: 1, evals: [30, 26, 40, -10], best: "e7e5 g1f3 b8c6", j: "kbX" }));
    assert.deepEqual(next.analysis?.evals, [15, 30, 26, 40, -10]);
    assert.equal(next.analysis?.best, "e2e4 e7e5 g1f3 b8c6 - -");
    assert.equal(next.analysis?.j, "kkbX..");
  });

  it("ignores stale deltas and returns the same object", () => {
    const d = doc();
    assert.equal(deltaFit(d, delta({ gradedPlies: 2 })), "stale");
    assert.equal(mergePlies(d, delta({ gradedPlies: 2 })), d);
    assert.equal(mergePlies(d, delta({ gradedPlies: 1 })), d);
  });

  it("reports a gap instead of misaligning plies", () => {
    const d = doc();
    assert.equal(deltaFit(d, delta({ from: 3 })), "gap");
    assert.equal(mergePlies(d, delta({ from: 3 })), d);
    assert.equal(deltaFit(d, delta({ from: -1 })), "gap");
  });

  it("never touches a done, skipped or analysis-less payload", () => {
    for (const status of ["done", "skipped"] as const) {
      const d = doc({}, status);
      assert.equal(deltaFit(d, delta()), "closed");
      assert.equal(mergePlies(d, delta()), d);
    }
    const empty: Doc = { ref: "g1", status: "queued", analysis: null };
    assert.equal(deltaFit(empty, delta({ from: 0 })), "closed");
    assert.equal(mergePlies(empty, delta({ from: 0 })), empty);
  });

  it("moves queued and failed payloads to running and clears failure and queue", () => {
    const queued = { ...doc({ queue: { position: 2, etaSec: 30 } }, "queued") };
    const q = mergePlies(queued, delta());
    assert.equal(q.status, "running");
    assert.equal(q.analysis?.queue, null);
    const failed = doc(
      { failure: { failedAtPly: 2, retryable: true, retryAt: null, code: "engine_failed" } },
      "failed",
    );
    const f = mergePlies(failed, delta());
    assert.equal(f.status, "running");
    assert.equal(f.analysis?.failure, null);
  });
});
