// The `analysis:batch` accumulator (phase-03 plan §5.11, §8.12, P3-D26): one coalesced frame per member per 60 s, at
// the end of a drain and when the window ends, and every pending frame on shutdown.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { silentLogger } from "../obs/log";
import { FakeClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { BatchAccumulator } from "./batch-events";

const G1 = "c00000000000000000000001";
const G2 = "c00000000000000000000002";
const G3 = "c00000000000000000000003";
const G4 = "c00000000000000000000004";

function setup() {
  const clock = new FakeClock();
  const emitter = new RecordingEmitter();
  const reads: string[][] = [];
  const batch = new BatchAccumulator({
    emitter,
    clock,
    log: silentLogger,
    queuedFor: async (refs) => {
      reads.push([...refs]);
      return new Map(refs.map((r) => [r, 2]));
    },
    intervalMs: 60_000,
  });
  return { clock, emitter, batch, reads };
}

describe("analysis:batch accumulator", () => {
  it("sends one frame per member at the end of a drain, then holds the next one for the window", async () => {
    const { clock, emitter, batch } = setup();
    batch.add(["u1", "u2"], G1, "done");
    await batch.flushAtDrainEnd();
    assert.deepEqual(
      emitter.sent.map((s) => [s.event, s.userRefs[0]]),
      [
        ["analysis:batch", "u1"],
        ["analysis:batch", "u2"],
      ],
    );
    batch.add(["u1"], G2, "failed");
    await clock.advance(10_000);
    await batch.flushAtDrainEnd();
    assert.equal(emitter.sent.length, 2, "u1 is inside its 60 s window");
    assert.equal(batch.pendingUsers, 1);
    assert.equal(clock.pending, 1, "one timer for the window's end");
  });

  // regression: batch-frames-dropped-on-stop (FIX-2, review round 2). SIGTERM cleared the timer without flushing, so
  // members whose analyses finished inside the last window never got their frame.
  it("flushAll on shutdown sends every pending frame, inside its window or not, and leaves no timer", async () => {
    const { clock, emitter, batch, reads } = setup();
    batch.add(["u1"], G1, "done");
    await batch.flushAtDrainEnd();
    batch.add(["u1"], G2, "done");
    batch.add(["u1"], G3, "failed");
    batch.add(["u3"], G4, "done");
    await clock.advance(5_000);
    await batch.flushAtDrainEnd();
    assert.equal(emitter.sent.length, 2, "u3 is sent, u1 waits for its window");
    await batch.flushAll();
    assert.equal(batch.pendingUsers, 0);
    assert.equal(clock.pending, 0);
    const last = emitter.sent.at(-1)!;
    assert.deepEqual(last.userRefs, ["u1"]);
    assert.deepEqual(last.data, { v: 1, done: 1, failed: 1, queued: 2, refs: [G3, G2] });
    assert.deepEqual(reads.at(-1), ["u1"]);
  });
});
