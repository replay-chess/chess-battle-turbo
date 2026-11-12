// Finish Review's sequencing (useMomentWalkthrough.ts runFinish; phase-03 plan §4.2, §5.2 "Walkthrough progress").
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { DEFAULT_TIMEOUT_MS } from "@/lib/api/client";
import { FINISH_WAIT_MS, runFinish } from "./useMomentWalkthrough";

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("runFinish", () => {
  it("flush → settle → A7 → navigate, in that order", async () => {
    const log: string[] = [];
    await runFinish("r-order", {
      flush: () => log.push("flush"),
      settle: async () => void log.push("settle"),
      complete: async () => void log.push("complete"),
      navigate: () => log.push("navigate"),
    });
    assert.deepEqual(log, ["flush", "settle", "complete", "navigate"]);
  });

  it("regression: finish-review-partial: a slow A7 (12 s, a cold server) still lands before the complete page opens", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const log: string[] = [];
      let landA7: () => void = () => undefined;
      const done = runFinish("r-slow", {
        flush: () => undefined,
        settle: async () => undefined,
        complete: () =>
          new Promise<void>((r) => {
            landA7 = () => {
              log.push("A7 landed");
              r();
            };
          }),
        navigate: () => log.push("navigate"),
      });
      await tick();
      mock.timers.tick(12_000);
      await tick();
      assert.deepEqual(log, [], "still waiting for A7 after 12 s (the old 8 s cap had navigated)");
      landA7();
      await done;
      assert.deepEqual(log, ["A7 landed", "navigate"]);
    } finally {
      mock.timers.reset();
    }
  });

  it("the backstop outlasts both request timeouts, and a failed A7 still opens the page", async () => {
    assert.ok(FINISH_WAIT_MS > 2 * DEFAULT_TIMEOUT_MS);
    let navigated = false;
    await runFinish("r-fail", {
      flush: () => undefined,
      settle: async () => undefined,
      complete: async () => {
        throw new Error("network");
      },
      navigate: () => (navigated = true),
    });
    assert.equal(navigated, true);
  });

  it("a second press while the first runs does nothing", async () => {
    let complete = 0;
    let release: () => void = () => undefined;
    const steps = {
      flush: () => undefined,
      settle: () => new Promise<void>((r) => (release = r)),
      complete: async () => void complete++,
      navigate: () => undefined,
    };
    const first = runFinish("r-twice", steps);
    assert.equal(await runFinish("r-twice", steps), false);
    release();
    assert.equal(await first, true);
    assert.equal(complete, 1);
    assert.equal(await runFinish("r-twice", { ...steps, settle: async () => undefined }), true, "free again afterwards");
  });
});
