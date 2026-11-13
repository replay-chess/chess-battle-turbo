// The scheduler (phase-03 plan §8.12, §12.1 `scheduler.test`, AP-08 gate): boot batch, drain, sleep until
// min(nextRunAt), kicks (interrupt, shorter runAt, during a drain), watch, faults, stop, a database outage, the
// reaper only at boot and drain end — and the TIMER AUDIT: a fake clock and a round-trip counter over 24 simulated
// idle hours → ≤ 5 database round trips, all of them the one HOUSEKEEPING wake.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import type { KickBodyV1 } from "@repo/contracts/internal/kick";
import type { AppEnvName } from "../config/env";
import type { Fault } from "../config/faults";
import { CountingDb, type Statement } from "../db/client";
import { housekeepingHandler } from "../jobs/housekeeping";
import { runJob, type HandlerMap } from "../jobs/runner";
import { throwIfAborted, type JobHandler } from "../jobs/types";
import { silentLogger, type Logger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { noopTelemetry } from "../obs/telemetry";
import { doneStatement, lockGuardStatement, ORPHAN_STALE_SEC } from "../queue/outcome";
import { RecordingEmitter } from "../socket/emit";
import { FakeQueue } from "../testing/fake-queue";
import { FakeClock } from "./clock";
import { collectPlan, planWindow } from "./daily-plan";
import { RECURRING_SLICES } from "./recurring";
import { MAX_SLEEP_MS, Scheduler } from "./scheduler";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 11, 10, 0, 0); // 10:00 UTC
const REF = "cgamereference0000000001";
const kick = (b: Partial<KickBodyV1> = {}): KickBodyV1 => ({ v: 1, reason: "test", ...b });

function analysis(queue: FakeQueue, at: number, extra: { priority?: number } = {}) {
  return queue.add({
    kind: "ANALYZE_GAME",
    runAtMs: at,
    priority: extra.priority ?? JOB_PRIORITY.GAME_ENDED,
    payload: { v: 1, gameId: "1", gameRef: REF, reason: "live_end" },
  });
}

function setup(
  opts: {
    appEnv?: AppEnvName;
    envFault?: Fault | null;
    bootPlan?: boolean;
    onRun?: (id: string) => Promise<void> | void;
    log?: Logger;
  } = {},
) {
  const clock = new FakeClock(T0);
  const queue = new FakeQueue(() => clock.now());
  const db = new CountingDb(queue);
  const metrics = new Metrics(
    { workerId: "test-worker-00000001", bootId: "00000001", version: "0", profile: "sf18-v1" },
    T0,
  );
  const emitter = new RecordingEmitter();
  const ran: { id: string; at: number }[] = [];
  const me = "test-worker-00000001";
  const analyze: JobHandler<"ANALYZE_GAME"> = {
    kind: "ANALYZE_GAME",
    async run(ctx) {
      ran.push({ id: ctx.job.id, at: clock.now() });
      await opts.onRun?.(ctx.job.id);
      throwIfAborted(ctx.signal);
      await ctx.db.batch([lockGuardStatement(ctx.job.id, me), doneStatement(ctx.job.id, me)]);
      return "done";
    },
  };
  const handlers: HandlerMap = { ANALYZE_GAME: analyze, HOUSEKEEPING: housekeepingHandler() };
  const scheduler: Scheduler = new Scheduler({
    db,
    clock,
    log: opts.log ?? silentLogger,
    metrics,
    emitter,
    appEnv: opts.appEnv ?? "test",
    me,
    workerId: "test-worker",
    kinds: ["ANALYZE_GAME", "HOUSEKEEPING"],
    payloadVMax: 1,
    envFault: opts.envFault ?? null,
    bootPlan: (): Statement[] =>
      opts.bootPlan === false ? [] : collectPlan(RECURRING_SLICES, planWindow(clock.now())).statements,
    runJob: (job, stopSignal) =>
      runJob(job, {
        db,
        clock,
        log: silentLogger,
        metrics,
        telemetry: noopTelemetry,
        emitter,
        me,
        appEnv: opts.appEnv ?? "test",
        handlers,
        engine: null,
        evalCache: null,
        evalCacheMaxBytes: 0,
        lag: null,
        stopSignal,
        isWatched: (r) => scheduler.isWatched(r),
        takeFault: (r) => scheduler.takeFault(r),
      }),
  });
  return { clock, queue, db, scheduler, ran, metrics };
}

