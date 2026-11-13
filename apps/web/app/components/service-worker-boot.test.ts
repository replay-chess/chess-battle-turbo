// regression: sw-chunk-abort — a rejected lazy load ends quietly (no unhandled rejection); a loaded one starts once,
// stops on clean-up, and never starts after an unmount.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootServiceWorker } from "./service-worker-boot";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("bootServiceWorker", () => {
  it("a chunk load that fails (a navigation aborted it) is not an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const stop = bootServiceWorker(() => Promise.reject(Object.assign(new Error("Loading chunk 264 failed."), { name: "ChunkLoadError" })));
      await tick();
      await tick();
      stop();
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("starts the registration once and stops it on clean-up", async () => {
    let started = 0;
    let stopped = 0;
    const stop = bootServiceWorker(async () => ({
      start: () => {
        started++;
        return () => void stopped++;
      },
      logger: { error: () => {} },
    }));
    await tick();
    assert.equal(started, 1);
    stop();
    assert.equal(stopped, 1);
  });

  it("an unmount before the chunk arrives starts nothing", async () => {
    let started = 0;
    const stop = bootServiceWorker(async () => ({ start: () => (started++, () => {}), logger: { error: () => {} } }));
    stop();
    await tick();
    assert.equal(started, 0);
  });
});
