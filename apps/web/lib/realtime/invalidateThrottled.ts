// Trailing-edge, per-key throttled invalidation for push events (phase-05 plan §5.1, §5.5; api-perf AP-10).
//
//   invalidateThrottled(qc, qk.train.today(), 30_000)
//
// A 500-game import backlog emits a burst of `analysis:batch`, `mistakes:added` and `bank:due_changed` frames. Each one
// would refetch today's plan, the bank and Home; instead the first frame in a window schedules ONE invalidation at the
// end of the window and every later frame in that window only coalesces into it. The invalidation refetches the key's
// active queries when the tab is visible and only marks them stale when it is hidden (they refetch on focus), so a
// hidden tab costs no request at all. One timer per (QueryClient, key hash): different keys never delay each other.
//
// The due COUNTS never wait for this: the train and home handlers write them with setQueryData as the frame arrives.
import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { Invalidator } from "./handlers/train";

/** The plan's window for push-driven refetches of train, bank and Home keys. */
export const PUSH_INVALIDATE_MS = 30_000;

type Pending = { timer: ReturnType<typeof setTimeout>; key: QueryKey };

const pendingByClient = new WeakMap<QueryClient, Map<string, Pending>>();

function pendingFor(qc: QueryClient): Map<string, Pending> {
  let pending = pendingByClient.get(qc);
  if (!pending) {
    pending = new Map();
    pendingByClient.set(qc, pending);
  }
  return pending;
}

/** True while the document is hidden (a background tab); false on the server and in tests without a document. */
export function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Invalidates `key` once at the end of a `ms` window that the first call opens; later calls inside the window add
 * nothing. Returns true when this call opened a window, false when it joined one.
 */
export function invalidateThrottled(qc: QueryClient, key: QueryKey, ms: number = PUSH_INVALIDATE_MS): boolean {
  const pending = pendingFor(qc);
  const id = hashKey(key);
  if (pending.has(id)) return false;
  const timer = setTimeout(() => {
    pending.delete(id);
    void qc.invalidateQueries({ queryKey: key, refetchType: documentHidden() ? "none" : "active" });
  }, ms);
  pending.set(id, { timer, key });
  return true;
}

/** The handlers' injectable form: `useTrainEvents({ invalidate: throttledInvalidator() })`. */
export function throttledInvalidator(ms: number = PUSH_INVALIDATE_MS): Invalidator {
  return (qc, key) => {
    invalidateThrottled(qc, key, ms);
  };
}

/** Windows open for this client (tests and the sign-out path). */
export function pendingInvalidations(qc: QueryClient): number {
  return pendingByClient.get(qc)?.size ?? 0;
}

/** Drops every open window without invalidating (sign-out clears the cache anyway; tests reset between cases). */
export function cancelThrottledInvalidations(qc: QueryClient): void {
  const pending = pendingByClient.get(qc);
  if (!pending) return;
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}