async function boot(s: ReturnType<typeof setup>) {
  await s.scheduler.start();
  await s.clock.advance(0);
}

describe("scheduler: another boot of this WORKER_ID (FIX-2)", () => {
  // regression: shared-worker-id (FIX-2, review round 2). A row of another boot that is still beating is not reaped at
  // boot; the scheduler wakes once when it can be stale (a crashed boot is then reaped, owner test T11), and a row
  // still beating then is a live worker sharing the id: logged, never reaped.
  it("wakes once at the earlier boot's last heartbeat + ORPHAN_STALE_SEC, then reports a live sibling", async () => {
    const errors: string[] = [];
    const s = setup({ bootPlan: false, log: { ...silentLogger, error: (msg) => void errors.push(msg) } });
    s.queue.siblings = { n: 1, lastBeatMs: T0 - 10_000 };
    await boot(s);
    assert.deepEqual(s.queue.log, ["reap", "siblings", "claim", "reap", "summary"]);
    s.queue.log.length = 0;
    const checkAt = T0 - 10_000 + ORPHAN_STALE_SEC * 1000 + 1_000;
    assert.equal(s.clock.nextDue, checkAt, "the one wake is the re-check, not the 24 h cap");
    await s.clock.advance(checkAt - T0);
    assert.deepEqual(s.queue.log, ["claim", "reap", "summary", "siblings"]);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /another live worker shares WORKER_ID test-worker/);
    s.queue.log.length = 0;
    await s.clock.advance(60 * 60 * 1000);
    assert.deepEqual(s.queue.log, [], "no further re-checks: an idle worker issues no queries");
  });
});

describe("scheduler: boot and sleep", () => {
  it("boots with one batch (reap + DAILY_PLAN), drains once, then sleeps until the planned HOUSEKEEPING", async () => {
    const s = setup();
    await boot(s);
    assert.deepEqual(s.queue.log, ["reap", "siblings", "insert", "claim", "reap", "summary"]);
    assert.equal(s.db.counters.roundTrips, 3, "boot batch + claim + drain-end batch");
    const hk = s.queue.byKind("HOUSEKEEPING").map((j) => [j.dedupeKey, new Date(j.runAtMs).toISOString()]);
    // 10:00 → 12:00 tomorrow holds one 21:00.
    assert.deepEqual(hk, [["housekeeping:2026-11-11", "2026-11-11T21:00:00.000Z"]]);
    assert.equal(s.clock.pending, 1, "exactly one timer: the sleep");
    assert.equal(s.clock.nextDue, Date.UTC(2026, 10, 11, 21));
    assert.equal(s.scheduler.view().nextRunAtMs, Date.UTC(2026, 10, 11, 21));
  });

  it("TIMER AUDIT: 24 idle hours cost ≤ 5 round trips, all of them the one HOUSEKEEPING wake", async () => {
    const s = setup();
    await boot(s);
    const before = s.db.counters.roundTrips;
    s.queue.log.length = 0;
    await s.clock.advance(24 * HOUR);
    const trips = s.db.counters.roundTrips - before;
    assert.ok(trips <= 5, `${trips} round trips in 24 h`);
    assert.deepEqual(s.queue.log, [
      "claim",
      "guard",
      "insert",
      "insert",
      "prune-jobs",
      "prune-shares",
      "prune-buckets",
      "prune-windows",
      "outdated",
      "import-backstop",
      "import-release",
      "done",
      "claim",
      "reap",
      "summary",
    ]);
    assert.equal(trips, 4, "claim · housekeeping batch · claim · drain-end batch");
    const [today, tomorrow, ...more] = s.queue.byKind("HOUSEKEEPING");
    assert.equal(today?.status, "DONE");
    assert.equal(tomorrow?.dedupeKey, "housekeeping:2026-11-12", "DAILY_PLAN planned tomorrow's run");
    assert.equal(tomorrow?.status, "QUEUED");
    assert.deepEqual(more, [], "today's own row was planned again without a duplicate");
    assert.equal(s.metrics.lastHousekeepingAtMs, Date.UTC(2026, 10, 11, 21));
    assert.equal(s.clock.pending, 1, "no interval, no stray heartbeat: only the next sleep");
    assert.equal(s.clock.nextDue, Date.UTC(2026, 10, 12, 21));
  });

  it("with nothing planned it sleeps the 24 h cap: one wake, two round trips", async () => {
    const s = setup({ bootPlan: false });
    await boot(s);
    assert.equal(s.clock.nextDue, T0 + MAX_SLEEP_MS);
    const before = s.db.counters.roundTrips;
    await s.clock.advance(24 * HOUR - 1);
    assert.equal(s.db.counters.roundTrips, before, "silent until the cap");
    await s.clock.advance(1);
    assert.equal(s.db.counters.roundTrips - before, 2);
  });

  it("sleeps until min(nextRunAt): a job due in 5 minutes runs at 5 minutes, not before", async () => {
    const s = setup({ bootPlan: false });
    analysis(s.queue, T0 + 5 * 60_000);
    await boot(s);
    await s.clock.advance(5 * 60_000 - 1);
    assert.equal(s.ran.length, 0);
    await s.clock.advance(1);
    assert.deepEqual(
      s.ran.map((r) => r.at),
      [T0 + 5 * 60_000],
    );
  });

  it("the reaper runs only in the boot batch and in each drain-end batch", async () => {
    const s = setup({ bootPlan: false });
    await boot(s);
    analysis(s.queue, s.clock.now());
    s.scheduler.kick(kick());
    await s.clock.advance(0);
    const reaps = s.queue.log.filter((l) => l === "reap").length;
    const summaries = s.queue.log.filter((l) => l === "summary").length;
    assert.equal(reaps, 1 + summaries, "boot + one per drain end");
    assert.equal(summaries, 2);
  });
});

