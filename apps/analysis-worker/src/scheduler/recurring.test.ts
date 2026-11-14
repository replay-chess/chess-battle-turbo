// The recurring slices and DAILY_PLAN (phase-03 plan §7.7, P3-D22, §12.1 `recurring.test`): the 21:00 UTC planner,
// DAILY_PLAN inserting the next HOUSEKEEPING row once (dedupe), a fake slice's plan() rows inserted, a slice error
// (run or plan) not stopping the others, the job failing (retryable) only after tomorrow's row is written, the 60 s
// slice timeout, and the cron check-ins.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { CountingDb, stmt } from "../db/client";
import { housekeepingHandler } from "../jobs/housekeeping";
import { runJob } from "../jobs/runner";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { noopTelemetry, type CronStatus, type Telemetry } from "../obs/telemetry";
import { claimJob } from "../queue/claim";
import { RecordingEmitter } from "../socket/emit";
import { FakeQueue } from "../testing/fake-queue";
import { FakeClock } from "./clock";
import { collectPlan, planWindow, PLAN_WINDOW_MS } from "./daily-plan";
import {
  HOUSEKEEPING_HOUR_UTC,
  housekeepingPlan,
  housekeepingRow,
  housekeepingTimes,
} from "./recurring/housekeeping-plan";
import type { RecurringSlice } from "./recurring/types";
import { RECURRING_SLICES } from "./recurring";
import { evalcacheTrim } from "./recurring/evalcache-trim";
import { pruneSharesStatement } from "./recurring/prune-shares";

const at = (d: string) => new Date(d).getTime();

describe("housekeeping planner", () => {
  it("plans every 21:00 UTC inside the window", () => {
    const times = (from: string, to: string) =>
      housekeepingTimes({ from: new Date(from), to: new Date(to) }).map((d) => d.toISOString());
    assert.deepEqual(times("2026-11-11T10:00:00Z", "2026-11-12T12:00:00Z"), ["2026-11-11T21:00:00.000Z"]);
    assert.deepEqual(times("2026-11-11T21:00:00Z", "2026-11-12T23:00:00Z"), [
      "2026-11-11T21:00:00.000Z",
      "2026-11-12T21:00:00.000Z",
    ]);
    assert.deepEqual(times("2026-11-11T21:00:01Z", "2026-11-12T23:00:01Z"), ["2026-11-12T21:00:00.000Z"]);
    assert.deepEqual(times("2026-12-31T22:00:00Z", "2027-01-02T00:00:00Z"), ["2027-01-01T21:00:00.000Z"]);
  });

  it("every 26 h window from any start holds at least one run (the 24 h sleep cap always ends on a planned wake)", () => {
    for (let h = 0; h < 48; h += 0.25) {
      const from = at("2026-11-11T00:00:00Z") + h * 3_600_000;
      const w = planWindow(from);
      assert.equal(w.to.getTime() - w.from.getTime(), PLAN_WINDOW_MS);
      assert.ok(housekeepingTimes(w).length >= 1, `window from ${new Date(from).toISOString()}`);
    }
  });

  it("builds the HOUSEKEEPING row: priority HOUSEKEEPING, 2 attempts, payload {v, day}, dedupe per day", () => {
    const row = housekeepingRow(new Date(Date.UTC(2026, 10, 11, HOUSEKEEPING_HOUR_UTC)));
    assert.deepEqual(row, {
      kind: "HOUSEKEEPING",
      priority: JOB_PRIORITY.HOUSEKEEPING,
      payload: { v: 1, day: "2026-11-11" },
      dedupeKey: "housekeeping:2026-11-11",
      runAt: new Date("2026-11-11T21:00:00Z"),
      maxAttempts: 2,
    });
  });

  it("collectPlan isolates a failing slice and a row without a dedupe key; the others are planned", () => {
    const broken: RecurringSlice = {
      id: "broken",
      plan: () => {
        throw new Error("boom");
      },
    };
    const keyless: RecurringSlice = {
      id: "keyless",
      plan: () => [{ ...housekeepingRow(new Date("2026-11-11T21:00:00Z")), dedupeKey: "" }],
    };
    const invalid: RecurringSlice = {
      id: "invalid",
      // a priority that is not a JOB_PRIORITY value is refused by @repo/db's builder
      plan: () => [{ ...housekeepingRow(new Date("2026-11-11T21:00:00Z")), dedupeKey: "x:1", priority: 7 as never }],
    };
    const plan = collectPlan([broken, keyless, invalid, housekeepingPlan], planWindow(at("2026-11-11T10:00:00Z")));
    assert.deepEqual(
      plan.errors.map((e) => e.slice),
      ["broken", "keyless", "invalid"],
    );
    assert.deepEqual(
      plan.rows.map((r) => r.dedupeKey),
      ["housekeeping:2026-11-11"],
    );
    assert.equal(plan.statements.length, 1);
    assert.match(plan.statements[0]!.text, /ON CONFLICT \("dedupeKey"\) DO NOTHING/);
  });
});

