// items.ts: the item-key codec (phase-05 plan §12.1; interface check §0.14): sqids round trip over the whole signed
// 64-bit range, pinned vectors (a stored key must never change), the wire format, and foreign prefixes rejected.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  decodeMistakeItemKey,
  decodeOpeningItemKey,
  decodePuzzleItemKey,
  isItemKey,
  mistakeItemKey,
  openingItemKey,
  parseItemKey,
  puzzleItemKey,
} from "./items";
import { mulberry32 } from "./session";

const WIRE = /^[mpo]_[A-Za-z0-9]{1,24}$/;
const MISTAKE = /^m_[A-Za-z0-9]{1,24}$/;

function randomInt64(rnd: () => number): bigint {
  const hi = BigInt(Math.floor(rnd() * 2 ** 32));
  const lo = BigInt(Math.floor(rnd() * 2 ** 32));
  return BigInt.asIntN(64, (hi << 32n) | lo);
}

describe("mistake keys", () => {
  it("keeps the pinned encodings (stored keys must never change)", () => {
    assert.equal(mistakeItemKey(0n), "m_SvIz");
    assert.equal(mistakeItemKey(-1n), "m_NhhGwClzuuo1zf");
    assert.equal(mistakeItemKey(123456789012345678n), "m_jFUyEIwesPK27");
    assert.equal(mistakeItemKey(-(1n << 63n)), "m_tSQxv9ayw");
    assert.equal(mistakeItemKey((1n << 63n) - 1n), "m_jF4pUnhw33qEi5");
  });

  it("round-trips 10,000 random signed 64-bit hashes and fits the wire format", () => {
    const rnd = mulberry32(0x17e4);
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const h = randomInt64(rnd);
      const key = mistakeItemKey(h);
      assert.match(key, MISTAKE);
      assert.match(key, WIRE);
      assert.ok(key.length <= 16, key);
      assert.equal(decodeMistakeItemKey(key), h);
      assert.ok(!seen.has(key));
      seen.add(key);
    }
  });

  it("refuses values outside int64", () => {
    assert.throws(() => mistakeItemKey(1n << 63n));
    assert.throws(() => mistakeItemKey(-(1n << 63n) - 1n));
  });

  it("rejects foreign prefixes and non-canonical bodies", () => {
    const key = mistakeItemKey(42n);
    assert.equal(decodeMistakeItemKey(key.replace("m_", "p_")), null);
    assert.equal(decodeMistakeItemKey(key.replace("m_", "o_")), null);
    assert.equal(decodeMistakeItemKey(key.replace("m_", "x_")), null);
    assert.equal(decodeMistakeItemKey(key.slice(2)), null);
    assert.equal(decodeMistakeItemKey("m_"), null);
    assert.equal(decodeMistakeItemKey("m_abc"), null, "a one-number sqid is not a mistake key");
    assert.equal(decodeMistakeItemKey("m_!!"), null);
    assert.equal(decodeMistakeItemKey(`${key}a`), null);
    assert.equal(decodeMistakeItemKey(openingItemKey(7)), null);
  });
});

describe("puzzle and opening keys", () => {
  it("wraps Lichess ids", () => {
    assert.equal(puzzleItemKey("00Aas"), "p_00Aas");
    assert.equal(decodePuzzleItemKey("p_00Aas"), "00Aas");
    assert.equal(decodePuzzleItemKey("m_00Aas"), null);
    assert.equal(decodePuzzleItemKey("p_ab"), null);
    assert.throws(() => puzzleItemKey("bad id"));
  });

  it("round-trips opening ids", () => {
    for (const id of [0, 1, 99, 4_000_000, Number.MAX_SAFE_INTEGER]) {
      const key = openingItemKey(id);
      assert.match(key, WIRE);
      assert.equal(decodeOpeningItemKey(key), id);
    }
    assert.equal(openingItemKey(12n), openingItemKey(12));
    assert.equal(decodeOpeningItemKey(mistakeItemKey(5n).replace("m_", "o_")), null);
    assert.throws(() => openingItemKey(-1));
  });

  it("parses any key by its prefix", () => {
    assert.deepEqual(parseItemKey(mistakeItemKey(-5n)), { kind: "mistake", epdHash: -5n });
    assert.deepEqual(parseItemKey("p_00Aas"), { kind: "puzzle", puzzleId: "00Aas" });
    assert.deepEqual(parseItemKey(openingItemKey(3)), { kind: "opening", openingId: 3 });
    assert.equal(parseItemKey("z_abc"), null);
    assert.equal(isItemKey("p_00Aas"), true);
    assert.equal(isItemKey("garbage"), false);
  });
});
