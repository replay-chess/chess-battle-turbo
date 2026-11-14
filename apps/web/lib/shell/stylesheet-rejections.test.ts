// regression: webkit-home-css-cut — React's promise for a runtime stylesheet rejects with the link's `error` Event
// when WebKit cuts the load (a navigation leaves the page); the guard marks exactly that rejection handled.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installStylesheetRejectionGuard, isStylesheetLoadFailure } from "./stylesheet-rejections";

/** An `error` Event whose target is `target` (Event.target is set by dispatch; the test sets it directly). */
function errorEventOn(target: object, type = "error"): Event {
  const e = new Event(type);
  Object.defineProperty(e, "target", { value: target });
  return e;
}

const stylesheet = { tagName: "LINK", rel: "stylesheet" };

describe("isStylesheetLoadFailure", () => {
  it("is the error Event of a <link rel=stylesheet>", () => {
    assert.equal(isStylesheetLoadFailure(errorEventOn(stylesheet)), true);
    assert.equal(isStylesheetLoadFailure(errorEventOn({ tagName: "link", rel: "preload stylesheet" })), true);
  });

  it("is nothing else", () => {
    assert.equal(isStylesheetLoadFailure(errorEventOn({ tagName: "SCRIPT" })), false);
    assert.equal(isStylesheetLoadFailure(errorEventOn({ tagName: "LINK", rel: "preload" })), false);
    assert.equal(isStylesheetLoadFailure(errorEventOn({ tagName: "IMG" })), false);
    assert.equal(isStylesheetLoadFailure(errorEventOn(stylesheet, "abort")), false);
    assert.equal(isStylesheetLoadFailure(new Event("error")), false);
    assert.equal(isStylesheetLoadFailure(new TypeError("Load failed")), false);
    assert.equal(isStylesheetLoadFailure(Object.assign(new Error("Loading CSS chunk 1 failed"), { name: "ChunkLoadError" })), false);
    assert.equal(isStylesheetLoadFailure(undefined), false);
    assert.equal(isStylesheetLoadFailure({ type: "error", target: stylesheet }), false);
  });
});

describe("installStylesheetRejectionGuard", () => {
  type Listener = (e: PromiseRejectionEvent) => void;
  const fakeTarget = () => {
    const listeners: Listener[] = [];
    return { listeners, addEventListener: (_type: "unhandledrejection", l: Listener) => void listeners.push(l) };
  };
  const rejection = (reason: unknown) => {
    const calls = { prevented: 0, stopped: 0 };
    const e = { reason, preventDefault: () => void calls.prevented++, stopImmediatePropagation: () => void calls.stopped++ } as unknown as PromiseRejectionEvent;
    return { e, calls };
  };

  it("marks a stylesheet load failure handled and keeps later listeners (Sentry) from it", () => {
    const t = fakeTarget();
    assert.equal(installStylesheetRejectionGuard(t), true);
    const { e, calls } = rejection(errorEventOn(stylesheet));
    t.listeners[0]!(e);
    assert.deepEqual(calls, { prevented: 1, stopped: 1 });
  });

  it("leaves every other rejection alone", () => {
    const t = fakeTarget();
    installStylesheetRejectionGuard(t);
    for (const reason of [new TypeError("Load failed"), errorEventOn({ tagName: "SCRIPT" }), "x", null]) {
      const { e, calls } = rejection(reason);
      t.listeners[0]!(e);
      assert.deepEqual(calls, { prevented: 0, stopped: 0 });
    }
  });

  it("installs once per target, and nowhere on the server", () => {
    const t = fakeTarget();
    installStylesheetRejectionGuard(t);
    installStylesheetRejectionGuard(t);
    assert.equal(t.listeners.length, 1);
    assert.equal(installStylesheetRejectionGuard(undefined), false);
  });
});
