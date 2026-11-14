// Phase-05 plan §5.5: `invalidateThrottled(key, ms)` keeps one timer per query-key hash; the first event in a window
// schedules a trailing invalidation, later events coalesce. With a fake clock: 100 events in 30 s → 1 invalidation;
// a hidden tab → 0 fetches and 1 stale mark.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import {
  cancelThrottledInvalidations,
  documentHidden,
  invalidateThrottled,
  pendingInvalidations,
  PUSH_INVALIDATE_MS,
  throttledInvalidator,
} from "./invalidateThrottled";

type DocLike = { visibilityState: "visible" | "hidden" };
const g = globalThis as unknown as { document?: DocLike };

function setVisibility(state: "visible" | "hidden" | null): void {
  if (state === null) delete g.document;
  else g.document = { visibilityState: state };
}

/** A client whose `today` query is observed (active) and counts its fetches. */
function activeToday() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  let fetches = 0;
  qc.setQueryData(qk.train.today(), { n: 0 });
  const observer = new QueryObserver(qc, {
    queryKey: qk.train.today(),
    queryFn: async () => ({ n: ++fetches }),
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  return { qc, fetches: () => fetches, unsubscribe };
}

describe("invalidateThrottled", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    setVisibility(null);
  });

  it("100 events in one 30 s window → exactly one trailing invalidation, at the end of the window", () => {
    setVisibility("visible");
    const qc = new QueryClient();
    const spy = mock.method(qc, "invalidateQueries", async () => {});
    let opened = 0;
    for (let i = 0; i < 100; i++) {
      if (invalidateThrottled(qc, qk.train.today(), PUSH_INVALIDATE_MS)) opened++;
      mock.timers.tick(290); // 100 × 290 ms = 29 s: all inside the window
    }
    assert.equal(opened, 1, "only the first event opens a window");
    assert.equal(spy.mock.callCount(), 0, "nothing before the window ends");
    mock.timers.tick(1_000);
    assert.equal(spy.mock.callCount(), 1);
    assert.deepEqual(spy.mock.calls[0]!.arguments[0], { queryKey: qk.train.today(), refetchType: "active" });
    assert.equal(pendingInvalidations(qc), 0);
  });

  it("an event after the window closed opens the next window (one invalidation per window, never zero)", () => {
    const qc = new QueryClient();
    const spy = mock.method(qc, "invalidateQueries", async () => {});
    invalidateThrottled(qc, qk.home(), 30_000);
    mock.timers.tick(30_000);
    invalidateThrottled(qc, qk.home(), 30_000);
    invalidateThrottled(qc, qk.home(), 30_000);
    mock.timers.tick(30_000);
    assert.equal(spy.mock.callCount(), 2);
  });

  it("keys throttle independently (one timer per key hash; equal keys share one)", () => {
    const qc = new QueryClient();
    const spy = mock.method(qc, "invalidateQueries", async () => {});
    invalidateThrottled(qc, qk.train.today(), 30_000);
    invalidateThrottled(qc, qk.home(), 30_000);
    invalidateThrottled(qc, ["train", "today"], 30_000);
    assert.equal(pendingInvalidations(qc), 2);
    mock.timers.tick(30_000);
    assert.deepEqual(
      spy.mock.calls.map((c) => (c.arguments[0] as { queryKey: unknown }).queryKey),
      [qk.train.today(), qk.home()],
    );
  });

  it("visible tab: the active query refetches once for a burst", async () => {
    setVisibility("visible");
    const t = activeToday();
    for (let i = 0; i < 100; i++) invalidateThrottled(t.qc, qk.train.today(), 30_000);
    mock.timers.tick(30_000);
    await t.qc.getQueryCache().find({ queryKey: qk.train.today() })!.promise;
    assert.equal(t.fetches(), 1);
    t.unsubscribe();
  });

  it("hidden tab: 0 fetches and 1 stale mark (the query refetches on focus instead)", async () => {
    setVisibility("hidden");
    const t = activeToday();
    const spy = mock.method(t.qc, "invalidateQueries");
    for (let i = 0; i < 100; i++) invalidateThrottled(t.qc, qk.train.today(), 30_000);
    mock.timers.tick(30_000);
    await Promise.resolve();
    assert.equal(spy.mock.callCount(), 1, "one stale mark");
    assert.equal((spy.mock.calls[0]!.arguments[0] as { refetchType: string }).refetchType, "none");
    assert.equal(t.fetches(), 0, "no request while hidden");
    assert.equal(t.qc.getQueryCache().find({ queryKey: qk.train.today() })!.isStale(), true);
    t.unsubscribe();
  });

  it("separate clients never share windows", () => {
    const a = new QueryClient();
    const b = new QueryClient();
    assert.equal(invalidateThrottled(a, qk.home(), 30_000), true);
    assert.equal(invalidateThrottled(b, qk.home(), 30_000), true);
    cancelThrottledInvalidations(a);
    cancelThrottledInvalidations(b);
  });

  it("cancelThrottledInvalidations drops open windows without invalidating", () => {
    const qc = new QueryClient();
    const spy = mock.method(qc, "invalidateQueries", async () => {});
    invalidateThrottled(qc, qk.train.today(), 30_000);
    cancelThrottledInvalidations(qc);
    mock.timers.tick(60_000);
    assert.equal(spy.mock.callCount(), 0);
    assert.equal(pendingInvalidations(qc), 0);
  });

  it("throttledInvalidator() is the handlers' Invalidator form", () => {
    const qc = new QueryClient();
    const spy = mock.method(qc, "invalidateQueries", async () => {});
    const inv = throttledInvalidator(5_000);
    inv(qc, qk.home());
    inv(qc, qk.home());
    mock.timers.tick(5_000);
    assert.equal(spy.mock.callCount(), 1);
  });

  it("documentHidden: false without a document (server, tests), true only for a hidden one", () => {
    setVisibility(null);
    assert.equal(documentHidden(), false);
    setVisibility("visible");
    assert.equal(documentHidden(), false);
    setVisibility("hidden");
    assert.equal(documentHidden(), true);
  });
});
