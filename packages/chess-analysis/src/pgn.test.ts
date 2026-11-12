// The annotated PGN (phase-03 plan §8.15; §12.1 `CA/src/pgn.test.ts`): it re-parses with chess.js `loadPgn`, the
// NAG mapping, `[%eval #3]`, `[%clk]`, and the FEN-start headers.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { mockGradeInput } from "../fixtures/labels/design-mock";
import { classifyGame, gradeCodes } from "./classify";
import { encodeCp, encodeJudgements, encodeMate, J, judgementChar } from "./codec";
import { buildAnnotatedPgn, clockTag, evalTag, NAG, PGN_ANNOTATOR, tagValue, type AnnotatedPgnInput } from "./pgn";

function gameInput(): AnnotatedPgnInput {
  const g = mockGradeInput("GAME");
  const codes = gradeCodes(classifyGame(g));
  return {
    game: {
      startFen: g.replay.startFen,
      startPly: 0,
      result: "0-1",
      playedAt: "2026-11-09T18:42:00.000Z",
      tc: { initialSec: 600, incSec: 0 },
      opening: { eco: "C59", name: "Two Knights Defense" },
    },
    players: { w: { name: "knightowl_88" }, b: { name: "tal_fan_77" } },
    moves: g.replay.uci.join(" "),
    clocks: g.replay.uci.map((_, i) => 600_000 - i * 4_000),
    analysis: { evals: g.evals, j: encodeJudgements(codes) },
    review: {
      moments: [{ ply: 36, why: [{ t: "Rxf5 wins the bishop on f5." }, { t: "A {braced} note." }] }],
    },
  };
}

function reparse(pgn: string): Chess {
  const c = new Chess();
  c.loadPgn(pgn);
  return c;
}

