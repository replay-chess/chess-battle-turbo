import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AFTER_HYDRATION_FALLBACK_MS, afterHydration, type FrameEnv } from "./afterHydration";

/** A fake clock with an animation-frame queue that only runs when told to (frames can be starved). */
function fakeEnv() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const frames: (() => void)[] = [];
  const env: FrameEnv = {
    raf: (cb) => void frames.push(cb),
    setTimeout: (cb, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].cb();
    }
    now = until;
  };
  const frame = () => frames.splice(0).forEach((cb) => cb());
  return { env, advance, frame, pendingTimers: () => timers.size };
}

describe("afterHydration", () => {
  it("runs after the next frame plus a task, once, and drops the fallback", () => {
    const f = fakeEnv();
    let runs = 0;
    afterHydration(() => runs++, f.env);
    f.advance(10);
    assert.equal(runs, 0, "not before a frame");
    f.frame();
    assert.equal(runs, 0, "a task after the frame");
    f.advance(0);
    assert.equal(runs, 1);
    f.advance(AFTER_HYDRATION_FALLBACK_MS * 2);
    assert.equal(runs, 1, "the fallback does not run it again");
    assert.equal(f.pendingTimers(), 0);
  });

  // regression: CI run 43226863882 (webkit-iphone bot-game): no animation frame after the reload, so the controller
  // never resumed from the journal and the board stayed at the server snapshot's ply.
  it("still runs when no frame ever comes", () => {
    const f = fakeEnv();
    let runs = 0;
    afterHydration(() => runs++, f.env);
    f.advance(AFTER_HYDRATION_FALLBACK_MS - 1);
    assert.equal(runs, 0);
    f.advance(1);
    assert.equal(runs, 1);
    f.frame();
    f.advance(1_000);
    assert.equal(runs, 1, "a late frame does not run it again");
  });

  it("runs on the timer where there is no requestAnimationFrame", () => {
    const f = fakeEnv();
    let runs = 0;
    afterHydration(() => runs++, { ...f.env, raf: undefined });
    f.advance(AFTER_HYDRATION_FALLBACK_MS);
    assert.equal(runs, 1);
  });
});
