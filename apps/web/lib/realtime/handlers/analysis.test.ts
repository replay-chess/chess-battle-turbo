// handlers/analysis.ts: the cache updaters for the analysis events (plan §5.2 delta merge, §5.11), with the CT
// fixtures (the design's GAME replayed) and the socket fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { GAME, reviewFixture, reviewStatusFixture } from "@repo/contracts/http/fixtures/review";
import type { AnalysisFailedEvent, AnalysisProgressEvent } from "@repo/contracts/socket/analysis";
import { ReviewDTO } from "@repo/contracts/http/review";
import { qk } from "@/lib/api/keys";
import {
  applyAnalysisEvent,
  reviewOnFailed,
  reviewOnProgress,
  reviewOnQueued,
  skeletonAnalysis,
  statusOnEvent,
} from "./analysis";

const REF = reviewFixture("running").ref;

function frame(from: number, to: number): AnalysisProgressEvent {
  return {
    v: 1,
    gameRef: REF,
    from,
    gradedPlies: to,
    totalPlies: GAME.plies,
    evals: GAME.evals.slice(from, to + 1),
    best: GAME.best.split(" ").slice(from, to).join(" "),
    j: GAME.j.slice(from, to),
    depthP50: 18,
  };
}

const failedEvent = (graded: number, retryable = true): AnalysisFailedEvent => ({
  v: 1,
  gameRef: REF,
  gradedPlies: graded,
  totalPlies: GAME.plies,
  failedAtPly: graded,
  retryable,
  retryAt: retryable ? "2026-11-09T18:45:10.000Z" : null,
  code: "engine_failed",
});

test("progress frames splice in order, stale ones are dropped, a gap asks for A1", () => {
  const running = reviewFixture("running"); // 20 graded
  const a = reviewOnProgress(running, frame(20, 24));
  assert.equal(a.refetch, false);
  assert.equal(a.next.analysis!.gradedPlies, 24);
  assert.equal(a.next.analysis!.j, GAME.j.slice(0, 24));
  assert.deepEqual(a.next.analysis!.evals, GAME.evals.slice(0, 25));
  assert.equal(a.next.analysis!.best, GAME.best.split(" ").slice(0, 24).join(" "));
  assert.ok(ReviewDTO.safeParse(a.next).success, "the merged payload still parses");
  const stale = reviewOnProgress(a.next, frame(18, 22));
  assert.equal(stale.next, a.next, "same object for a stale frame");
  const gap = reviewOnProgress(running, frame(30, 34));
  assert.deepEqual([gap.next === running, gap.refetch], [true, true]);
});

test("progress on a queued skeleton runs; on done it is ignored; with no analysis it refetches", () => {
  const queued = reviewFixture("queued");
  const r = reviewOnProgress(queued, frame(0, 2));
  assert.equal(r.next.status, "running");
  assert.equal(r.next.analysis!.queue, null);
  assert.equal(r.next.analysis!.gradedPlies, 2);
  const done = reviewFixture("done");
  assert.deepEqual(reviewOnProgress(done, frame(0, 2)), { next: done, refetch: false });
  const none = reviewFixture("none");
  assert.deepEqual(reviewOnProgress(none, frame(0, 2)), { next: none, refetch: true });
});

test("a progress frame after a failure clears the failure (an automatic retry resumed)", () => {
  const failed = reviewFixture("failed");
  const r = reviewOnProgress(failed, frame(20, 22));
  assert.equal(r.next.status, "running");
  assert.equal(r.next.analysis!.failure, null);
});

test("queued: a skeleton for an unanalysed game, the queue info otherwise; done ignores it (regrade)", () => {
  const none = reviewFixture("none");
  const q = reviewOnQueued(none, { position: 3, etaSec: 25 });
  assert.equal(q.next.status, "queued");
  assert.deepEqual(q.next.analysis, skeletonAnalysis(GAME.plies, { position: 3, etaSec: 25 }));
  assert.ok(ReviewDTO.safeParse(q.next).success, "the skeleton parses as a ReviewDTO");
  const failed = reviewFixture("failed");
  const f = reviewOnQueued(failed, { position: 0, etaSec: 5 });
  assert.equal(f.next.analysis!.failure, null);
  assert.equal(f.next.analysis!.gradedPlies, 20, "graded plies are kept (resume)");
  const done = reviewFixture("done");
  assert.equal(reviewOnQueued(done, { position: 0, etaSec: 1 }).next, done);
});

test("failed keeps the graded plies and refetches only when the worker graded more than the cache holds", () => {
  const running = reviewFixture("running");
  const same = reviewOnFailed(running, failedEvent(20));
  assert.equal(same.next.status, "failed");
  assert.deepEqual(same.next.analysis!.failure, { failedAtPly: 20, retryable: true, retryAt: "2026-11-09T18:45:10.000Z", code: "engine_failed" });
  assert.equal(same.refetch, false);
  assert.equal(reviewOnFailed(running, failedEvent(26)).refetch, true);
  assert.equal(reviewOnFailed(reviewFixture("done"), failedEvent(20)).next.status, "done");
});

test("the status DTO follows the same events (poller and game-over card agree)", () => {
  const s = reviewStatusFixture("running");
  const p = statusOnEvent(s, "analysis:progress", frame(s.analysis.gradedPlies, s.analysis.gradedPlies + 2));
  assert.equal(p.analysis.gradedPlies, s.analysis.gradedPlies + 2);
  assert.equal(statusOnEvent(p, "analysis:progress", frame(0, 2)), p, "stale");
  const f = statusOnEvent(p, "analysis:failed", failedEvent(p.analysis.gradedPlies, false));
  assert.deepEqual([f.analysis.status, f.analysis.retryable, f.analysis.code], ["failed", false, "engine_failed"]);
  const d = statusOnEvent(s, "analysis:done", {
    v: 1,
    gameRef: REF,
    analysisVersion: 1,
    accuracy: 85,
    momentsCount: 3,
    headline: "Missed Rxf5 · move 19",
    coachLine: "The game turned on move 19, when Qd2 missed Rxf5.",
    isClean: false,
    bank: null,
  });
  assert.deepEqual(d.review, { ready: true, accuracy: 85, momentsCount: 3, isClean: false, coachLine: "The game turned on move 19, when Qd2 missed Rxf5." });
  assert.equal(d.analysis.status, "done");
});

test("applyAnalysisEvent updates the cached payload and invalidates it on done", async () => {
  const qc = new QueryClient();
  qc.setQueryData(qk.review.detail(REF), reviewFixture("running"));
  qc.setQueryData(qk.review.status(REF), reviewStatusFixture("running"));
  assert.equal(applyAnalysisEvent(qc, REF, "analysis:progress", frame(20, 22)), false);
  assert.equal(qc.getQueryData<ReviewDTO>(qk.review.detail(REF))!.analysis!.gradedPlies, 22);
  assert.equal(qc.getQueryState(qk.review.detail(REF))!.isInvalidated, false);
  const refetch = applyAnalysisEvent(qc, REF, "analysis:done", {
    v: 1,
    gameRef: REF,
    analysisVersion: 1,
    accuracy: 85,
    momentsCount: 3,
    headline: null,
    coachLine: null,
    isClean: false,
    bank: null,
  });
  assert.equal(refetch, true);
  assert.equal(qc.getQueryState(qk.review.detail(REF))!.isInvalidated, true);
  qc.clear();
});
