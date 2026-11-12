// Web-side analysis emits (phase-03 plan §5.11): A3/A4 send `analysis:queued` to the game's member players' rooms
// after the commit, inside `after()`. P2's `/internal/emit` body (`{v:1, targets:[{userRef}], event, data,
// dedupeKey?}`), signed by internalFetch() with kid `web`. The payload is validated against the CT schema first, so a
// malformed emit fails here, not on the socket. Never throws: a lost emit only costs a live update (the client's
// fallback poller and the A1 refetch cover it).
import { AnalysisQueuedEvent } from "@repo/contracts/socket/analysis";
import { getRouteDeps } from "@/lib/api/context";
import { InternalFetchConfigError, internalFetch } from "@/lib/internal/fetch";

export type QueuedEmit = { gameRef: string; position: number; etaSec: number };

let fetchImpl: typeof fetch | undefined;

/** Test seam: the transport internalFetch uses for these emits; returns a restore function. */
export function setEmitTransport(next: typeof fetch | undefined): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

/** `analysis:queued` to every member player of the game (shared event: one call, ≤ 2 targets). */
export async function emitAnalysisQueued(userRefs: readonly string[], data: QueuedEmit): Promise<boolean> {
  const deps = getRouteDeps();
  const refs = Array.from(new Set(userRefs)).filter(Boolean);
  if (refs.length === 0) return false;
  const payload = AnalysisQueuedEvent.safeParse({ v: 1, ...data });
  if (!payload.success) {
    deps.log("warn", "analysis.emit_invalid", { event: "analysis:queued" });
    return false;
  }
  try {
    const res = await internalFetch("/internal/emit", {
      body: { v: 1, targets: refs.map((userRef) => ({ userRef })), event: "analysis:queued", data: payload.data },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) deps.log("warn", "analysis.emit_refused", { event: "analysis:queued", status: res.status });
    return res.ok;
  } catch (err) {
    deps.log("warn", "analysis.emit_failed", {
      event: "analysis:queued",
      reason: err instanceof InternalFetchConfigError ? err.message : err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}
