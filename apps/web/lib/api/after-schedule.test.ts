// route()'s after(): a promise handed to Next's after() (waitUntil), started on the next macrotask (FIX-1: the callback
// form waited for the response's close event and lost every effect when the browser navigated away at once).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scheduleAfter } from "./context";

describe("scheduleAfter", () => {
  it("regression: after-callbacks-lost-on-navigation (FIX-1): Next gets a promise, the task runs without any close event", async () => {
    const kept: unknown[] = [];
    const ran: string[] = [];
    scheduleAfter(() => void ran.push("task"), (p) => kept.push(p));
    assert.equal(kept.length, 1);
    assert.ok(kept[0] instanceof Promise, "the promise form (waitUntil), not a callback waiting for close");
    assert.deepEqual(ran, [], "not inside the caller's synchronous code");
    await kept[0];
    assert.deepEqual(ran, ["task"]);
  });

  it("a failing task is reported, never rejected into Next", async () => {
    const errors: unknown[] = [];
    let promise: Promise<unknown> | null = null;
    scheduleAfter(
      async () => {
        throw new Error("boom");
      },
      (p) => {
        promise = p;
      },
      (e) => errors.push(e),
    );
    await assert.doesNotReject(promise!);
    assert.equal((errors[0] as Error).message, "boom");
  });
});
