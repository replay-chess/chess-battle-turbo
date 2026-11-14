// epd.ts (phase-05 plan §12.1 "epd.test.ts"): the EPD drops the move counters, transposed move orders hash equal,
// the hash is a signed int64, and FNV-1a 64 matches its published test vectors.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { epd, epdHash, fnv1a64 } from "./epd";

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

function fenAfter(moves: string[]): string {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen();
}

describe("epd", () => {
  it("keeps the four position fields and drops the move counters", () => {
    assert.equal(
      epd("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"),
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
    );
    assert.equal(epd("8/8/8/8/8/8/8/K6k w - - 57 120"), "8/8/8/8/8/8/8/K6k w - -");
  });

  it("refuses a FEN with fewer than four fields", () => {
    assert.throws(() => epd("8/8/8/8/8/8/8/K6k w"), RangeError);
  });
});

describe("fnv1a64", () => {
  it("matches the published 64-bit FNV-1a vectors", () => {
    assert.equal(fnv1a64(""), 0xcbf29ce484222325n);
    assert.equal(fnv1a64("a"), 0xaf63dc4c8601ec8cn);
    assert.equal(fnv1a64("foobar"), 0x85944171f73967e8n);
  });
});

describe("epdHash", () => {
  it("hashes transposed move orders equal (the counters differ, the position does not)", () => {
    const a = fenAfter(["Nf3", "Nf6", "g3", "g6"]);
    const b = fenAfter(["g3", "g6", "Nf3", "Nf6"]);
    assert.equal(epdHash(a), epdHash(b));
    // A position reached again later (knights out and back) has new counters and the same hash.
    const c = fenAfter(["Nf3", "Nf6", "Ng1", "Ng8"]);
    assert.notEqual(c, fenAfter([]));
    assert.equal(epdHash(c), epdHash(fenAfter([])));
  });

  it("separates side to move, castling rights and the en passant square", () => {
    const base = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const hashes = new Set([
      epdHash(base),
      epdHash("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1"),
      epdHash("r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1"),
      epdHash("r3k2r/8/8/8/8/8/8/R3K2R w KQkq e3 0 1"),
    ]);
    assert.equal(hashes.size, 4);
  });

  it("is a signed int64 (Postgres bigint), negative for about half of the positions", () => {
    let negative = 0;
    const c = new Chess();
    for (let i = 0; i < 40; i++) {
      const moves = c.moves();
      if (moves.length === 0) break;
      c.move(moves[(i * 7) % moves.length]!);
      const h = epdHash(c.fen());
      assert.ok(h >= INT64_MIN && h <= INT64_MAX, `${h} is in the int64 range`);
      if (h < 0n) negative++;
    }
    assert.ok(negative > 0 && negative < 40, `${negative} of 40 hashes are negative`);
  });

  it("equals the unsigned FNV-1a of the EPD read as two's complement", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const u = fnv1a64(epd(fen));
    assert.equal(epdHash(fen), u >= 1n << 63n ? u - (1n << 64n) : u);
  });
});
