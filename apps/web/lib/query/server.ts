// Server-side QueryClient (plan §5.4): one per request through React `cache`, so a layout and a page in the same
// render share it. Seed with `setQueryData` / `prefetchQuery`, then pass `dehydrateFor(qc)` to <HydrationBoundary>.
//
//   const qc = getServerQueryClient();
//   qc.setQueryData(meQuery.queryKey, me);
//   return <HydrationBoundary state={dehydrateFor(qc)}>{children}</HydrationBoundary>;
//
// Server components only. Never `fetch("/api/…")` from here: read through the services (plan §5.1).
import { dehydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { cache } from "react";
import { makeQueryClient } from "@/lib/api/query-client";

export const getServerQueryClient = cache((): QueryClient => {
  if (typeof window !== "undefined") throw new Error("getServerQueryClient() is server-only");
  return makeQueryClient();
});

/** Successful queries only (TanStack's default), so a failed server read never ships as an error state. */
export function dehydrateFor(qc: QueryClient): DehydratedState {
  return dehydrate(qc);
}
