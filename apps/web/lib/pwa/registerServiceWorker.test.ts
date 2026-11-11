import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SW_SCOPE, SW_URL, registerServiceWorker, startServiceWorker, type SwEnv } from "./registerServiceWorker";

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

describe("startServiceWorker (browser wiring)", () => {
  /** A fake window/document/navigator; `results` scripts each register() call (an Error rejects). */
  function fakeBrowser(results: (true | Error)[]) {
    const win = new EventTarget();
    const calls: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, navigator: g.navigator, env: process.env.NODE_ENV };
    g.window = win;
    g.document = { readyState: "complete" };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          register(url: string) {
            calls.push(url);
            const r = results[calls.length - 1] ?? new Error("unscripted");
            return r === true ? Promise.resolve({}) : Promise.reject(r);
          },
        },
      },
    });
    (process.env as Record<string, string>).NODE_ENV = "production";
    const restore = () => {
      g.window = saved.window;
      g.document = saved.document;
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: saved.navigator });
      (process.env as Record<string, string | undefined>).NODE_ENV = saved.env;
    };
    const show = (persisted: boolean) => win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
    return { win, calls, restore, show };
  }
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

  it("a page restored from the back/forward cache after leaving mid-registration registers again", async () => {
    const b = fakeBrowser([cancelled(), true]);
    const reported: unknown[] = [];
    try {
      const stop = startServiceWorker((e) => reported.push(e), [20]);
      b.win.dispatchEvent(new Event("pagehide")); // the navigation that cancelled the load
      await tick(40);
      assert.equal(b.calls.length, 1, "no retry for a page being left");
      b.show(false);
      await tick(10);
      assert.equal(b.calls.length, 1, "a plain pageshow is not a restore");
      b.show(true);
      await tick(10);
      assert.equal(b.calls.length, 2, "registered again after the bfcache restore");
      assert.deepEqual(reported, []);
      stop();
    } finally {
      b.restore();
    }
  });

  it("the cleanup clears a pending retry", async () => {
    const b = fakeBrowser([new TypeError("first"), true]);
    try {
      const stop = startServiceWorker(() => {}, [30]);
      await tick(5);
      assert.equal(b.calls.length, 1);
      stop(); // unmount while the retry waits
      await tick(60);
      assert.equal(b.calls.length, 1, "no attempt after the cleanup");
    } finally {
      b.restore();
    }
  });
});
