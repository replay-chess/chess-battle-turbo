// The job runner (phase-03 plan §8.12 "Failure", "Graceful SIGTERM", FEA §9): a newer payload released for the newer
// build, an invalid payload failed at once, a JobError / EngineFailed / unexpected error mapped to its contract code
// with the back-off, SIGTERM releasing without counting the attempt, a job lost to the reaper writing nothing, and
// the done path's metrics.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { CountingDb } from "../db/client";
import { EngineFailed } from "../engine/types";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { noopTelemetry, type Telemetry } from "../obs/telemetry";
import { claimJob } from "../queue/claim";
import { doneStatement, lockGuardStatement } from "../queue/outcome";
import { FakeClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { FakeQueue } from "../testing/fake-queue";
import { NEWER_PAYLOAD_RELEASE_SEC, runJob, type HandlerMap } from "./runner";
import { JobAborted, JobError, throwIfAborted, type JobHandler } from "./types";

const REF = "cgamereference0000000001";
const ME = "test-worker-00000001";

function setup(run: JobHandler<"ANALYZE_GAME">["run"], payload: Record<string, unknown> = { v: 1, gameId: "1", gameRef: REF, reason: "live_end" }) {
  const clock = new FakeClock();
  const queue = new FakeQueue(() => clock.now());
  const db = new CountingDb(queue);
  const metrics = new Metrics({ workerId: ME, bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now());
  const captured: unknown[] = [];
  const telemetry: Telemetry = { ...noopTelemetry, captureException: (e) => void captured.push(e) };
  const job = queue.add({ kind: "ANALYZE_GAME", priority: JOB_PRIORITY.GAME_ENDED, payload });
  const stop = new AbortController();
  const handlers: HandlerMap = { ANALYZE_GAME: { kind: "ANALYZE_GAME", run } };
  const go = async () => {
    const claimed = await claimJob(db, ME, ["ANALYZE_GAME"], 1);
    if (!claimed) throw new Error("nothing claimed");
    return runJob(claimed, {
      db,
      clock,
      log: silentLogger,
      metrics,
      telemetry,
      emitter: new RecordingEmitter(),
      me: ME,
      appEnv: "test",
      handlers,
      engine: null,
      evalCache: null,
      evalCacheMaxBytes: 0,
      lag: null,
      stopSignal: stop.signal,
      isWatched: () => false,
      takeFault: () => null,
    });
  };
  return { clock, queue, job, metrics, captured, stop, go };
}

const done: JobHandler<"ANALYZE_GAME">["run"] = async (ctx) => {
  await ctx.db.batch([lockGuardStatement(ctx.job.id, ctx.me), doneStatement(ctx.job.id, ctx.me)]);
  return "done";
};

describe("runner", () => {
  it("runs the handler with the parsed payload and records the duration", async () => {
    let seen: unknown;
    const s = setup(async (ctx) => {
      seen = ctx.payload;
      return done(ctx);
    });
    assert.equal(await s.go(), "done");
    assert.deepEqual(seen, { v: 1, gameId: "1", gameRef: REF, reason: "live_end" });
    assert.equal(s.job.status, "DONE");
    assert.deepEqual(s.metrics.snapshot(0, { draining: false, nextRunAtMs: null, lastDrainAtMs: null }).jobs.done, { ANALYZE_GAME: 1 });
    assert.equal(s.clock.pending, 0, "the heartbeat timer is gone");
  });

  it("releases a payload written by a newer build (no attempt counted, back in 10 minutes)", async () => {
    let ran = false;
    const s = setup(async () => {
      ran = true;
      return "done";
    }, { v: 2, gameId: "1" });
    // The claim never takes v > PAYLOAD_V_MAX; a build that does (here, by claiming with v 2) releases it.
    const claimed = await (async () => {
      const db = new CountingDb(s.queue);
      return claimJob(db, ME, ["ANALYZE_GAME"], 2);
    })();
    assert.ok(claimed);
    const result = await runJob(claimed, {
      db: new CountingDb(s.queue),
      clock: s.clock,
      log: silentLogger,
      metrics: s.metrics,
      telemetry: noopTelemetry,
      emitter: new RecordingEmitter(),
      me: ME,
      appEnv: "test",
      handlers: {},
      engine: null,
      evalCache: null,
      evalCacheMaxBytes: 0,
      lag: null,
      stopSignal: s.stop.signal,
      isWatched: () => false,
      takeFault: () => null,
    });
    assert.equal(result, "released");
    assert.equal(ran, false);
    assert.equal(s.job.status, "QUEUED");
    assert.equal(s.job.attempts, 0);
    assert.equal(s.job.runAtMs, s.clock.now() + NEWER_PAYLOAD_RELEASE_SEC * 1000);
  });

  it("fails an invalid payload at once (terminal, internal)", async () => {
    const s = setup(done, { v: 1, gameId: "not-a-number" });
    assert.equal(await s.go(), "failed");
    assert.equal(s.job.status, "FAILED");
    assert.match(s.job.lastError ?? "", /^internal: invalid payload/);
  });

  it("maps a JobError to its code and backs off 30 s on the first attempt", async () => {
    const s = setup(async () => {
      throw new JobError("timeout", "pass 2 over budget");
    });
    assert.equal(await s.go(), "failed");
    assert.equal(s.job.status, "QUEUED");
    assert.equal(s.job.lastError, "timeout: pass 2 over budget");
    assert.equal(s.job.runAtMs, s.clock.now() + 30_000);
    assert.equal(s.captured.length, 1);
  });

  it("maps EngineFailed to engine_failed, and an unexpected error to internal without its message", async () => {
    const a = setup(async () => {
      throw new EngineFailed("the engine failed twice on one position");
    });
    await a.go();
    assert.match(a.job.lastError ?? "", /^engine_failed: /);
    const b = setup(async () => {
      throw Object.assign(new Error("password authentication failed for user x"), { code: "28P01" });
    });
    await b.go();
    assert.equal(b.job.lastError, "internal: unexpected error (28P01)", "driver text never reaches lastError");
  });

  it("the attempts cap makes the 4th failure terminal", async () => {
    const s = setup(async () => {
      throw new JobError("engine_failed", "x");
    });
    s.job.attempts = 3;
    await s.go();
    assert.equal(s.job.status, "FAILED");
  });

  it("SIGTERM: the handler stops at its safe point and the job is released without counting the attempt", async () => {
    const s = setup(async (ctx) => {
      s.stop.abort("stop");
      throwIfAborted(ctx.signal);
      return "done";
    });
    s.job.attempts = 1;
    assert.equal(await s.go(), "released");
    assert.equal(s.job.status, "QUEUED");
    assert.equal(s.job.attempts, 1);
    assert.ok(new JobAborted() instanceof Error);
  });

  it("a job lost to the reaper writes nothing (the lock guard refused the final batch)", async () => {
    const s = setup(async (ctx) => {
      s.job.lockedBy = "someone-else";
      return done(ctx);
    });
    assert.equal(await s.go(), "lost");
    assert.equal(s.job.status, "RUNNING");
    assert.equal(s.job.lockedBy, "someone-else");
    assert.equal(s.queue.log.includes("fail"), false);
  });
});
