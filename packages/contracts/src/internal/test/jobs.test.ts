// Phase-03 plan §6.6, §7.6, §7.7 (P3-D7, P3-D22, P3-D26): named priorities (higher first), the band rule, the
// dedupe keys, versioned payloads (an older worker releases a newer payload instead of failing it), and the kick body
// and worker responses of §7.5.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYSIS_MIN_PLIES,
  AnalyzeGamePayloadV1,
  analysisEtaSec,
  analyzeDedupeKey,
  bandOf,
  housekeepingDedupeKey,
  JOB_KINDS,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
  legendDedupeKey,
  P3_JOB_KINDS,
  PAYLOAD_V_MAX,
  PROGRESS_BAND_MIN,
  readJobPayload,
  streamsProgress,
} from "../jobs";
import {
  KICK_BODY_MAX_BYTES,
  KickBodyV1,
  KickResponse,
  WorkerHealthResponse,
  WorkerMetricsResponse,
  WorkerReadyResponse,
} from "../kick";

describe("job priorities and bands", () => {
  it("pins the P3-D7 scale (higher runs first)", () => {
    assert.deepEqual(JOB_PRIORITY, {
      USER_OPENED: 100, IMPORT_SYNC_MANUAL: 100, GAME_ENDED: 80, IMPORT_SYNC_INITIAL: 60, REVIEW_BATCH: 60,
      IMPORT_NEWEST: 50, WEAKNESS: 20, IMPORT_PURGE: 20, IMPORT_SYNC_DAILY: 15, BACKLOG: 10, HOUSEKEEPING: 0,
    });
    assert.ok(JOB_PRIORITY.USER_OPENED > JOB_PRIORITY.GAME_ENDED);
    assert.ok(JOB_PRIORITY.GAME_ENDED > JOB_PRIORITY.BACKLOG);
    assert.ok(JOB_PRIORITY.BACKLOG > JOB_PRIORITY.HOUSEKEEPING);
  });

  it("streams per-game progress from GAME_ENDED up, or for a watched game in any band", () => {
    assert.equal(PROGRESS_BAND_MIN, 80);
    assert.equal(bandOf(JOB_PRIORITY.USER_OPENED), "80+");
    assert.equal(bandOf(JOB_PRIORITY.GAME_ENDED), "80+");
    assert.equal(bandOf(79), "<80");
    assert.equal(bandOf(JOB_PRIORITY.BACKLOG), "<80");
    assert.equal(streamsProgress(JOB_PRIORITY.GAME_ENDED, false), true);
    assert.equal(streamsProgress(JOB_PRIORITY.BACKLOG, false), false);
    assert.equal(streamsProgress(JOB_PRIORITY.BACKLOG, true), true);
  });

  it("kinds: the M3 enum, of which P3 runs three, each with its attempt cap", () => {
    assert.equal(JOB_KINDS.length, 10);
    assert.equal(new Set(JOB_KINDS).size, JOB_KINDS.length);
    assert.equal((JOB_KINDS as readonly string[]).includes("HOURLY_TICK"), false, "P3-D22: no hourly tick");
    for (const kind of P3_JOB_KINDS) assert.ok((JOB_KINDS as readonly string[]).includes(kind), kind);
    assert.deepEqual(JOB_MAX_ATTEMPTS, { ANALYZE_GAME: 4, LEGEND_COMPARE: 3, HOUSEKEEPING: 2 });
    assert.equal(ANALYSIS_MIN_PLIES, 6);
  });
});

describe("dedupe keys", () => {
  it("one spelling for the web, the socket fragment, the DB helper and the worker", () => {
    assert.equal(analyzeDedupeKey(42n), "analyze:42");
    assert.equal(analyzeDedupeKey("42"), "analyze:42");
    assert.equal(legendDedupeKey(42n, 7n), "legend:42:7");
    assert.equal(housekeepingDedupeKey("2026-11-11"), "housekeeping:2026-11-11");
    assert.throws(() => housekeepingDedupeKey("2026-13-01"), /yyyy-mm-dd/);
    assert.throws(() => housekeepingDedupeKey("11/11/2026"), /yyyy-mm-dd/);
  });
});

describe("versioned payloads", () => {
  const payload = { v: 1, gameId: "9007199254740993", gameRef: "cm3k9x2p10007slzpqa8hd4fe", reason: "live_end" };

  it("reads a v1 payload of each P3 kind (bigint ids as decimal strings)", () => {
    assert.deepEqual(readJobPayload("ANALYZE_GAME", payload), { ok: true, payload });
    assert.equal(readJobPayload("LEGEND_COMPARE", { v: 1, gameId: "42", userId: "7", gameRef: "cm3k9x2p10007slzpqa8hd4fe" }).ok, true);
    assert.equal(readJobPayload("HOUSEKEEPING", { v: 1, day: "2026-11-11" }).ok, true);
  });

  it("releases a payload a newer build wrote, and fails a malformed one", () => {
    assert.deepEqual(readJobPayload("ANALYZE_GAME", { ...payload, v: PAYLOAD_V_MAX + 1, extra: "x" }), { ok: false, reason: "newer" });
    assert.deepEqual(readJobPayload("ANALYZE_GAME", { ...payload, gameId: 42 }), { ok: false, reason: "invalid" });
    assert.deepEqual(readJobPayload("ANALYZE_GAME", { ...payload, gameId: "042" }), { ok: false, reason: "invalid" });
    assert.deepEqual(readJobPayload("ANALYZE_GAME", null), { ok: false, reason: "invalid" });
    assert.deepEqual(readJobPayload("HOUSEKEEPING", { v: 1, day: "tomorrow" }), { ok: false, reason: "invalid" });
  });

  it("the reasons are the plan's", () => {
    for (const reason of ["live_end", "bot_end", "opened", "retry", "regrade", "backfill", "smoke"]) {
      assert.equal(AnalyzeGamePayloadV1.safeParse({ ...payload, reason }).success, true, reason);
    }
    assert.equal(AnalyzeGamePayloadV1.safeParse({ ...payload, reason: "stale_queue" }).success, false, "a kick reason, not a job reason");
  });
});

