// The runner's W3 `after` (features/train/useSessionExtend.ts extendAfter) against the server's reading of it
// (`itemsAfter`, lib/train/sessions.server.ts extendSession): the answer holds only items the runner does not have.
// regression: extend-after-pass2 (REGRESSION-5). Lives server-side: features/train may not import the training
// package's server modules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemsAfter } from "@repo/chess-training/session";
import { extendAfter } from "@/features/train/useSessionExtend";

const ids = (xs: string[]) => xs.map((itemId) => ({ itemId, pass: itemId.endsWith("b") ? 2 : 1 }));

test("the server's answer to that `after` holds only items the runner does not have yet", () => {
  const client = ids(["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i1b", "i8", "i9", "i10", "i8b"]);
  // The server's list after the same Again (and a first extend already appended i11–i13 by a lost response).
  const server = ids(["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i1b", "i8", "i9", "i10", "i8b", "i11", "i12", "i13"]);
  const held = new Set(client.map((c) => c.itemId));
  const answer = itemsAfter(server, extendAfter(client)!);
  assert.deepEqual(answer.map((a) => a.itemId), ["i11", "i12", "i13"]);
  assert.ok(answer.every((a) => !held.has(a.itemId)));
  // The old `after` (the last element) answered held items only.
  assert.deepEqual(itemsAfter(server.slice(0, 12), "i8b").map((a) => a.itemId), ["i9", "i10"]);
});
