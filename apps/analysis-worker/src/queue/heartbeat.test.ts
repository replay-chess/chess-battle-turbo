// The heartbeat (phase-03 plan §8.12 step 5): a beat 30 s after the last write, postponed by every checkpoint, the
// returned priority handed back (band switch), onLost when the job is no longer ours, suspend (the stall fault).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CountingDb } from "../db/client";
import { silentLogger } from "../obs/log";
import { FakeClock } from "../scheduler/clock";
import { FakeQueue } from "../testing/fake-queue";
import { Heartbeat, HEARTBEAT_EVERY_MS } from "./heartbeat";

function setup() {
  const clock = new FakeClock();
  const queue = new FakeQueue(() => clock.now());
  const job = queue.add({ kind: "ANALYZE_GAME", status: "RUNNING", lockedBy: "me-00000001", priority: 10 });
  const priorities: number[] = [];
  let lost = 0;
  const hb = new Heartbeat({
    db: new CountingDb(queue),
    clock,
    log: silentLogger,
    jobId: job.id,
    me: "me-00000001",
    onPriority: (p) => priorities.push(p),
    onLost: () => lost++,
  });
  return { clock, queue, job, hb, priorities, lost: () => lost };
}

describe("heartbeat", () => {
  it("beats 30 s after the last write and hands back the job's current priority", async () => {
    const s = setup();
    s.hb.start();
    await s.clock.advance(HEARTBEAT_EVERY_MS - 1);
    assert.equal(s.job.heartbeatAtMs, null);
    s.job.priority = 100; // an A3 raised it mid-run
    await s.clock.advance(1);
    assert.equal(s.job.heartbeatAtMs, s.clock.now());
    assert.deepEqual(s.priorities, [100]);
    await s.clock.advance(HEARTBEAT_EVERY_MS);
    assert.equal(s.queue.log.filter((l) => l === "heartbeat").length, 2, "keeps beating while nothing is written");
    s.hb.stop();
    await s.clock.advance(10 * HEARTBEAT_EVERY_MS);
    assert.equal(s.queue.log.filter((l) => l === "heartbeat").length, 2);
    assert.equal(s.clock.pending, 0);
  });

  it("a checkpoint write postpones the beat and passes its priority on", async () => {
    const s = setup();
    s.hb.start();
    await s.clock.advance(20_000);
    s.hb.noteWrite(80);
    await s.clock.advance(20_000);
    assert.deepEqual(s.queue.log, [], "no beat 40 s after start: the write at 20 s reset the timer");
    await s.clock.advance(10_000);
    assert.deepEqual(s.queue.log, ["heartbeat"]);
    assert.deepEqual(s.priorities, [80, 10]);
    s.hb.stop();
  });

  it("calls onLost once the job is no longer ours, and stops", async () => {
    const s = setup();
    s.hb.start();
    s.job.lockedBy = "reaper-took-it";
    assert.equal(await s.hb.beat(), null);
    assert.equal(s.lost(), 1);
    await s.clock.advance(5 * HEARTBEAT_EVERY_MS);
    assert.equal(s.queue.log.length, 1, "no further beats");
  });

  it("a failed beat is retried at the next interval, not reported as lost", async () => {
    const s = setup();
    s.hb.start();
    s.queue.failNext = 1;
    await s.clock.advance(HEARTBEAT_EVERY_MS);
    assert.equal(s.lost(), 0);
    await s.clock.advance(HEARTBEAT_EVERY_MS);
    assert.equal(s.job.heartbeatAtMs, s.clock.now());
    s.hb.stop();
  });

  it("suspend() (stall_at_ply) stops beating so the job goes stale", async () => {
    const s = setup();
    s.hb.start();
    s.hb.suspend();
    s.hb.noteWrite();
    await s.clock.advance(10 * HEARTBEAT_EVERY_MS);
    assert.deepEqual(s.queue.log, []);
    assert.equal(s.hb.isSuspended, true);
  });
});
