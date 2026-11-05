// QueryClient defaults (plan §5.4, CDL §3.2). One client per browser tab; one per request on the server
// (lib/query/server.ts). DTOs are JSON-safe (ISO strings, no BigInt), so dehydrate/hydrate need no serializer.
import { isServer, MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { reactToApiError, retryDelay, retryQuery, type ApiMutationMeta, type ApiQueryMeta } from "./errors";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: ApiQueryMeta;
    mutationMeta: ApiMutationMeta;
  }
}

export const DEFAULT_STALE_TIME_MS = 30_000;
export const DEFAULT_GC_TIME_MS = 5 * 60_000;

export function makeQueryClient(): QueryClient {
  // The caches are built before the client; their handlers only run after `client` below is initialised.
  const queryCache = new QueryCache({
    onError: (error, query) =>
      reactToApiError(error, {
        kind: query.state.data === undefined ? "query" : "background",
        meta: query.meta,
        queryClient: client,
      }),
  });
  const mutationCache = new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      reactToApiError(error, { kind: "mutation", meta: mutation.meta, queryClient: client }),
  });
  const client: QueryClient = new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        retry: retryQuery,
        retryDelay: (attempt, error) => retryDelay(attempt, error),
        refetchOnWindowFocus: true, // stale queries only
        refetchOnReconnect: true,
        networkMode: "online", // paused, not failed, while offline
      },
      mutations: { retry: 0, networkMode: "online" }, // never auto-retry a user action
    },
  });
  return client;
}

let browserClient: QueryClient | undefined;

/**
 * The tab's QueryClient. On the server it returns a fresh client every call: server components use
 * `getServerQueryClient()` (React `cache`, one per request) instead.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
