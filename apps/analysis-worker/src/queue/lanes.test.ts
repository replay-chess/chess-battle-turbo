// The I/O lane (phase-04 plan §7.7.1; interface check §0.6): slot lock ids, kick routing, two slots at once, the
// drain-end batch, the next-due sleep and the IMPORT_PAUSED switch, on the in-memory queue (testing/fake-queue.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CountingDb } from "../db/client";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { FakeClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { FakeQueue } from "../testing/fake-queue";
import type { ClaimedJob } from "./claim";
import { bootLockIds, IO_KINDS, IoLane, ioSlotId, kickTargets, routeKick } from "./lanes";
import { orphanPattern } from "./outcome";

const ME = "dev-worker-abcd1234";

function likeToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "_") re += ".";
    else if (c === "%") re += ".*";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

describe("I/O lane lock ids", () => {
  it("each slot has its own id: 8 chars after the worker id, never the engine's, inside varchar(40)", () => {
    const ids = bootLockIds(ME);
    assert.deepEqual(ids, [ME, "dev-worker-abcd12i1", "dev-worker-abcd12i2"]);
    const orphan = likeToRegExp(orphanPattern("dev-worker"));
    for (const id of ids) assert.match(id, orphan, "the reaper's orphan pattern still matches every id of the boot");
    const longest = ioSlotId(`${"w".repeat(30)}-deadbeef`, 2);
    assert.equal(longest.length, 39);
    assert.throws(() => ioSlotId("noboot", 1));
    assert.throws(() => ioSlotId(ME, 0));
  });
});

describe("kick routing", () => {
  it("import kinds wake the I/O lane, analysis kinds the engine lane, no kinds both", () => {
    assert.deepEqual(kickTargets({ kinds: ["IMPORT_SYNC", "IMPORT_PURGE"] }), { engine: false, io: true });
    assert.deepEqual(kickTargets({ kinds: ["ANALYZE_GAME"] }), { engine: true, io: false });
    assert.deepEqual(kickTargets({}), { engine: true, io: true });
    assert.deepEqual(kickTargets({ kinds: ["ANALYZE_GAME", "IMPORT_SYNC"] }), { engine: true, io: true });
  });

  it("merges the lanes' answers: draining if either is, the earliest next run", () => {
    const calls: string[] = [];
    const engine = { kick: () => (calls.push("engine"), { draining: false, nextRunAt: "2026-11-12T10:00:00.000Z" }) };
    const io = { kick: () => (calls.push("io"), { draining: true, nextRunAt: "2026-11-12T09:05:00.000Z" }) };
    assert.deepEqual(routeKick({ v: 1, reason: "import", kinds: ["IMPORT_SYNC"] }, engine, io), {
      draining: true,
      nextRunAt: "2026-11-12T09:05:00.000Z",
    });
    assert.deepEqual(calls, ["io"]);
    assert.deepEqual(routeKick({ v: 1, reason: "test" }, engine, io).nextRunAt, "2026-11-12T09:05:00.000Z");
    assert.deepEqual(routeKick({ v: 1, reason: "import", kinds: ["IMPORT_SYNC"] }, engine, null).draining, false, "no lane: the engine answers");
  });
});

function harness(opts: { paused?: boolean } = {}) {
  const clock = new FakeClock(Date.UTC(2026, 10, 12, 9, 0, 0));
  const queue = new FakeQueue(() => clock.now());
  const db = new CountingDb(queue);
  const running = new Map<string, { job: ClaimedJob; slot: string; finish: () => void }>();
  const lane = new IoLane({
    db,
    clock,
    log: silentLogger,
    metrics: new Metrics({ workerId: ME, bootId: "abcd1234", version: "0", profile: "sf18-v1" }, clock.now()),
    emitter: new RecordingEmitter(),
    me: ME,
    workerId: "dev-worker",
    kinds: opts.paused ? [] : IO_KINDS,
    payloadVMax: 1,
    runJob: (job, slot) =>
      new Promise<void>((resolve) => {
        running.set(job.id, {
          job,
          slot,
          finish: () => {
            const row = queue.jobs.find((j) => j.id === job.id)!;
            Object.assign(row, { status: "DONE", finishedAtMs: clock.now() });
            running.delete(job.id);
            resolve();
          },
        });
      }),
  });
  return { clock, queue, db, lane, running };
}

