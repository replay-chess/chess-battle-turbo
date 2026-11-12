import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPaged, paged, pagedEnvelope, shouldCountTotal } from "./paged";

describe("paged", () => {
  it("builds the envelope parts", () => {
    assert.deepEqual(pagedEnvelope(paged([1], "c2", 9)), { data: [1], meta: { nextCursor: "c2", total: 9 } });
    assert.deepEqual(pagedEnvelope(paged([], null)), { data: [], meta: { nextCursor: null } });
  });
  it("adds contract-specific meta after nextCursor, never replacing nextCursor or total (P3 G1)", () => {
    const page = paged([1], null, undefined, { filteredTotal: 7, counts: { all: 12 } });
    assert.deepEqual(pagedEnvelope(page), { data: [1], meta: { nextCursor: null, filteredTotal: 7, counts: { all: 12 } } });
    const sneaky = paged([], "c2", 3, { nextCursor: "x", total: 99, skipped: undefined });
    assert.deepEqual(pagedEnvelope(sneaky).meta, { nextCursor: "c2", total: 3 });
  });
  it("is recognised only through the marker", () => {
    assert.equal(isPaged(paged([], null)), true);
    assert.equal(isPaged({ items: [], nextCursor: null }), false);
    assert.equal(isPaged(null), false);
  });
  it("counts the total only on the first page or a count-only request", () => {
    assert.equal(shouldCountTotal({}), true);
    assert.equal(shouldCountTotal({ cursor: null, limit: 20 }), true);
    assert.equal(shouldCountTotal({ cursor: "abc", limit: 20 }), false);
    assert.equal(shouldCountTotal({ cursor: "abc", limit: 0 }), true);
  });
});