describe("scheduler: kicks", () => {
  it("a kick interrupts the sleep and drains at once", async () => {
    const s = setup();
    await boot(s);
    const job = analysis(s.queue, s.clock.now());
    const res = s.scheduler.kick(kick({ reason: "live_end", watch: REF }));
    assert.equal(res.draining, true);
    await s.clock.advance(0);
    assert.deepEqual(
      s.ran.map((r) => r.id),
      [job.id],
    );
    assert.equal(job.status, "DONE");
  });

  it("regression: D1 (import-analysis-wake): wake() from another lane drains at once, like a kick without a body", async () => {
    const s = setup();
    await boot(s);
    // An import of the I/O lane wrote this job while the engine lane slept its long sleep (no poll, no HTTP kick).
    const job = analysis(s.queue, s.clock.now());
    s.scheduler.wake();
    await s.clock.advance(0);
    assert.deepEqual(
      s.ran.map((r) => r.id),
      [job.id],
    );
    assert.equal(job.status, "DONE");
  });

  it("a kick with a future runAt only shortens the sleep (no query until then)", async () => {
    const s = setup();
    await boot(s);
    const at = s.clock.now() + 2 * 60_000;
    analysis(s.queue, at);
    const trips = s.db.counters.roundTrips;
    const res = s.scheduler.kick(kick({ runAt: new Date(at).toISOString() }));
    assert.deepEqual(res, { draining: false, nextRunAt: new Date(at).toISOString() });
    await s.clock.advance(2 * 60_000 - 1);
    assert.equal(s.db.counters.roundTrips, trips);
    await s.clock.advance(1);
    assert.deepEqual(
      s.ran.map((r) => r.at),
      [at],
    );
  });

  it("a kick that lands after the drain-end query makes the drain look once more", async () => {
    const s = setup();
    await boot(s);
    const first = analysis(s.queue, s.clock.now());
    let late: string | null = null;
    // The web commits a new job and kicks right after this drain's summary query.
    s.queue.after.set("summary", () => {
      late = analysis(s.queue, s.clock.now()).id;
      s.scheduler.kick(kick({ reason: "opened" }));
    });
    s.scheduler.kick(kick());
    await s.clock.advance(0);
    assert.deepEqual(
      s.ran.map((r) => r.id),
      [first.id, late],
    );
  });

  it("watch marks a game for 10 minutes", async () => {
    const s = setup();
    await boot(s);
    s.scheduler.kick(kick({ watch: REF }));
    assert.equal(s.scheduler.isWatched(REF), true);
    await s.clock.advance(10 * 60_000 + 1);
    assert.equal(s.scheduler.isWatched(REF), false);
  });

  it("a kick fault is honoured once for its watch game with APP_ENV=test, and ignored in dev", async () => {
    const t = setup({ appEnv: "test" });
    await boot(t);
    t.scheduler.kick(kick({ watch: REF, fault: "fail_at_ply:12" }));
    assert.deepEqual(t.scheduler.takeFault(REF), { kind: "fail_at_ply", ply: 12 });
    assert.equal(t.scheduler.takeFault(REF), null, "one-shot");
    const d = setup({ appEnv: "dev" });
    await boot(d);
    d.scheduler.kick(kick({ watch: REF, fault: "fail_at_ply:12" }));
    assert.equal(d.scheduler.takeFault(REF), null);
  });

  it("the env fault applies to every game (dev/test hook)", async () => {
    const s = setup({ appEnv: "dev", envFault: { kind: "stall_at_ply", ply: 20 } });
    assert.deepEqual(s.scheduler.takeFault(REF), { kind: "stall_at_ply", ply: 20 });
    assert.deepEqual(s.scheduler.takeFault(REF), { kind: "stall_at_ply", ply: 20 });
  });

  it("regression: hold-queue-release: a product kick (bot_end, opened) does not release hold_queue; a test kick does", async () => {
    const s = setup();
    await boot(s);
    s.scheduler.kick(kick({ fault: "hold_queue" }));
    await s.clock.advance(0);
    analysis(s.queue, s.clock.now());
    s.scheduler.kick(kick({ reason: "bot_end", watch: REF }));
    s.scheduler.kick(kick({ reason: "opened", watch: REF }));
    await s.clock.advance(60_000);
    assert.deepEqual(s.ran, [], "still held after the web's own kicks");
    s.scheduler.kick(kick({ reason: "test" }));
    await s.clock.advance(0);
    assert.equal(s.ran.length, 1);
  });

  it("hold_queue (test kick) holds every claim until a kick without it", async () => {
    const s = setup();
    await boot(s);
    s.scheduler.kick(kick({ fault: "hold_queue" }));
    await s.clock.advance(0);
    analysis(s.queue, s.clock.now());
    s.scheduler.kick(kick({ fault: "hold_queue" }));
    await s.clock.advance(60_000);
    assert.deepEqual(s.ran, [], "held");
    s.scheduler.kick(kick());
    await s.clock.advance(0);
    assert.equal(s.ran.length, 1);
  });

  it("WORKER_FAULT=hold_queue never claims and does not spin on the due job", async () => {
    const s = setup({ appEnv: "dev", envFault: { kind: "hold_queue" }, bootPlan: false });
    analysis(s.queue, T0);
    await boot(s);
    const trips = s.db.counters.roundTrips;
    await s.clock.advance(HOUR);
    assert.deepEqual(s.ran, []);
    assert.equal(s.db.counters.roundTrips, trips, "asleep, not polling");
    assert.equal(s.queue.log.includes("claim"), false);
  });
});

