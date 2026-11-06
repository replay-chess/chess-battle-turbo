import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGameMeta, emptyGameMeta, parseGameMeta } from "./game-meta";

describe("GameMetaV1", () => {
  it("fills the defaults", () => {
    const meta = buildGameMeta({ v: 1, header: "C41 · Philidor", prefixSan: ["e4", "e5"], prefixStartMoveNo: 1, position: null });
    assert.deepEqual(meta.assists, { hints: 0, undos: 0 });
    assert.deepEqual(meta.drawOffers, { w: 0, b: 0 });
    assert.deepEqual(meta.premoves, { w: 0, b: 0 });
    assert.equal(meta.rev, 0);
    assert.equal(meta.abortedBy, null);
    assert.deepEqual(emptyGameMeta().prefixSan, []);
  });

  it("rejects an over-long header or prefix on write", () => {
    assert.throws(() => buildGameMeta({ v: 1, header: "x".repeat(81), prefixSan: [], prefixStartMoveNo: 1, position: null }));
    assert.throws(() =>
      buildGameMeta({ v: 1, header: "", prefixSan: Array.from({ length: 121 }, () => "e4"), prefixStartMoveNo: 1, position: null }),
    );
  });

  it("parseGameMeta is tolerant: legacy and malformed values read as null", () => {
    assert.equal(parseGameMeta(null), null);
    assert.equal(parseGameMeta({ gameMode: "friend" }), null);
    assert.equal(parseGameMeta("x"), null);
    const ok = parseGameMeta({
      v: 1,
      header: "",
      prefixSan: [],
      prefixStartMoveNo: 1,
      position: { name: "Opera Game", event: "Paris", year: 1858, afterLabel: "after 9...b5", legendSide: "w" },
      abortedBy: "stale",
    });
    assert.equal(ok?.position?.year, 1858);
    assert.equal(ok?.abortedBy, "stale");
  });
});
