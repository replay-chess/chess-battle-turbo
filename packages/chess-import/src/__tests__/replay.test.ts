// PGN movetext and SAN replay helpers shared by both mappers.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { boardDraw, clkToMs, lastClocks, parsePgn, positionKey, replaySan } from "../replay";

describe("clkToMs", () => {
  it("reads h:mm:ss with and without tenths", () => {
    assert.equal(clkToMs("[%clk 0:09:59.9]"), 599_900);
    assert.equal(clkToMs("[%clk 1:15:50.2]"), 4_550_200);
    assert.equal(clkToMs("[%clk 0:00:03]"), 3_000);
    assert.equal(clkToMs("[%clk 0:00:00.05]"), 50);
    assert.equal(clkToMs("[%eval 0.3]"), null);
  });
});

describe("parsePgn", () => {
  it("reads headers, SAN and clocks; ignores move numbers, NAGs, ; comments and the result", () => {
    const pgn = '[Event "x"]\n[ECO "C50"]\n[White "A \\"q\\" B"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 $1 {[%clk 0:02:59.5]}\n2.Nf3 ; a comment\n2...Nc6!? 3. Bc4 1-0\n';
    const r = parsePgn(pgn);
    assert.ok(r.ok);
    assert.equal(r.value.headers.ECO, "C50");
    assert.equal(r.value.headers.White, 'A "q" B');
    assert.deepEqual(r.value.sans, ["e4", "e5", "Nf3", "Nc6!?", "Bc4"]);
    assert.deepEqual(r.value.clocks, [180_000, 179_500, null, null, null]);
  });

  it("accepts 0-0 castling spellings and refuses variations and junk", () => {
    const r = parsePgn("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 *");
    assert.ok(r.ok && r.value.sans.at(-1) === "O-O");
    assert.equal(parsePgn("1. e4 (1. d4) e5 *").ok, false);
    assert.equal(parsePgn("1. e4 hello *").ok, false);
  });
});

describe("replaySan", () => {
  it("returns UCI, plies, startPly and flags; fails on an illegal move", () => {
    const r = replaySan("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ["e4", "Nf6", "e5", "d5", "exd6"]);
    assert.ok(r.ok);
    assert.deepEqual(r.game.uci, ["e2e4", "g8f6", "e4e5", "d7d5", "e5d6"]);
    assert.equal(r.game.flags.enPassant, 1);
    assert.equal(r.game.startPly, 0);
    const bad = replaySan("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ["e4", "e4"]);
    assert.equal(bad.ok, false);
    assert.equal(replaySan("not a fen", []).ok, false);
  });
});

describe("positionKey / boardDraw / lastClocks", () => {
  it("compares placement, side and castling only", () => {
    assert.equal(positionKey("8/8/8/8/8/8/8/K6k w - e3 0 50"), "8/8/8/8/8/8/8/K6k w -");
  });

  it("names the draw the final board proves", () => {
    assert.equal(boardDraw(new Chess("6k1/8/5K2/8/8/8/5Q2/8 w - - 0 57")), null);
    const st = new Chess("6k1/8/5K2/8/8/8/5Q2/8 w - - 0 57");
    for (const m of ["Kg6", "Kh8", "Qf7"]) st.move(m);
    assert.equal(boardDraw(st), "STALEMATE");
    assert.equal(boardDraw(new Chess("8/8/4k3/8/8/2K5/8/8 w - - 0 70")), "INSUFFICIENT_MATERIAL");
    const ff = new Chess("8/8/4k3/8/8/4K3/8/R6r w - - 98 120");
    ff.move("Ra7");
    ff.move("Rh2");
    assert.equal(boardDraw(ff), "FIFTY_MOVE");
  });

  it("finds each side's last clock", () => {
    assert.deepEqual(lastClocks(0, [10, 20, 30]), { w: 30, b: 20 });
    assert.deepEqual(lastClocks(1, [10, 20, 30]), { w: 20, b: 30 });
    assert.deepEqual(lastClocks(0, []), { w: null, b: null });
  });
});
