// Import-status query (phase-04 plan §5.2, §5.3, §5.7; D4-31). Key `qk.imports()`, staleTime 0, seeded by the
// activating / done RSC (`getImportStatus`) and the archive banner. The socket's `import:*` and `analysis:done`
// patch it; the HTTP fallback polls (after 5 s without a live socket: 3 s × 10, then 10 s, for 10 min) only while a
// run is waiting, queued or running and the tab is visible. A GET never enqueues: a stale QUEUED run is re-kicked by
// the server's kick CAS.
import type { ImportStatusData } from "@repo/contracts/http/import";
import { ImportStatusData as ImportStatusSchema } from "@repo/contracts/http/import";
import { useEffect } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@/lib/realtime/useConnection";
import { IMPORT_STATUS_FALLBACK, fallbackInterval } from "@/lib/realtime/fallback-interval";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

export async function fetchImportStatus(signal?: AbortSignal): Promise<ImportStatusData> {
  const schema = process.env.NODE_ENV === "production" ? undefined : ImportStatusSchema;
  const { data } = await api(endpoints.importStatus, { schema, signal });
  return data as ImportStatusData;
}

/** A run is still moving (the poller's condition): queued or running. A waiting run moves only on entitlement. */
export function hasActiveRun(d: ImportStatusData | undefined): boolean {
  return !!d?.runs.some((r) => r.status === "queued" || r.status === "running");
}

/** The run a progress card shows: the newest active one, else the newest. */
export function currentRun(d: ImportStatusData | undefined): ImportStatusData["runs"][number] | null {
  if (!d?.runs.length) return null;
  return d.runs.find((r) => r.status === "running" || r.status === "queued" || r.status === "waiting_for_membership") ?? d.runs[0]!;
}

/** Data this fresh (the server render's seed of the page just mounted) is not fetched again on mount. */
export const IMPORT_SEED_FRESH_MS = 5_000;

/**
 * Whether a mount refetches: staleTime stays 0 (§9.3: every later reader revalidates), but the copy the activating /
 * done RSC seeded a moment ago is the server's answer already, and the socket patches it from there. Without this
 * each seeded page load cost one GET /api/import/status (plan §5.9 budgets none; regression: p04-request-budget).
 */
export function refetchImportsOnMount(query: { state: { dataUpdatedAt: number } }, nowMs: number = Date.now()): boolean {
  return nowMs - query.state.dataUpdatedAt > IMPORT_SEED_FRESH_MS;
}

export function importStatusQuery() {
  return queryOptions({
    queryKey: qk.imports(),
    queryFn: ({ signal }): Promise<ImportStatusData> => fetchImportStatus(signal),
    staleTime: 0,
    refetchOnMount: (query) => refetchImportsOnMount(query),
    refetchOnWindowFocus: true,
    meta: { object: "the import status" },
  });
}

/**
 * How long after the socket went live an active run may go without any import update before the status is fetched
 * once (FIX-1). The socket connects after the page (socket.io-client loads on the first hold), and a run that moved or
 * finished in between sent its `import:*` events before anyone listened; while a run is moving it updates every chunk
 * (≤ 100 games), so 10 s of silence means those events were missed. A run that keeps updating costs no request.
 */
export const IMPORT_LIVE_CATCHUP_MS = 10_000;

/**
 * The checks after the socket went live: the first at IMPORT_LIVE_CATCHUP_MS, then twice as far apart up to a minute,
 * each fetching only when nothing updated the run since the previous check's answer. Events are lost more often than
 * the first check assumed: the Done page is a document load (lib/billing/client.ts leaveActivation), and the socket
 * server drops a user-room event while the member has no socket (AP-10: an empty room is skipped and `useq` does not
 * move, so the reconnect shows no gap); 6 of 30 local runs on 4 workers recovered only through this check. With one
 * check, a card it caught still moving had nothing left to recover it: in CI 43418735934 (chromium) Done said
 * "Importing games · 0 found" for 180 s (regression: import-card-stuck-reading-2). A run that keeps sending events is
 * never fetched; a silent one costs one GET per check.
 */
export function importCatchUpDelayMs(check: number): number {
  return Math.min(IMPORT_LIVE_CATCHUP_MS * 2 ** Math.max(0, check), IMPORT_CATCHUP_MAX_MS);
}
export const IMPORT_CATCHUP_MAX_MS = 60_000;

/** True when the status must be fetched again: an active run, and nothing updated it since the socket went live. */
export function importCatchUpDue(input: { liveAt: number; nowMs: number; dataUpdatedAt: number; data: ImportStatusData | undefined }): boolean {
  return input.nowMs - input.liveAt >= IMPORT_LIVE_CATCHUP_MS && input.dataUpdatedAt <= input.liveAt && hasActiveRun(input.data);
}

/** Activating, Done and the archive banner: seeded data, socket updates, the fallback poller while the socket is down. */
export function useImportStatus(options: { enabled?: boolean } = {}) {
  const conn = useConnection();
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled || conn !== "live") return;
    // `baseline`: the moment from which an update counts (the socket going live, then each check's own answer).
    let baseline = Date.now();
    let check = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(async () => {
        const state = qc.getQueryState<ImportStatusData>(qk.imports());
        if (!state || !hasActiveRun(state.data)) return; // nothing moving: no more checks
        if (importCatchUpDue({ liveAt: baseline, nowMs: Date.now(), dataUpdatedAt: state.dataUpdatedAt, data: state.data })) {
          await qc.invalidateQueries({ queryKey: qk.imports(), refetchType: "active" }).catch(() => undefined);
        }
        if (stopped) return;
        baseline = Math.max(Date.now(), qc.getQueryState<ImportStatusData>(qk.imports())?.dataUpdatedAt ?? 0);
        check += 1;
        arm();
      }, importCatchUpDelayMs(check));
    };
    arm();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [conn, enabled, qc]);
  return useQuery({
    ...importStatusQuery(),
    enabled,
    refetchInterval: (query) => fallbackInterval(query, IMPORT_STATUS_FALLBACK, conn !== "live" && hasActiveRun(query.state.data), Date.now()),
    refetchIntervalInBackground: false,
  });
}
