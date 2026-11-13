// Linked-accounts queries (phase-04 plan §5.2, §5.3, §5.7). Keys only from `qk.accounts()`; responses through api()
// with the schema check at the call site (`NODE_ENV === "production" ? undefined : Schema`), so zod stays out of
// production chunks (AP-12). 304s are transparent (`private, no-cache` + a strong ETag).
//
// Freshness: 60 s, refetch on focus; the socket's `import:*` events patch it (lib/realtime/handlers/import.ts). The
// HTTP fallback polls (3, 3, 5, then 10 s for 10 min) only while an account is syncing and the socket has been down
// for 5 s, with the tab visible.
import type { AccountsData } from "@repo/contracts/http/accounts";
import { AccountsData as AccountsSchema } from "@repo/contracts/http/accounts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useConnection } from "@/lib/realtime/useConnection";
import { ACCOUNTS_FALLBACK, fallbackInterval } from "@/lib/realtime/fallback-interval";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

export async function fetchAccounts(signal?: AbortSignal): Promise<AccountsData> {
  const schema = process.env.NODE_ENV === "production" ? undefined : AccountsSchema;
  const { data } = await api(endpoints.accounts, { schema, signal });
  return data as AccountsData;
}

/** True while any account's import can still change on its own (the fallback poller's condition). */
export function anyAccountSyncing(d: AccountsData | undefined): boolean {
  return !!d?.items.some((a) => a.status === "syncing" || a.status === "queued" || a.run?.status === "running" || a.run?.status === "queued");
}

/** ACC-1, seeded by the /settings/connected RSC (`listLinkedAccounts`). */
export function accountsQuery() {
  return queryOptions({
    queryKey: qk.accounts(),
    queryFn: ({ signal }): Promise<AccountsData> => fetchAccounts(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    meta: { object: "your linked accounts" },
  });
}

/** The Connected page's read: seeded data, socket updates, the fallback poller while a sync runs and the socket is down. */
export function useLinkedAccounts() {
  const conn = useConnection();
  return useQuery({
    ...accountsQuery(),
    refetchInterval: (query) => fallbackInterval(query, ACCOUNTS_FALLBACK, conn !== "live" && anyAccountSyncing(query.state.data), Date.now()),
    refetchIntervalInBackground: false,
  });
}