describe("HOUSEKEEPING job", () => {
  function harness(slices: RecurringSlice[], sliceTimeoutMs?: number) {
    const clock = new FakeClock(at("2026-11-11T21:00:00Z"));
    const queue = new FakeQueue(() => clock.now());
    const db = new CountingDb(queue);
    const metrics = new Metrics({ workerId: "w", bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now());
    const checkIns: CronStatus[] = [];
    const telemetry: Telemetry = {
      ...noopTelemetry,
      cronCheckIn: (_m, status) => {
        checkIns.push(status);
        return "check-in-1";
      },
    };
    const me = "w-00000001";
    queue.add({
      kind: "HOUSEKEEPING",
      priority: 0,
      payload: { v: 1, day: "2026-11-11" },
      dedupeKey: "housekeeping:2026-11-11",
      maxAttempts: 2,
    });
    const go = async () => {
      const job = await claimJob(db, me, ["HOUSEKEEPING"], 1);
      assert.ok(job);
      const result = runJob(job, {
        db,
        clock,
        log: silentLogger,
        metrics,
        telemetry,
        emitter: new RecordingEmitter(),
        me,
        appEnv: "test",
        handlers: { HOUSEKEEPING: housekeepingHandler(slices, sliceTimeoutMs) },
        engine: null,
        evalCache: null,
        evalCacheMaxBytes: 0,
        lag: null,
        stopSignal: new AbortController().signal,
        isWatched: () => false,
        takeFault: () => null,
      });
      await clock.advance(sliceTimeoutMs ?? 0);
      return result;
    };
    return { clock, queue, metrics, checkIns, go };
  }

  it("runs every slice in order, inserts tomorrow's row once, and finishes DONE with check-ins", async () => {
    const order: string[] = [];
    const extra: RecurringSlice = {
      id: "fake-weekly",
      run: async () => void order.push("fake-weekly"),
      plan: () => [{ ...housekeepingRow(new Date("2026-11-12T03:00:00Z")), dedupeKey: "fake:2026-11-12" }],
    };
    const first: RecurringSlice = { id: "first", run: async () => void order.push("first") };
    const h = harness([first, extra, housekeepingPlan]);
    assert.equal(await h.go(), "done");
    assert.deepEqual(order, ["first", "fake-weekly"]);
    assert.deepEqual(
      h.queue.jobs.map((j) => [j.dedupeKey, j.status]),
      [
        ["housekeeping:2026-11-11", "DONE"],
        ["fake:2026-11-12", "QUEUED"],
        ["housekeeping:2026-11-12", "QUEUED"],
      ],
    );
    assert.deepEqual(h.checkIns, ["in_progress", "ok"]);
    assert.equal(h.metrics.lastHousekeepingAtMs, at("2026-11-11T21:00:00Z"));
  });

  it("a failing slice does not stop the others; tomorrow is still planned; the job fails retryable", async () => {
    const order: string[] = [];
    const h = harness([
      { id: "a", run: async () => void order.push("a") },
      {
        id: "bad",
        run: async () => {
          throw new Error("prune failed");
        },
      },
      { id: "c", run: async () => void order.push("c") },
      housekeepingPlan,
    ]);
    assert.equal(await h.go(), "failed");
    assert.deepEqual(order, ["a", "c"]);
    const [today, tomorrow] = h.queue.jobs;
    assert.equal(today?.status, "QUEUED", "attempt 1 of 2: retried after the back-off");
    assert.match(today?.lastError ?? "", /^internal: housekeeping slices failed: bad/);
    assert.equal(tomorrow?.dedupeKey, "housekeeping:2026-11-12");
    assert.deepEqual(h.checkIns, ["in_progress", "error"]);
    assert.equal(h.metrics.lastHousekeepingAtMs, null);
  });

  it("a slice that runs past 60 s is recorded as failed and the rest continue", async () => {
    const order: string[] = [];
    const h = harness(
      [
        { id: "slow", run: () => new Promise<void>(() => undefined) },
        { id: "next", run: async () => void order.push("next") },
        housekeepingPlan,
      ],
      60_000,
    );
    assert.equal(await h.go(), "failed");
    assert.deepEqual(order, ["next"]);
    assert.match(h.queue.jobs[0]?.lastError ?? "", /slow/);
  });

  it("the P3 slices ride in ONE batch with the plan and DONE; after() reads its own rows", async () => {
    const h = harness([...RECURRING_SLICES]);
    const day = 86_400_000;
    const now = at("2026-11-11T21:00:00Z");
    const old = h.queue.add({
      kind: "ANALYZE_GAME",
      status: "DONE",
      dedupeKey: "analyze:1",
      finishedAtMs: now - 15 * day,
    });
    const recent = h.queue.add({
      kind: "ANALYZE_GAME",
      status: "DONE",
      dedupeKey: "analyze:2",
      finishedAtMs: now - 13 * day,
    });
    const failedOld = h.queue.add({
      kind: "ANALYZE_GAME",
      status: "FAILED",
      dedupeKey: "analyze:3",
      finishedAtMs: now - 31 * day,
    });
    const failedRecent = h.queue.add({
      kind: "ANALYZE_GAME",
      status: "FAILED",
      dedupeKey: "analyze:4",
      finishedAtMs: now - 20 * day,
    });
    h.queue.log.length = 0;
    assert.equal(await h.go(), "done");
    assert.deepEqual(h.queue.log, [
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
      "training-abandon",
      "training-plans",
      "training-prune",
      "done",
    ]);
    const ids = h.queue.jobs.map((j) => j.id);
    assert.ok(!ids.includes(old.id) && !ids.includes(failedOld.id), "DONE > 14 d and FAILED > 30 d pruned");
    assert.ok(ids.includes(recent.id) && ids.includes(failedRecent.id), "younger rows kept");
    assert.deepEqual(h.checkIns, ["in_progress", "ok"]);
  });

  it("when the batch fails as a whole, the plan is written alone and the job fails (tomorrow is never lost)", async () => {
    const breaking: RecurringSlice = { id: "breaking", statements: () => [stmt("SELECT broken_statement()")] };
    const h = harness([breaking, housekeepingPlan]);
    assert.equal(await h.go(), "failed");
    const [today, tomorrow] = h.queue.jobs;
    assert.equal(today?.status, "QUEUED");
    assert.match(today?.lastError ?? "", /housekeeping slices failed: batch/);
    assert.equal(tomorrow?.dedupeKey, "housekeeping:2026-11-12");
    assert.deepEqual(h.checkIns, ["in_progress", "error"]);
  });

  it("a failing follow-up (after) is reported but the committed day stays DONE", async () => {
    const h = harness([
      {
        id: "noisy",
        statements: () => [pruneSharesStatement()],
        after: async () => Promise.reject(new Error("follow-up failed")),
      },
      housekeepingPlan,
    ]);
    assert.equal(await h.go(), "done");
    assert.equal(h.queue.jobs[0]?.status, "DONE");
  });

  it("evalcache-trim runs on Sundays only", async () => {
    const trims: number[] = [];
    const ctx = (iso: string) =>
      ({
        now: new Date(iso),
        evalCache: { trimTo: (b: number) => (trims.push(b), { deleted: 0, sizeBytes: 0 }) },
        evalCacheMaxBytes: 7,
        log: silentLogger,
      }) as unknown as Parameters<NonNullable<typeof evalcacheTrim.run>>[0];
    await evalcacheTrim.run!(ctx("2026-11-11T21:00:00Z"));
    assert.deepEqual(trims, [], "a Wednesday");
    await evalcacheTrim.run!(ctx("2026-11-15T21:00:00Z"));
    assert.deepEqual(trims, [7], "a Sunday");
  });
});