describe("scheduler: failures and stop", () => {
  it("a database outage during a drain is retried after 30 s, without a hot loop", async () => {
    const s = setup({ bootPlan: false });
    await boot(s);
    analysis(s.queue, s.clock.now());
    // Two failing round trips (a non-retryable error, so the client does not retry): the claim now and at +30 s.
    s.queue.failNext = 2;
    s.scheduler.kick(kick());
    await s.clock.advance(0);
    assert.deepEqual(s.ran, []);
    const trips = s.db.counters.roundTrips;
    await s.clock.advance(29_999);
    assert.equal(s.db.counters.roundTrips, trips, "no retry before 30 s");
    await s.clock.advance(1);
    assert.equal(s.queue.failNext, 0);
    await s.clock.advance(30_000);
    assert.equal(s.ran.length, 1, "recovered");
  });

  it("stop() while a job runs: the job sees the abort at its safe point and is released (attempt not counted)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({ bootPlan: false, onRun: () => gate });
    const job = analysis(s.queue, T0);
    await s.scheduler.start();
    await s.clock.advance(0);
    assert.equal(job.status, "RUNNING");
    const stopping = s.scheduler.stop(25_000);
    release();
    await s.clock.advance(0);
    await stopping;
    assert.equal(job.status, "QUEUED");
    assert.equal(job.attempts, 0);
    assert.equal(s.scheduler.kick(kick()).draining, false, "no drains after stop");
  });

  it("stop() while sleeping returns at once and leaves no timer behind (nothing keeps the process alive)", async () => {
    const s = setup();
    await boot(s);
    await s.scheduler.stop(25_000);
    assert.equal(s.scheduler.stopSignal.aborted, true);
    assert.equal(s.clock.pending, 0, "neither the sleep nor the grace timer");
  });
});
