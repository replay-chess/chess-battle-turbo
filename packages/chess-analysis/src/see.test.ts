// see.ts, board.ts and replay.ts: the board facts the classifier reads.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { INITIAL_FEN, epdOf, isInitialPosition, material, materialBalance, placement, sideToMove } from "./board";
import { normalizeUci, replaySan, replayUci, sanOf, uciOf } from "./replay";
import { see } from "./see";

describe("see", () => {
  it("wins a hanging piece outright", () => {
    // White queen d1 can take the undefended knight on d5.
    assert.equal(see("4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1", "d5"), 3);
  });

  it("does not capture a defended piece with a more valuable one", () => {
    // Qxd5 exd5 would lose the queen for a knight: SEE declines, 0.
    assert.equal(see("4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1", "d5"), 0);
  });

  it("runs the exchange with the least valuable attacker first", () => {
    // Pawn e4 takes the knight on d5 (+3); the pawn on e6 retakes (−1); the queen retakes (+1); nothing more.
    assert.equal(see("4k3/8/4p3/3n4/4P3/8/8/3QK3 w - - 0 1", "d5"), 3);
  });

  it("counts x-rays: a rook behind a rook joins the exchange", () => {
    // Rd2xd5 (+3), Rd8xd5 (−5), then the rook on d1, uncovered, retakes (+5): 3 − 5 + 5 = 3.
    const fen = "3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1";
    assert.equal(see(fen, "d5"), 3);
    // Without the rook behind, Rd2xd5 loses the rook for a knight: decline, 0.
    assert.equal(see("3rk3/8/8/3n4/8/8/3R4/4K3 w - - 0 1", "d5"), 0);
  });

  it("respects pins (a pinned defender cannot recapture)", () => {
    // The e6 pawn defends d5 but is pinned to the king on e8 by the rook on e1.
    assert.equal(see("4k3/8/4p3/3n4/8/8/8/3QR1K1 w - - 0 1", "d5"), 3);
  });

  it("is 0 when the side to move cannot capture there", () => {
    assert.equal(see(INITIAL_FEN, "e5"), 0);
  });
});

describe("board facts", () => {
  it("parses placement with a1 = 0", () => {
    const b = placement(INITIAL_FEN);
    assert.deepEqual(b[0], { type: "r", color: "w" });
    assert.deepEqual(b[4], { type: "k", color: "w" });
    assert.deepEqual(b[60], { type: "k", color: "b" });
    assert.equal(b[28], null);
    assert.throws(() => placement("8/8/8 w - - 0 1"), RangeError);
  });

  it("counts material 1/3/3/5/9 and the balance per side", () => {
    assert.deepEqual(material(INITIAL_FEN), { w: 39, b: 39 });
    const fen = "4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1";
    assert.equal(materialBalance(fen, "w"), 6);
    assert.equal(materialBalance(fen, "b"), -6);
  });

  it("keys positions by EPD and recognises the initial position", () => {
    assert.equal(epdOf(INITIAL_FEN), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
    assert.equal(isInitialPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 3 9"), true);
    assert.equal(isInitialPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"), false);
    assert.equal(sideToMove("8/8/8/8/8/8/8/K6k b - - 0 1"), "b");
  });
});

describe("replay", () => {
  it("keeps positions, EPDs, legal counts, SAN and UCI aligned (position i = before ply i)", () => {
    const r = replaySan(INITIAL_FEN, ["e4", "e5", "Nf3"]);
    assert.equal(r.fens.length, 4);
    assert.equal(r.epds.length, 4);
    assert.deepEqual(r.legal.slice(0, 2), [20, 20]);
    assert.deepEqual(r.uci, ["e2e4", "e7e5", "g1f3"]);
    assert.deepEqual(r.san, ["e4", "e5", "Nf3"]);
    assert.equal(r.startMover, "w");
    assert.deepEqual(replayUci(INITIAL_FEN, r.uci).fens, r.fens);
  });

  it("detects the final status", () => {
    const mate = replaySan(INITIAL_FEN, ["f3", "e5", "g4", "Qh4#"]);
    assert.equal(mate.final.checkmate, true);
    assert.equal(mate.legal[4], 0);
  });

  it("normalises king-takes-rook castling to the two-square king move", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    assert.equal(normalizeUci(fen, "e1h1"), "e1g1");
    assert.equal(normalizeUci(fen, "e1a1"), "e1c1");
    assert.equal(normalizeUci(fen.replace(" w ", " b "), "e8h8"), "e8g8");
    assert.equal(normalizeUci(fen, "e1f1"), "e1f1");
    assert.equal(sanOf(fen, "e1g1"), "O-O");
    assert.equal(uciOf(fen, "O-O-O"), "e1c1");
  });

  it("rejects illegal moves with a RangeError", () => {
    assert.throws(() => replayUci(INITIAL_FEN, ["e2e5"]), RangeError);
    assert.throws(() => replaySan(INITIAL_FEN, ["Ke2"]), RangeError);
    assert.throws(() => uciOf(INITIAL_FEN, "Nf6"), RangeError);
  });
});
