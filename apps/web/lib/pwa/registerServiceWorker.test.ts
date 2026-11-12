import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SW_SCOPE, SW_URL, dropLeftoverPrecache, registerServiceWorker, startServiceWorker, type SwEnv } from "./registerServiceWorker";

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

  it("a page already being left starts no attempt", async () => {
    const t = env([true]);
    t.e.leaving = () => true;
    assert.equal(await registerServiceWorker(t.e, [10, 20]), "left");
    assert.deepEqual(t.calls, []);
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
  function fakeBrowser(results: (true | Error)[], readyState: DocumentReadyState = "complete") {
    const win = new EventTarget();
    const calls: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, navigator: g.navigator, env: process.env.NODE_ENV };
    g.window = win;
    g.document = { readyState };
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

  // CI run 43200912012 (bot-game, webkit-iphone): between the start of a navigation and the next page's commit the
  // old document still runs timers and `load`, and WebKit logs any register() started then as a page error.
  it("a retry that comes due after a navigation started (beforeunload, before pagehide) is not started", async () => {
    const b = fakeBrowser([new TypeError("first"), true]);
    try {
      const stop = startServiceWorker(() => {}, [20]);
      await tick(5);
      assert.equal(b.calls.length, 1);
      b.win.dispatchEvent(new Event("beforeunload")); // the navigation starts; the next page has not committed
      await tick(40);
      assert.equal(b.calls.length, 1, "no attempt while the page is being left");
      stop();
    } finally {
      b.restore();
    }
  });

  it("a load event after a navigation started does not start the registration", async () => {
    const b = fakeBrowser([true], "loading");
    try {
      const stop = startServiceWorker(() => {}, [20]);
      b.win.dispatchEvent(new Event("beforeunload"));
      b.win.dispatchEvent(new Event("load"));
      await tick(10);
      assert.equal(b.calls.length, 0);
      b.win.dispatchEvent(new Event("pagehide"));
      b.show(true); // restored from the back/forward cache: registers then
      await tick(10);
      assert.equal(b.calls.length, 1);
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

describe("dropLeftoverPrecache", () => {
  // regression: until 2026-11 every install failed during precaching and left workbox-precache-v2-<scope> behind.
  it("deletes only Workbox precache caches and reports how many", async () => {
    const names = new Set(["workbox-precache-v2-https://app.example/", "next-static", "rc-engine-v18", "static-image-assets"]);
    const store = { keys: async () => [...names], delete: async (k: string) => names.delete(k) };
    assert.equal(await dropLeftoverPrecache(store), 1);
    assert.deepEqual([...names].sort(), ["next-static", "rc-engine-v18", "static-image-assets"]);
  });
  it("never throws: no Cache Storage, or a failing one", async () => {
    assert.equal(await dropLeftoverPrecache(undefined), 0);
    const broken = { keys: async () => Promise.reject(new Error("SecurityError")), delete: async () => false };
    assert.equal(await dropLeftoverPrecache(broken), 0);
  });
});

describe("startServiceWorker waits for load, but not for ever", () => {
  // regression: a slow third-party badge image held `load` (and so the registration) for as long as its host took;
  // e2e pwa-service-worker.spec saw a first visit stay uncontrolled for 30 s on both browsers.
  it("registers on load, or after the fallback when load never comes, once", async () => {
    const win = new EventTarget();
    const calls: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, navigator: g.navigator, env: process.env.NODE_ENV };
    g.window = win;
    g.document = { readyState: "interactive" };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { serviceWorker: { register: (url: string) => (calls.push(url), Promise.resolve({})) } },
    });
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const stop = startServiceWorker(() => undefined, [10], 30);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, 0, "not before load or the fallback");
      await new Promise((r) => setTimeout(r, 40));
      assert.deepEqual(calls, ["/sw.js"], "the fallback registered while load was still pending");
      win.dispatchEvent(new Event("load"));
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, 1, "a late load does not register again");
      stop();
    } finally {
      g.window = saved.window;
      g.document = saved.document;
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: saved.navigator });
      (process.env as Record<string, string | undefined>).NODE_ENV = saved.env;
    }
  });
});
