// The review API's analysis state (phase-03 plan §5.2, §8.12 stall rule, §7.3 healKick): status mapping, failure
// codes, the stall window, ETA and the kick-CAS pre-check.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORKER_STALL_HEARTBEAT_MS } from "@repo/contracts/http/review";
import { KICK_CAS_WINDOW_MS } from "@repo/contracts/internal/kick";
import { analysisStateOf, etaSecFor, failureCodeOf, isStalled, needsHealKick, type AnalysisStateInput } from "./state";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);

function input(overrides: Partial<AnalysisStateInput> = {}): AnalysisStateInput {
  return {
    analysisStatus: "QUEUED",
    gradedPlies: null,
    failedAtPly: null,
    jobStatus: "QUEUED",
    attempts: 0,
    maxAttempts: 4,
    runAt: ago(1_000),
    heartbeatAt: null,
    lastKickAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("analysisStateOf", () => {
  it("maps the game status, refined by the job", () => {
    const cases: [Partial<AnalysisStateInput>, string][] = [
      [{ analysisStatus: "NONE", jobStatus: null }, "none"],
      [{ analysisStatus: "NONE", jobStatus: "QUEUED" }, "queued"],
      [{ analysisStatus: "SKIPPED", jobStatus: null }, "skipped"],
      [{ analysisStatus: "QUEUED" }, "queued"],
      [{ analysisStatus: "QUEUED", jobStatus: "RUNNING", heartbeatAt: ago(5_000) }, "running"],
      [{ analysisStatus: "RUNNING", jobStatus: null }, "running"],
      [{ analysisStatus: "QUEUED", jobStatus: "DONE" }, "done"],
      [{ analysisStatus: "DONE", jobStatus: "DONE" }, "done"],
      [{ analysisStatus: "DONE", jobStatus: null }, "done"],
      [{ analysisStatus: "FAILED", jobStatus: "RUNNING", heartbeatAt: ago(1_000) }, "running"],
    ];
    for (const [over, status] of cases) assert.equal(analysisStateOf(input(over), NOW).status, status, JSON.stringify(over));
  });

  it("a failed game with a QUEUED job and attempts left is retryable at its back-off time", () => {
    const s = analysisStateOf(
      input({ analysisStatus: "FAILED", attempts: 2, runAt: new Date(NOW + 30_000), gradedPlies: 20, lastError: "engine_failed: no bestmove" }),
      NOW,
    );
    assert.deepEqual(s, {
      status: "failed",
      failure: { failedAtPly: 20, retryable: true, retryAt: new Date(NOW + 30_000).toISOString(), code: "engine_failed" },
    });
  });

  it("terminal: a FAILED job, a QUEUED job without attempts left, or a CANCELLED one", () => {
    for (const over of [
      { analysisStatus: "FAILED" as const, jobStatus: "FAILED" as const, attempts: 4 },
      { analysisStatus: "FAILED" as const, jobStatus: "QUEUED" as const, attempts: 4 },
      { analysisStatus: "QUEUED" as const, jobStatus: "CANCELLED" as const },
      { analysisStatus: "QUEUED" as const, jobStatus: "FAILED" as const },
    ]) {
      const s = analysisStateOf(input({ ...over, failedAtPly: 12, lastError: "timeout: 10 s" }), NOW);
      assert.equal(s.status, "failed");
      assert.equal(s.failure?.retryable, false);
      assert.equal(s.failure?.retryAt, null);
      assert.equal(s.failure?.failedAtPly, 12);
    }
  });

  it("the stall rule: a RUNNING job whose heartbeat is older than 90 s is failed worker_stalled, retryable", () => {
    const running = input({ analysisStatus: "QUEUED", jobStatus: "RUNNING", gradedPlies: 30 });
    assert.equal(analysisStateOf({ ...running, heartbeatAt: ago(WORKER_STALL_HEARTBEAT_MS) }, NOW).status, "running");
    const stalled = analysisStateOf({ ...running, heartbeatAt: ago(WORKER_STALL_HEARTBEAT_MS + 1) }, NOW);
    assert.deepEqual(stalled.failure, { failedAtPly: 30, retryable: true, retryAt: null, code: "worker_stalled" });
    assert.equal(isStalled({ jobStatus: "RUNNING", heartbeatAt: null }, NOW), true, "no heartbeat at all");
    assert.equal(isStalled({ jobStatus: "QUEUED", heartbeatAt: ago(10 * 60_000) }, NOW), false);
  });
});

describe("failureCodeOf", () => {
  it("reads the code before the colon; anything unknown is internal (never PII on the wire)", () => {
    assert.equal(failureCodeOf("engine_failed: crashed"), "engine_failed");
    assert.equal(failureCodeOf("worker_stalled"), "worker_stalled");
    assert.equal(failureCodeOf("timeout: 10 s"), "timeout");
    assert.equal(failureCodeOf("TypeError: x is undefined"), "internal");
    assert.equal(failureCodeOf(null), "internal");
  });
});

describe("etaSecFor", () => {
  it("grows with the queue position and the plies left; never below 1 s", () => {
    const own = etaSecFor({ position: 0, totalPlies: 60, gradedPlies: 0 });
    assert.ok(own >= 20 && own <= 30, `60 plies ≈ 25 s, got ${own}`);
    assert.ok(etaSecFor({ position: 2, totalPlies: 60, gradedPlies: 0 }) > own + 40);
    assert.ok(etaSecFor({ position: 0, totalPlies: 60, gradedPlies: 50 }) < own);
    assert.equal(etaSecFor({ position: 0, totalPlies: 0, gradedPlies: 0 }) >= 1, true);
  });
});

describe("needsHealKick (the CAS pre-check)", () => {
  const job = (o: { status?: "QUEUED" | "RUNNING"; runAgo?: number; kickAgo?: number | null }) => ({
    jobStatus: o.status ?? "QUEUED",
    runAt: ago(o.runAgo ?? KICK_CAS_WINDOW_MS + 1),
    lastKickAt: o.kickAgo == null ? null : ago(o.kickAgo),
  });
  it("only a QUEUED job due for more than 30 s and not kicked within 30 s", () => {
    assert.equal(needsHealKick(job({}), NOW), true);
    assert.equal(needsHealKick(job({ runAgo: KICK_CAS_WINDOW_MS }), NOW), false);
    assert.equal(needsHealKick(job({ kickAgo: 5_000 }), NOW), false);
    assert.equal(needsHealKick(job({ kickAgo: KICK_CAS_WINDOW_MS + 1 }), NOW), true);
    assert.equal(needsHealKick(job({ status: "RUNNING" }), NOW), false);
    assert.equal(needsHealKick({ jobStatus: null, runAt: null, lastKickAt: null }, NOW), false);
  });
});
