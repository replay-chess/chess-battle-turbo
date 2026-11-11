import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SW_SCOPE, SW_URL, registerServiceWorker, type SwEnv } from "./registerServiceWorker";

/** A scripted env: `results[i]` is attempt i's outcome (an Error rejects); `leaveAt` marks the page as left. */
function env(results: (true | Error)[], opts: { leaveAfterAttempt?: number; leaveDuringWait?: number } = {}) {
  const calls: { url: string; options: RegistrationOptions }[] = [];
  const waits: number[] = [];
  const reported: unknown[] = [];
  let left = false;
  const e: SwEnv = {
    register(url, options) {
      calls.push({ url, options });
      const r = results[calls.length - 1] ?? new Error("unscripted attempt");
      if (opts.leaveAfterAttempt === calls.length) left = true;
      return r === true ? Promise.resolve({}) : Promise.reject(r);
    },
    wait(ms) {
      waits.push(ms);
      if (opts.leaveDuringWait === waits.length) left = true;
      return Promise.resolve();
    },
    leaving: () => left,
    report: (error) => reported.push(error),
  };
  return { e, calls, waits, reported };
}

// WebKit's rejection when a navigation cancels the script load (the CI flake in paywall-game, webkit-iphone).
const cancelled = () => Object.assign(new Error("Script http://localhost:3000/sw.js load failed"), { name: "SecurityError" });

describe("registerServiceWorker", () => {
  it("registers /sw.js at scope / once", async () => {
    const t = env([true]);
    assert.equal(await registerServiceWorker(t.e, [10, 20]), "registered");
    assert.deepEqual(t.calls, [{ url: SW_URL, options: { scope: SW_SCOPE } }]);
    assert.deepEqual(t.reported, []);
  });

  it("a load cancelled by leaving the page is neither thrown nor reported", async () => {
    const t = env([cancelled()], { leaveAfterAttempt: 1 });
    assert.equal(await registerServiceWorker(t.e, [10, 20]), "left");
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.waits, []);
    assert.deepEqual(t.reported, []);
  });

  it("a page left while waiting to retry does not retry or report", async () => {
    const t = env([cancelled()], { leaveDuringWait: 1 });
    assert.equal(await registerServiceWorker(t.e, [10, 20]), "left");
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.reported, []);
  });

  it("a transient failure is retried after the delay and then succeeds", async () => {
    const t = env([cancelled(), true]);
    assert.equal(await registerServiceWorker(t.e, [10, 20]), "registered");
    assert.equal(t.calls.length, 2);
    assert.deepEqual(t.waits, [10]);
    assert.deepEqual(t.reported, []);
  });

  it("a real failure (every attempt, page still open) is reported once, with the last error, and never thrown", async () => {
    const last = new TypeError("Failed to register a ServiceWorker: A bad HTTP response code (404) was received");
    const t = env([new TypeError("first"), new TypeError("second"), last]);
    assert.equal(await registerServiceWorker(t.e, [10, 20]), "failed");
    assert.equal(t.calls.length, 3);
    assert.deepEqual(t.waits, [10, 20]);
    assert.deepEqual(t.reported, [last]);
  });
});