const tick = async (clock: FakeClock) => clock.advance(0);

describe("IoLane", () => {
  it("two slots run two imports at once, each as its own lockedBy", async () => {
    const h = harness();
    const a = h.queue.add({ kind: "IMPORT_SYNC", priority: 60 });
    const b = h.queue.add({ kind: "IMPORT_PURGE", priority: 20 });
    const engineJob = h.queue.add({ kind: "ANALYZE_GAME", priority: 80 });
    h.lane.start();
    await tick(h.clock);
    assert.equal(h.running.size, 2, "both slots claimed");
    assert.deepEqual(
      [a, b].map((j) => j.lockedBy).sort(),
      ["dev-worker-abcd12i1", "dev-worker-abcd12i2"],
      "one row per slot, under the slot's id",
    );
    assert.equal(engineJob.status, "QUEUED", "the I/O lane never claims an analysis");
    assert.equal(h.lane.view().busySlots, 2);
    for (const r of [...h.running.values()]) r.finish();
    await tick(h.clock);
    assert.equal(h.lane.view().busySlots, 0);
  });

  it("drains, then one batch (a reap per slot + the summary), then sleeps until min(runAt) of the import kinds", async () => {
    const h = harness();
    const later = h.clock.now() + 3 * 3_600_000;
    h.queue.add({ kind: "IMPORT_SYNC", priority: 15, runAtMs: later });
    h.queue.add({ kind: "ANALYZE_GAME", priority: 80, runAtMs: h.clock.now() + 60_000 });
    h.lane.start();
    await tick(h.clock);
    assert.deepEqual(h.queue.log, ["claim", "claim", "reap", "reap", "summary"], "both slots looked once; one drain-end batch");
    assert.equal(h.db.counters.roundTrips, 3);
    assert.equal(h.lane.view().nextRunAtMs, later, "the analysis row is not the I/O lane's business");
    assert.equal(h.clock.nextDue, later, "one timer, at the daily slot");
    // Nothing happens before then: zero queries.
    await h.clock.advance(3 * 3_600_000 - 1_000);
    assert.equal(h.db.counters.roundTrips, 3);
    await h.clock.advance(1_000);
    assert.equal(h.running.size, 1, "woke at the slot and claimed the sync");
  });

  it("a kick wakes an idle slot at once; a kick with a future runAt only shortens the sleep", async () => {
    const h = harness();
    h.lane.start();
    await tick(h.clock);
    assert.equal(h.clock.nextDue, h.clock.now() + 24 * 3_600_000, "nothing queued: the 24 h cap");
    h.queue.add({ kind: "IMPORT_SYNC", priority: 100 });
    const res = h.lane.kick({ v: 1, reason: "import", kinds: ["IMPORT_SYNC"] });
    assert.equal(res.draining, true);
    await tick(h.clock);
    assert.equal(h.running.size, 1);
    [...h.running.values()][0]!.finish();
    await tick(h.clock);
    const at = new Date(h.clock.now() + 120_000).toISOString();
    assert.equal(h.lane.kick({ v: 1, reason: "import_retry", runAt: at }).draining, false);
    assert.equal(h.clock.nextDue, Date.parse(at));
  });

  it("IMPORT_PAUSED: the lane has no kinds, issues no query and ignores kicks", async () => {
    const h = harness({ paused: true });
    h.queue.add({ kind: "IMPORT_SYNC", priority: 100 });
    h.lane.start();
    await tick(h.clock);
    assert.equal(h.lane.kick({ v: 1, reason: "import" }).draining, false);
    await h.clock.advance(48 * 3_600_000);
    assert.equal(h.db.counters.roundTrips, 0);
    assert.equal(h.lane.view().paused, true);
    await h.lane.stop(1_000);
  });

  it("stop() lets the running imports end and resolves", async () => {
    const h = harness();
    h.queue.add({ kind: "IMPORT_SYNC", priority: 100 });
    h.lane.start();
    await tick(h.clock);
    assert.equal(h.running.size, 1);
    const stopped = h.lane.stop(25_000);
    assert.equal(h.lane.stopSignal.aborted, true);
    [...h.running.values()][0]!.finish();
    await tick(h.clock);
    await stopped;
    assert.equal(h.lane.kick({ v: 1, reason: "import" }).draining, false, "a stopping lane claims nothing");
  });
});