describe("the worker's HTTP surface (§7.5)", () => {
  it("kick bodies are strict, small and versioned", () => {
    const body = { v: 1, reason: "live_end", watch: "cm3k9x2p10007slzpqa8hd4fe", runAt: "2026-11-11T19:20:00.000Z" };
    assert.deepEqual(KickBodyV1.parse(body), body);
    assert.equal(KickBodyV1.safeParse({ v: 1, reason: "boot" }).success, true);
    assert.equal(KickBodyV1.safeParse({ ...body, room: "user:x" }).success, false, "unknown keys are a 400");
    assert.equal(KickBodyV1.safeParse({ ...body, v: 2 }).success, false);
    assert.equal(KickBodyV1.safeParse({ ...body, reason: "because" }).success, false);
    assert.equal(KickBodyV1.safeParse({ ...body, kinds: ["ANALYZE_GAME", "HOUSEKEEPING"] }).success, true);
    assert.equal(KickBodyV1.safeParse({ ...body, kinds: ["HOURLY_TICK"] }).success, false);
    assert.equal(KickBodyV1.safeParse({ ...body, kinds: [] }).success, false);
    assert.equal(KickBodyV1.safeParse({ ...body, runAt: "soon" }).success, false);
    const longest = { ...body, reason: "cron_backstop", kinds: [...JOB_KINDS], fault: "pause_at:writing:500000" };
    assert.equal(KickBodyV1.safeParse(longest).success, true);
    assert.ok(Buffer.byteLength(JSON.stringify(longest)) <= KICK_BODY_MAX_BYTES);
  });

  it("test faults follow the WORKER_FAULT grammar", () => {
    for (const fault of ["fail_at_ply:12", "stall_at_ply:20", "engine_crash:1", "hold_queue", "pause_at:writing:5000"]) {
      assert.equal(KickBodyV1.safeParse({ v: 1, reason: "test", fault }).success, true, fault);
    }
    // regression: pause-at-pass1 — the phase allowed letters only, so the worker's `pass1` pause could not be armed.
    assert.equal(KickBodyV1.safeParse({ v: 1, reason: "test", fault: "pause_at:pass1:5000" }).success, true);
    for (const fault of ["rm -rf", "fail_at_ply:", "hold_queue;x", "pause_at:writing", "pause_at:1pass:5", "pause_at:Pass1:5"]) {
      assert.equal(KickBodyV1.safeParse({ v: 1, reason: "test", fault }).success, false, fault);
    }
  });

  it("responses: kick, health, ready and the in-memory metrics", () => {
    assert.equal(KickResponse.safeParse({ draining: true, nextRunAt: null }).success, true);
    assert.equal(KickResponse.safeParse({ draining: false, nextRunAt: "2026-11-12T21:00:00.000Z" }).success, true);
    assert.equal(WorkerHealthResponse.safeParse({ ok: true }).success, true);
    assert.equal(WorkerReadyResponse.safeParse({ ready: false, engine: "starting", evalCache: "seeding", draining: false }).success, true);
    const metrics = {
      v: 1,
      workerId: "dev-worker-1a2b3c",
      bootId: "1a2b3c",
      version: "0.1.0",
      profile: "sf18-v1",
      uptimeSec: 3_600,
      draining: false,
      nextRunAt: "2026-11-12T21:00:00.000Z",
      lastDrainAt: "2026-11-11T19:20:00.000Z",
      lastHousekeepingAt: null,
      queue: { depth: { "80+": 0, "<80": 12 }, oldestSec: { "80+": 0, "<80": 340 }, queueSeenAt: "2026-11-11T19:20:00.000Z" },
      jobs: { done: { ANALYZE_GAME: 31 }, failed: { engine_failed: 1 }, durationMsP50: { ANALYZE_GAME: 18_200 } },
      engine: { nps: 610_000, restarts: 0 },
      cache: { hitsMemory: 120, hitsDisk: 410, misses: 1_310 },
      db: { statements: 280, retries: 1 },
      lagPauseMs: 0,
      emits: { "analysis:progress": 412, "analysis:done": 62 },
    };
    assert.equal(WorkerMetricsResponse.safeParse(metrics).success, true);
    assert.equal(WorkerMetricsResponse.safeParse({ ...metrics, queue: { ...metrics.queue, depth: { "80+": 0 } } }).success, false, "both bands");
    assert.equal(WorkerMetricsResponse.safeParse({ ...metrics, jobs: { ...metrics.jobs, done: { NOPE: 1 } } }).success, false);
    assert.equal(WorkerMetricsResponse.safeParse({ ...metrics, emits: { "not an event": 1 } }).success, false);
  });
});

describe("analysisEtaSec (the one ETA model of the finish seed and A2)", () => {
  it("remaining plies × 0.35 s + 5 s pass 2 + 25 s per job ahead, rounded up, at least 1", () => {
    assert.equal(analysisEtaSec({ ahead: 0, remainingPlies: 40 }), 19);
    assert.equal(analysisEtaSec({ ahead: 2, remainingPlies: 40 }), 69);
    assert.equal(analysisEtaSec({ ahead: 0, remainingPlies: 0 }), 5);
    assert.equal(analysisEtaSec({ ahead: -3, remainingPlies: -1 }), 5);
  });
});
