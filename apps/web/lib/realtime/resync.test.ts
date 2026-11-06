import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldResync } from "./resync";

const hello = (bootId: string, useq: number) => ({ bootId, useq, serverNow: 1 });

test("the first hello of a tab never resyncs (the server render is fresh)", () => {
  assert.equal(shouldResync(null, hello("a", 5), 0), false);
});

test("a new bootId resyncs: the server restarted and may have dropped user-room events", () => {
  assert.equal(shouldResync(hello("a", 5), hello("b", 0), 5), true);
});

test("same process, no useq gap: a flaky-network reconnect refetches nothing", () => {
  assert.equal(shouldResync(hello("a", 5), hello("a", 5), 5), false);
  assert.equal(shouldResync(hello("a", 5), hello("a", 7), 7), false); // events 6 and 7 were seen live
});

test("same process with a useq gap: a user-room event was missed", () => {
  assert.equal(shouldResync(hello("a", 5), hello("a", 8), 6), true);
});
