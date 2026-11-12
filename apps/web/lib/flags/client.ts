"use client";

// useFlag() (plan §7.10, decision P1-12): reads the server-evaluated flags shipped in the viewer
// payload, `qk.me().flags`. It never calls PostHog and never fetches: it only reads the query cache,
// which `(app)/layout.tsx` seeds (1B·J) or UserSync's one `GET /api/me` fills (F4d). With no viewer
// in the cache (signed out, not seeded yet) or no QueryProvider above it, it returns the registry
// default for NEXT_PUBLIC_APP_ENV, so the first render matches the server's signed-out answer.

import { useContext, useSyncExternalStore } from "react";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import { flagEnv, flagFromMe, type FlagKey } from "./registry";

export type { FlagKey } from "./registry";

type MeFlags = { flags?: Record<string, boolean> | null };

const noopUnsubscribe = () => {};

/**
 * Query-cache events, delivered to React after the current task (one call per burst). The cache notifies
 * synchronously, and some of its writes happen while React renders another component: HydrationBoundary hydrates
 * queries the cache does not hold DURING render (after sign-out's `queryClient.clear()`, the page's seeded viewer
 * payload comes back that way). A synchronous `onChange` then updated every useFlag caller mid-render ("Cannot
 * update a component (AppShellView) while rendering a different component (HydrationBoundary)", regression:
 * flag-update-in-render). useSyncExternalStore re-reads the snapshot when the deferred call lands, and its commit
 * check still catches a value that changed during a render.
 */
export function subscribeDeferred(client: Pick<QueryClient, "getQueryCache">, onChange: () => void): () => void {
  let queued = false;
  let active = true;
  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active) onChange();
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

export function useFlag(key: FlagKey): boolean {
  // useContext, not useQueryClient(): a page outside QueryProvider gets the default instead of a throw.
  const client = useContext(QueryClientContext);
  const env = flagEnv();

  const subscribe = (onChange: () => void) => (client ? subscribeDeferred(client, onChange) : noopUnsubscribe);
  const read = () => flagFromMe(client?.getQueryData<MeFlags>(qk.me()), key, env);

  // The snapshot is a boolean, so unrelated cache events never re-render the caller.
  return useSyncExternalStore(subscribe, read, read);
}
