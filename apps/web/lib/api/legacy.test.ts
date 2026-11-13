import assert from "node:assert/strict";
import { test } from "node:test";
import { unwrapLegacy } from "./legacy";

test("the envelope { data, meta }", () => {
  assert.deepEqual(unwrapLegacy({ data: { a: 1 }, meta: { nextCursor: "c1", total: 3 } }), {
    ok: true,
    shape: "envelope",
    data: { a: 1 },
    meta: { nextCursor: "c1", total: 3 },
  });
  const r = unwrapLegacy({ data: null });
  assert.ok(r.ok);
  assert.equal(r.shape, "envelope");
  assert.equal(r.data, null);
});

test("the envelope with legacy top-level mirrors (socket-token) reads data", () => {
  const r = unwrapLegacy({ data: { token: "t", expiresAt: "x" }, token: "t", expiresAt: "x" });
  assert.ok(r.ok);
  assert.deepEqual(r.data, { token: "t", expiresAt: "x" });
});

test("legacy { success: true, data }", () => {
  const r = unwrapLegacy({ success: true, data: { openings: [] } });
  assert.deepEqual(r, { ok: true, shape: "success", data: { openings: [] }, meta: undefined });
});

test("legacy { success: true, ...fields } without data returns the fields", () => {
  const r = unwrapLegacy({ success: true, legends: [1], count: 1 });
  assert.deepEqual(r, { ok: true, shape: "success", data: { legends: [1], count: 1 } });
});

test("legacy { success: false } is not ok", () => {
  const body = { success: false, error: "Failed to fetch openings" };
  assert.deepEqual(unwrapLegacy(body), { ok: false, shape: "success", body });
});

test("a raw billing object is returned whole", () => {
  const sub = { entitled: true, paywall: true, trialEligible: false, subscription: { id: "sub_1" } };
  assert.deepEqual(unwrapLegacy(sub), { ok: true, shape: "raw", data: sub });
});

test("non-objects are raw", () => {
  assert.deepEqual(unwrapLegacy("ok"), { ok: true, shape: "raw", data: "ok" });
  assert.deepEqual(unwrapLegacy([1, 2]), { ok: true, shape: "raw", data: [1, 2] });
  assert.deepEqual(unwrapLegacy(null), { ok: true, shape: "raw", data: null });
});

test("regression: archive-meta-dropped (FIX-1): meta keys beyond the paging ones reach the caller", () => {
  const meta = { nextCursor: null, filteredTotal: 46, counts: { all: 46, replay: 1, chesscom: 45, lichess: 0 } };
  const r = unwrapLegacy({ data: [], meta });
  assert.ok(r.ok);
  assert.deepEqual(r.meta, meta);
  // The typed keys are still checked: a wrong-typed paging key is dropped, the rest kept.
  const bad = unwrapLegacy({ data: [], meta: { nextCursor: 5, total: "x", counts: { all: 1 } } });
  assert.ok(bad.ok);
  assert.deepEqual(bad.meta, { counts: { all: 1 } });
});
