import assert from "node:assert/strict";
import { test } from "node:test";
import { preRenderedNext } from "./next-board";

test("the pre-rendered next board is never the current item (stale deferred value right after an advance)", () => {
  const i2 = { itemId: "i2" };
  // Showing i1, next i2: pre-render i2.
  assert.equal(preRenderedNext("i1", i2), i2);
  // Advanced to i2, the deferred next still says i2: nothing until it catches up (no duplicate key).
  assert.equal(preRenderedNext("i2", i2), null);
  // Caught up: i2 shown, i3 next.
  assert.deepEqual(preRenderedNext("i2", { itemId: "i3" }), { itemId: "i3" });
  // The pass-2 copy after an Again is its own item.
  assert.deepEqual(preRenderedNext("i3", { itemId: "i3b" }), { itemId: "i3b" });
  assert.equal(preRenderedNext("i3", null), null);
});
