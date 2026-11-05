"use client";

// useFlag() (plan §7.10, decision P1-12): reads the server-evaluated flags shipped in the viewer
// payload, `qk.me().flags`. It never calls PostHog and never fetches: it only reads the query cache,
// which `(app)/layout.tsx` seeds (1B·J) or UserSync's one `GET /api/me` fills (F4d). With no viewer
// in the cache (signed out, not seeded yet) or no QueryProvider above it, it returns the registry
// default for NEXT_PUBLIC_APP_ENV, so the first render matches the server's signed-out answer.

import { useContext, useSyncExternalStore } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import { flagEnv, flagFromMe, type FlagKey } from "./registry";

export type { FlagKey } from "./registry";

type MeFlags = { flags?: Record<string, boolean> | null };

const noopUnsubscribe = () => {};

export function useFlag(key: FlagKey): boolean {
  // useContext, not useQueryClient(): a page outside QueryProvider gets the default instead of a throw.
  const client = useContext(QueryClientContext);
  const env = flagEnv();

  const subscribe = (onChange: () => void) => (client ? client.getQueryCache().subscribe(onChange) : noopUnsubscribe);
  const read = () => flagFromMe(client?.getQueryData<MeFlags>(qk.me()), key, env);

  // The snapshot is a boolean, so unrelated cache events never re-render the caller.
  return useSyncExternalStore(subscribe, read, read);
}
