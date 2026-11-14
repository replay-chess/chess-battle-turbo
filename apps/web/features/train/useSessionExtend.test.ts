// W3 `after` (phase-05 plan §7.3 W3, §8.6): the stream's last pass-1 item, never a re-queued pass-2 copy.
// regression: extend-after-pass2 (REGRESSION-5: puzzles.spec T7, an Again's "i8b" at the end of the list was sent as
// `after`, the server answered the held i9 and i10, and the runner asked again in a loop until `train-write` said 429).
import assert from "node:assert/strict";
import { test } from "node:test";
import { extendAfter, shouldExtend } from "./useSessionExtend";

const ids = (xs: string[]) => xs.map((itemId) => ({ itemId, pass: itemId.endsWith("b") ? 2 : 1 }));

test("after is the last pass-1 item, also when a pass-2 copy ends the list", () => {
  assert.equal(extendAfter(ids(["i1", "i2", "i3"])), "i3");
  assert.equal(extendAfter(ids(["i1", "i9", "i10", "i8b"])), "i10");
  assert.equal(extendAfter(ids(["i1b"])), null);
  assert.equal(extendAfter([]), null);
});

test("shouldExtend: two items from the end of an idle stream", () => {
  const base = { stream: true, extend: "idle", ended: false, items: { length: 12 } };
  assert.equal(shouldExtend({ ...base, index: 9 }), true);
  assert.equal(shouldExtend({ ...base, index: 8 }), false);
  assert.equal(shouldExtend({ ...base, index: 9, extend: "ended" }), false);
});
