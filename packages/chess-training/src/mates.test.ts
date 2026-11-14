// Alternative checkmates (FIX-1 alt-mate; plan §8.1 step 2): any mating move solves a position whose stored move mates.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { givesMate, isAlternativeMate, matingMoves } from "./mates";

describe("alternative mates", () => {
  it("lists every mate-in-1 of a position (four back-rank mates)", () => {
    assert.deepEqual(matingMoves("6k1/5ppp/8/8/8/8/5PPP/RRRQ2K1 w - - 0 1").sort(), ["a1a8", "b1b8", "c1c8", "d1d8"]);
  });

  it("accepts the other rook's mate where the stored move mates", () => {
    // The reviewer's position after the setup h8g8: Ra8# is stored, Rb8# is as good.
    const fen = "6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1";
    assert.equal(givesMate(fen, "a1a8"), true);
    assert.equal(isAlternativeMate(fen, "a1a8", "b1b8"), true);
    assert.equal(isAlternativeMate(fen, "a1a8", "a1a8"), false, "the stored move itself is not an alternative");
    assert.equal(isAlternativeMate(fen, "a1a8", "a1a7"), false, "a non-mating move is not");
    assert.equal(isAlternativeMate(fen, "a1a2", "b1b8"), false, "no alternative where the stored move does not mate");
  });

  it("is false for illegal or unreadable input", () => {
    assert.equal(givesMate("not a fen", "a1a8"), false);
    assert.equal(givesMate("6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1", "e2e4"), false);
    assert.deepEqual(matingMoves("garbage"), []);
  });

  it("keeps a promotion's piece in the UCI", () => {
    // White promotes on a8 with mate (queen or rook).
    const fen = "k7/2P5/1K6/8/8/8/8/8 w - - 0 1";
    assert.deepEqual(matingMoves(fen).sort(), ["c7c8q", "c7c8r"]);
    assert.equal(givesMate(fen, "c7c8"), false, "a promotion without its piece is not a move");
  });
});
