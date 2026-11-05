// The viewer query (plan §5.3): `qk.me()` → GET /api/me. Seeded by (app)/layout.tsx after 1B·J, otherwise filled
// by UserSync's first fetch. 5 min stale, 30 min gc, focus refetch when stale.
import { MeData, type Entitlement } from "@repo/contracts/http/me";
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

export const ME_STALE_TIME_MS = 5 * 60_000;
export const ME_GC_TIME_MS = 30 * 60_000;

export async function fetchMe(signal?: AbortSignal): Promise<MeData> {
  // devSchema written inline (lib/api/schema.ts): only then does webpack drop MeData, and zod, from production chunks.
  const schema = process.env.NODE_ENV === "production" ? undefined : MeData;
  const { data } = await api(endpoints.me, { schema, signal });
  return data;
}

/** `queryKey` is tagged with MeData, so getQueryData/setQueryData on it are typed. */
export const meQuery = queryOptions({
  queryKey: qk.me(),
  queryFn: ({ signal }) => fetchMe(signal),
  staleTime: ME_STALE_TIME_MS,
  gcTime: ME_GC_TIME_MS,
  meta: { object: "your account" },
});

/** The viewer, optionally narrowed (`useMe((m) => m.entitlement.member)`). */
export function useMe<T = MeData>(select?: (me: MeData) => T) {
  return useQuery({ ...meQuery, select });
}

/**
 * Merges a fresh entitlement into the cached viewer (POST /api/billing/refresh returns one). No-op when nothing is
 * cached: the next read fetches the whole viewer anyway.
 */
export function setMeEntitlement(qc: QueryClient, entitlement: Entitlement): void {
  qc.setQueryData(meQuery.queryKey, (prev) => (prev ? { ...prev, entitlement } : prev));
}