describe("buildAnnotatedPgn", () => {
  it("re-parses with chess.js and replays the same moves", () => {
    const input = gameInput();
    const pgn = buildAnnotatedPgn(input);
    const c = reparse(pgn);
    const uci = c.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ""}`);
    assert.equal(uci.join(" "), input.moves);
    assert.equal(c.getHeaders().Result, "0-1");
  });

  it("writes the headers", () => {
    const pgn = buildAnnotatedPgn(gameInput(), { site: "https://replay-chess-dev.example" });
    for (const h of [
      '[Event "Replay Chess game"]',
      '[Site "https://replay-chess-dev.example"]',
      '[Date "2026.11.09"]',
      '[White "knightowl_88"]',
      '[Black "tal_fan_77"]',
      '[Result "0-1"]',
      '[TimeControl "600+0"]',
      '[ECO "C59"]',
      '[Opening "Two Knights Defense"]',
      `[Annotator "${PGN_ANNOTATOR}"]`,
    ]) {
      assert.ok(pgn.includes(h), h);
    }
    assert.equal(PGN_ANNOTATOR, "Replay Chess · Stockfish 18 (sf18-v1)");
    assert.ok(!pgn.includes("[FEN "));
  });

  it("maps judgements to NAGs (a miss is $2 with the comment Miss)", () => {
    assert.deepEqual(NAG, { 1: 3, 2: 1, 8: 5, 9: 6, 10: 2, 11: 2, 12: 4 });
    const pgn = buildAnnotatedPgn(gameInput());
    assert.match(pgn, /17\. b3 \$6\s\{\[%eval -1\.37\] \[%clk 0:07:52\]\}/);
    assert.match(
      pgn,
      /19\. Qd2 \$2\s\{\[%eval -0\.62\] \[%clk 0:07:36\] Miss\. Rxf5 wins the bishop on f5\. A braced note\.\}/,
    );
    assert.match(pgn, /21\. Bxc6 \$4\s/);
    assert.match(pgn, /18\.\.\. Bg3 \$4\s/);
    assert.match(pgn, /\s1\. e4\s\{\[%eval 0\.36\] \[%clk 0:10:00\]\}\s1\.\.\. e5\s/);
    const c = reparse(pgn);
    const comments = c.getComments();
    assert.ok(comments.some((x) => x.comment.includes("Miss.")));
  });

  it("writes mates as #n / #-n and leaves the final checkmate without an eval", () => {
    assert.equal(evalTag(encodeMate("w", 3)), "[%eval #3]");
    assert.equal(evalTag(encodeMate("b", 2)), "[%eval #-2]");
    assert.equal(evalTag(encodeMate("w", 0)), null);
    assert.equal(evalTag(encodeCp(36)), "[%eval 0.36]");
    assert.equal(evalTag(encodeCp(-5)), "[%eval -0.05]");
    const clean = mockGradeInput("CLEAN");
    const codes = gradeCodes(classifyGame(clean));
    const pgn = buildAnnotatedPgn({
      game: {
        startFen: clean.replay.startFen,
        startPly: 0,
        result: "1-0",
        playedAt: "2026-11-08T16:20:00.000Z",
        tc: { initialSec: 0, incSec: 0 },
        opening: null,
      },
      players: { w: { name: "knightowl_88" }, b: { name: "Engine 1200" } },
      moves: clean.replay.uci.join(" "),
      clocks: [],
      analysis: { evals: clean.evals, j: encodeJudgements(codes) },
      review: null,
    });
    assert.match(pgn, /16\. Qb8\+ \$3\s\{\[%eval #1\]\}\s16\.\.\. Nxb8\s\{\[%eval #1\]\}\s17\. Rd8#\s1-0\n$/);
    assert.ok(pgn.includes('[TimeControl "-"]'));
    assert.ok(!pgn.includes("%clk"));
    reparse(pgn);
  });

  it("formats clocks as h:mm:ss", () => {
    assert.equal(clockTag(252_000), "[%clk 0:04:12]");
    assert.equal(clockTag(3_725_999), "[%clk 1:02:05]");
    assert.equal(clockTag(-5), "[%clk 0:00:00]");
  });

  it("FEN starts: SetUp and FEN headers, Black's first move numbered 10...", () => {
    const fen = "b2r3r/k4p1p/p2q1np1/NppP4/3R1Q2/P4PPB/1PP4P/1K2R3 b - - 0 24";
    const pgn = buildAnnotatedPgn({
      game: {
        startFen: fen,
        startPly: 47,
        result: "*",
        playedAt: "2026-11-10T10:00:00.000Z",
        tc: { initialSec: 300, incSec: 3 },
        opening: null,
      },
      players: { w: { name: "Engine 1400" }, b: { name: "knightowl_88" } },
      moves: "c5d4 e1e7 a7b6",
      clocks: [298_000, 297_000, 290_000],
      analysis: { evals: [400, 420, 410, 430], j: [J.BEST, J.BEST, J.INACCURACY].map(judgementChar).join("") },
      review: null,
    });
    assert.ok(pgn.includes('[SetUp "1"]'));
    assert.ok(pgn.includes(`[FEN "${fen}"]`));
    assert.ok(pgn.includes('[TimeControl "300+3"]'));
    assert.match(pgn, /\n24\.\.\. cxd4\s\{\[%eval 4\.20\] \[%clk 0:04:58\]\}\s25\. Re7\+\s/);
    assert.match(pgn, /25\.\.\. Kb6 \$6\s/);
    const c = new Chess();
    c.loadPgn(pgn);
    assert.equal(c.history().join(" "), "cxd4 Re7+ Kb6");
  });

  it("leaves ungraded plies without NAG or eval (a review still running)", () => {
    const input = gameInput();
    const partial = {
      ...input,
      analysis: { evals: input.analysis!.evals.slice(0, 11), j: input.analysis!.j.slice(0, 10) },
    };
    const pgn = buildAnnotatedPgn(partial);
    assert.match(pgn, /5\.\.\. Na5\s\{\[%eval -0\.08\] \[%clk 0:09:24\]\}\s6\. Bb5\+\s\{\[%clk 0:09:20\]\}/);
    assert.ok(!/Bb5\+ \$/.test(pgn));
    reparse(pgn);
  });

  // regression: pgn-quote-in-tag (FIX-1). A display name or opening with a double quote was written as \" (PGN's
  // escape), which chess.js loadPgn rejects, so the annotated PGN no longer re-parsed (plan §12.1).
  it("re-parses when a name or the opening contains quotes, backslashes or control characters", () => {
    const input = gameInput();
    input.players.w.name = 'knight "owl" 88';
    input.players.b.name = "tal\\fan\tx";
    input.game.opening = { eco: "C60", name: 'Ruy "Lopez"' };
    const pgn = buildAnnotatedPgn(input);
    const c = reparse(pgn);
    assert.equal(c.getHeaders().White, "knight 'owl' 88");
    assert.equal(c.getHeaders().Black, "tal/fan x");
    assert.equal(c.getHeaders().Opening, "Ruy 'Lopez'");
    assert.equal(c.history().length, input.moves.split(" ").length);
    assert.equal(tagValue('a"b\\c\nd'), "a'b/c d");
  });
});
