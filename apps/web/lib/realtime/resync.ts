// Reconnect resync for user-level data (P2 plan 7.4.1 step 6, api-perf AP-25, client-data-layer 5.3/5.5).
// `session:hello { bootId, useq, serverNow }` arrives on every connect. User-level queries are refetched only when
// the server process changed (`bootId`, it may have dropped events) or a `useq` gap shows a missed user-room event;
// a flaky-network reconnect with neither refetches nothing. Game rooms resync through `game:join` instead.

import type { SessionHelloEvent } from "@repo/contracts/socket/events";
import { qk } from "@/lib/api/keys";

export type HelloState = SessionHelloEvent;

/**
 * True when the user-level caches must be refetched after this `session:hello`.
 * `lastUseq` is the highest `useq` this tab saw on a user-room event (or the previous hello).
 */
export function shouldResync(prev: HelloState | null, hello: HelloState, lastUseq: number): boolean {
  if (!prev) return false; // first connect of the tab: the server render is fresh
  if (prev.bootId !== hello.bootId) return true;
  return hello.useq > Math.max(lastUseq, prev.useq);
}

/** The user-level query prefixes P2 marks stale on a resync (more phases add theirs). */
export const RESYNC_QUERY_KEYS: readonly (readonly unknown[])[] = [qk.me()];
