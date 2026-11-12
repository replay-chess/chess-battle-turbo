// useReviewProgressSync.ts: A5 batching (≤ 50 events), the retry-once rule and the optimistic progress merge
// (phase-03 plan §5.2 "Walkthrough progress").
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import { PROGRESS_EVENTS_MAX, type ProgressEvent } from "@repo/contracts/http/review";
import { advanceProgress, flushReviewProgress, PROGRESS_BATCH_MAX, progressBatches, retryable, settleReviewProgress } from "./useReviewProgressSync";
import type { ReviewViewStore } from "./view-store";

const ev = (i: number): ProgressEvent => ({ type: "attempt", ply: 32, at: new Date(Date.UTC(2026, 10, 9, 18, 0, i)).toISOString(), uci: "c3d5", correct: false });

test("batches hold at most 50 events (the contract's cap)", () => {
  assert.equal(PROGRESS_BATCH_MAX, PROGRESS_EVENTS_MAX);
  const events = Array.from({ length: 120 }, (_, i) => ev(i));
  assert.deepEqual(progressBatches(events).map((b) => b.length), [50, 50, 20]);
  assert.deepEqual(progressBatches([]), []);
});

test("a failed event is retried once, then dropped", () => {
  const seen = new WeakSet<ProgressEvent>();
  const batch = [ev(1), ev(2)];
  assert.equal(retryable(batch, seen).length, 2);
  assert.equal(retryable(batch, seen).length, 0, "the second failure drops them");
  assert.equal(retryable([...batch, ev(3)], seen).length, 1, "only the new event gets its retry");
});

test("the cached progress moves forward only and sets startedAt once", () => {
  const dto = reviewFixture("done");
  const at = "2026-11-09T18:50:00.000Z";
  const one = advanceProgress(dto, 1, at)!;
  assert.deepEqual(one.review!.progress, { momentIndex: 1, startedAt: at, completedAt: null });
  const back = advanceProgress(one, 0, "2026-11-09T18:51:00.000Z")!;
  assert.equal(back, one, "never back, and no new object when nothing changes");
  assert.equal(advanceProgress(one, 9, at)!.review!.progress.momentIndex, 3, "clamped to MAX_MOMENTS");
  assert.equal(advanceProgress(undefined, 1, at), undefined);
  const none = reviewFixture("running");
  assert.equal(advanceProgress(none, 1, at), none, "no review content yet: unchanged");
});

// Regression (INTEGRATE-2): Finish Review sent the last A5 batch and A7 side by side and navigated after 2.5 s, so on
// a slow database the complete page rendered a finished walkthrough as "partial". settleReviewProgress lets Finish
// wait for every A5 request still on the wire (a debounced one sent earlier, and the final flush) before A7.
test("settleReviewProgress waits for every A5 request of the review still on the wire", async () => {
  const realFetch = globalThis.fetch;
  const releases: (() => void)[] = [];
  const order: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url), "http://localhost").pathname;
    order.push(`${init?.method} ${path}`);
    await new Promise<void>((r) => releases.push(r));
    order.push(`done ${path}`);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    let queued: ProgressEvent[] = [{ type: "revealed", ply: 40, at: "2026-11-11T10:00:00.000Z" } as ProgressEvent];
    const store = {
      getState: () => ({ momentIndex: 2, drainEvents: () => queued.splice(0), requeueEvents: (e: ProgressEvent[]) => (queued = [...queued, ...e]) }),
    } as unknown as ReviewViewStore;
    assert.equal(flushReviewProgress("cref", store, { keepalive: true }), 1);
    let settled = false;
    const wait = settleReviewProgress("cref").then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false, "still waiting for the PATCH");
    releases.forEach((r) => r());
    await wait;
    assert.equal(settled, true);
    assert.deepEqual(order, ["PATCH /api/review/cref/progress", "done /api/review/cref/progress"]);
    // Nothing on the wire: resolves at once.
    await settleReviewProgress("cref");
    await settleReviewProgress("cother");
  } finally {
    globalThis.fetch = realFetch;
  }
});
