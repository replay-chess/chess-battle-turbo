// live.ts: the fallback schedule (per query, across renders), the 180 s stop and the A2 reconciliation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewFixture, reviewStatusFixture } from "@repo/contracts/http/fixtures/review";
import * as CT from "@repo/contracts/http/review";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import {
  fallbackExpired,
  fallbackInterval,
  isLiveStatus,
  reconcileWithStatus,
  REVIEW_FALLBACK_SCHEDULE_MS,
  REVIEW_FALLBACK_STOP_AFTER_MS,
  REVIEW_STALL_SILENCE_MS,
} from "./live";

test("the timing constants equal the contract's (they are repeated to keep zod out of the chunk)", () => {
  assert.deepEqual([...REVIEW_FALLBACK_SCHEDULE_MS], [...CT.REVIEW_FALLBACK_SCHEDULE_MS]);
  assert.equal(REVIEW_FALLBACK_STOP_AFTER_MS, CT.REVIEW_FALLBACK_STOP_AFTER_MS);
  assert.equal(REVIEW_STALL_SILENCE_MS, CT.REVIEW_STALL_SILENCE_MS);
});

const query = () => ({ state: { dataUpdatedAt: 0, errorUpdatedAt: 0 } });

test("the schedule steps 2 → 4 → 8 → 15 s per finished poll, not per call", () => {
  const q = query();
  const t0 = 1_000_000;
  assert.equal(fallbackInterval(q, true, t0), 2_000);
  assert.equal(fallbackInterval(q, true, t0 + 100), 2_000, "a re-render without a poll keeps the step");
  q.state.dataUpdatedAt = t0 + 2_000;
  assert.equal(fallbackInterval(q, true, t0 + 2_000), 4_000);
  q.state.errorUpdatedAt = t0 + 6_000; // a failed poll counts too
  assert.equal(fallbackInterval(q, true, t0 + 6_000), 8_000);
  q.state.dataUpdatedAt = t0 + 14_000;
  assert.equal(fallbackInterval(q, true, t0 + 14_000), 15_000);
  q.state.dataUpdatedAt = t0 + 29_000;
  assert.equal(fallbackInterval(q, true, t0 + 29_000), 15_000, "the last step repeats");
});

test("the poller stops 180 s after its first poll and restarts after the socket came back", () => {
  const q = query();
  const t0 = 5_000_000;
  fallbackInterval(q, true, t0);
  assert.equal(fallbackExpired(q, t0 + 179_999), false);
  assert.equal(fallbackInterval(q, true, t0 + 180_000), false);
  assert.equal(fallbackExpired(q, t0 + 180_000), true);
  assert.equal(fallbackInterval(q, false, t0 + 181_000), false, "inactive (socket live again)");
  assert.equal(fallbackExpired(q, t0 + 181_000), false);
  assert.equal(fallbackInterval(q, true, t0 + 200_000), 2_000, "a new outage starts over");
});

test("only queued and running are live", () => {
  assert.deepEqual(
    (["none", "queued", "running", "done", "failed", "skipped"] as const).map(isLiveStatus),
    [false, true, true, false, false, false],
  );
});

function status(patch: Partial<ReviewStatusDTO["analysis"]>, base = reviewStatusFixture("running")): ReviewStatusDTO {
  return { ...base, analysis: { ...base.analysis, ...patch } };
}

test("A2 reports a stalled worker: the payload shows the failure card", () => {
  const d = reviewFixture("running"); // 20 graded
  const r = reconcileWithStatus(
    d,
    status({ status: "failed", gradedPlies: 20, failedAtPly: 20, retryable: true, retryAt: null, code: "worker_stalled" }),
  );
  assert.equal(r.next.status, "failed");
  assert.deepEqual(r.next.analysis!.failure, { failedAtPly: 20, retryable: true, retryAt: null, code: "worker_stalled" });
  assert.equal(r.refetch, false);
  const again = reconcileWithStatus(r.next, status({ status: "failed", gradedPlies: 20, failedAtPly: 20, retryable: true, retryAt: null, code: "worker_stalled" }));
  assert.equal(again.next, r.next, "no change → same object");
});

test("A2 shows done or more graded plies: one A1 refetch; equal running: nothing", () => {
  const d = reviewFixture("running");
  assert.deepEqual(reconcileWithStatus(d, status({ status: "done", gradedPlies: 54 })), { next: d, refetch: true });
  assert.deepEqual(reconcileWithStatus(d, status({ status: "running", gradedPlies: 30 })), { next: d, refetch: true });
  assert.deepEqual(reconcileWithStatus(d, status({ status: "running", gradedPlies: 20 })), { next: d, refetch: false });
  const q = reviewFixture("queued");
  assert.deepEqual(reconcileWithStatus(q, status({ status: "running", gradedPlies: 0 })), { next: q, refetch: true });
});

test("A2 queued after a failure (auto-retry): back to the queued card with graded plies kept", () => {
  const f = reviewFixture("failed");
  const r = reconcileWithStatus(f, status({ status: "queued", gradedPlies: 20, etaSec: 12 }));
  assert.equal(r.next.status, "queued");
  assert.equal(r.next.analysis!.failure, null);
  assert.equal(r.next.analysis!.gradedPlies, 20);
  assert.equal(r.next.analysis!.queue!.etaSec, 12);
});

test("a finished payload is never rewritten by A2", () => {
  const d = reviewFixture("done");
  assert.deepEqual(reconcileWithStatus(d, status({ status: "failed" })), { next: d, refetch: false });
});
