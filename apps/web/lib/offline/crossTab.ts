// Cross-tab staleness (phase-05 plan §5.3, cdl §3.5): after a grade, a session end, a skip, a removal or an A6 toggle,
// the other open tabs of this browser mark the affected queries stale over `BroadcastChannel("rc-sync")`, so a second
// tab showing the hub or the bank refetches on its next focus instead of showing old counts. Only query keys travel
// (no user data); a tab ignores its own messages. Without BroadcastChannel (old Safari) it is a no-op: focus refetches
// still catch up.
import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const SYNC_CHANNEL = "rc-sync";

export type SyncMessage = { t: "stale"; keys: QueryKey[]; from: string };

export interface SyncChannelLike {
  postMessage(m: SyncMessage): void;
  close(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export type CrossTabDeps = { channel: () => SyncChannelLike | null; id: string };

const tabId: string = (() => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();

const browserDeps: CrossTabDeps = {
  channel() {
    try {
      if (typeof BroadcastChannel === "undefined") return null;
      return new BroadcastChannel(SYNC_CHANNEL) as unknown as SyncChannelLike;
    } catch {
      return null;
    }
  },
  id: tabId,
};

/** A stale message's keys, validated (arrays of JSON values only). */
export function parseSyncMessage(data: unknown, selfId: string): QueryKey[] | null {
  const m = data as Partial<SyncMessage> | null;
  if (!m || m.t !== "stale" || typeof m.from !== "string" || m.from === selfId || !Array.isArray(m.keys)) return null;
  const keys = m.keys.filter((k): k is QueryKey => Array.isArray(k) && k.length > 0 && k.length <= 6);
  return keys.length ? keys : null;
}

let sender: SyncChannelLike | null | undefined;

/** Tells the other tabs that these keys changed (fire and forget). */
export function broadcastStale(keys: readonly QueryKey[], deps: CrossTabDeps = browserDeps): void {
  if (!keys.length) return;
  try {
    if (deps !== browserDeps) {
      const ch = deps.channel();
      ch?.postMessage({ t: "stale", keys: [...keys], from: deps.id });
      ch?.close();
      return;
    }
    if (sender === undefined) sender = deps.channel();
    sender?.postMessage({ t: "stale", keys: [...keys], from: deps.id });
  } catch {
    // Cross-tab sync is best effort.
  }
}

/** Marks the keys stale here and in the other tabs (`refetchType: "none"`: the next mount or focus refetches). */
export function markStaleEverywhere(qc: QueryClient, keys: readonly QueryKey[], deps: CrossTabDeps = browserDeps): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey, refetchType: "none" });
  broadcastStale(keys, deps);
}

/** Listens for the other tabs' stale messages while mounted (useOutboxSync). Returns the stop function. */
export function listenCrossTab(qc: QueryClient, deps: CrossTabDeps = browserDeps): () => void {
  const ch = deps.channel();
  if (!ch) return () => undefined;
  ch.onmessage = (e) => {
    const keys = parseSyncMessage(e.data, deps.id);
    if (!keys) return;
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey, refetchType: "none" });
  };
  return () => {
    ch.onmessage = null;
    ch.close();
  };
}
