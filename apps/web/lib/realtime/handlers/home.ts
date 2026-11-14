// User-room events → Home (phase-05 plan §4.1 transitions, §5.2 S1, §5.5; owner WP-H). The bank counts are
// handlers/train.ts's (HomeScreen mounts both); this module patches what only Home shows:
//
//   import:progress    → home.import {imported, total}         (setQueryData, no fetch; ≤ 1/s)
//   analysis:progress  → home.continue.analysis {done, total}  (only for the Continue game; priority ≥ 80 jobs only)
//   analysis:done      → for the game the Continue card shows as analysing: one refetch now (the card swaps to the
//                        moments view); any other game: the invalidator
//   import:finished, analysis:done, analysis:batch → the invalidator on qk.home(): invalidateThrottled by default (one
//                        trailing refetch per 30 s; a hidden tab only marks it stale), so a 500-game backlog costs at
//                        most one GET /api/home per 30 s while Home is visible
//
// Sentry (plan §10.2): `home.refetch{cause}` counts each refetch Home's events open (one per throttle window, and the
// immediate Continue swap), by the event that caused it (FIX-2). Throttled-away frames are not counted.
import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { HomeData } from "@repo/contracts/http/home";
import type { AnalysisProgressEvent } from "@repo/contracts/socket/analysis";
import type { ImportProgressEvent } from "@repo/contracts/socket/user";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "../connection";
import { withSentry } from "@/lib/sentry/lazy";
import { documentHidden, invalidateThrottled, throttledInvalidator } from "../invalidateThrottled";
import { loadFrameValidator } from "../validate.dev";
import { markStale, type Invalidator } from "./train";

/** Home's default: one trailing refetch per 30 s (PUSH_INVALIDATE_MS). */
export const homeInvalidator: Invalidator = throttledInvalidator();

/** `home.refetch{cause}` (§10.2): one Home refetch, by cause (an event name, or "bank" for the bank-count events). */
export type HomeRefetchReport = (cause: string) => void;

export const reportHomeRefetch: HomeRefetchReport = (cause) =>
  withSentry((Sentry) => Sentry.metrics.count("home.refetch", 1, { attributes: { cause } }));

/** Home's throttled invalidator that reports each refetch window it opens (joined frames are not refetches). */
export function homeRefetchInvalidator(cause: string, report: HomeRefetchReport = reportHomeRefetch): Invalidator {
  return (qc, key) => {
    if (invalidateThrottled(qc, key)) report(cause);
  };
}

export const HOME_PATCH_EVENTS = ["import:progress", "analysis:progress"] as const;
export const HOME_INVALIDATE_EVENTS = ["import:finished", "analysis:done", "analysis:batch"] as const;
export type HomeEventName = (typeof HOME_PATCH_EVENTS)[number] | (typeof HOME_INVALIDATE_EVENTS)[number];

/** `import:progress` → the Home status row ("IMPORTING 212 / 480 GAMES"). Never lowers the imported count. */
export function homeOnImportProgress(d: HomeData, ev: ImportProgressEvent): HomeData {
  if (!d.import || d.import.provider !== ev.provider) return d;
  const imported = Math.max(d.import.imported, ev.imported);
  if (imported === d.import.imported && ev.total === d.import.total) return d;
  return { ...d, import: { ...d.import, imported, total: ev.total } };
}

/** `analysis:progress` → "Analysing · 14 of 38 moves" on the Continue card of that game. */
export function homeOnAnalysisProgress(d: HomeData, ev: AnalysisProgressEvent): HomeData {
  const c = d.continue;
  if (!c || c.gameRef !== ev.gameRef || c.kind !== "analysing") return d;
  if (ev.gradedPlies <= c.analysis.done) return d;
  return { ...d, continue: { ...c, analysis: { status: "running", done: ev.gradedPlies, total: ev.totalPlies } } };
}

/** True when `analysis:done` finished the game the Continue card is waiting on (it must swap now, not in 30 s). */
export function finishesContinue(d: HomeData | undefined, ev: { gameRef?: unknown }): boolean {
  const c = d?.continue;
  return !!c && c.kind === "analysing" && c.gameRef === ev.gameRef;
}

/** Applies one event to the Home cache (a no-op when Home was never loaded in this tab). */
export function applyHomeEvent(
  qc: QueryClient,
  name: HomeEventName,
  ev: unknown,
  invalidate: Invalidator = markStale,
  report: HomeRefetchReport = reportHomeRefetch,
): void {
  if (name === "import:progress" || name === "analysis:progress") {
    const d = qc.getQueryData<HomeData>(qk.home());
    if (!d) return;
    const next =
      name === "import:progress" ? homeOnImportProgress(d, ev as ImportProgressEvent) : homeOnAnalysisProgress(d, ev as AnalysisProgressEvent);
    if (next !== d) qc.setQueryData<HomeData>(qk.home(), next);
    return;
  }
  if (name === "analysis:done" && finishesContinue(qc.getQueryData<HomeData>(qk.home()), ev as { gameRef?: unknown })) {
    const hidden = documentHidden();
    void qc.invalidateQueries({ queryKey: qk.home(), exact: true, refetchType: hidden ? "none" : "active" });
    if (!hidden) report(name);
    return;
  }
  invalidate(qc, qk.home());
}

type Frame = { useq?: unknown };

function validateDev(name: HomeEventName, payload: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  void loadFrameValidator().then((validate) => validate?.(name, payload));
}

/** Mounted by the Home page (the "user" hold). */
export function useHomeEvents(options: { enabled?: boolean; invalidate?: Invalidator } = {}): void {
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  const invalidate = useRef<Invalidator | null>(options.invalidate ?? null);
  useEffect(() => {
    invalidate.current = options.invalidate ?? null;
  });

  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire("user");
    const offs = [...HOME_PATCH_EVENTS, ...HOME_INVALIDATE_EVENTS].map((name) =>
      rt.on<Frame>(name, (frame) => {
        if (!frame || typeof frame !== "object") return;
        if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
        validateDev(name, frame);
        // The default counts each refetch it opens by this event (home.refetch{cause}).
        applyHomeEvent(qc, name, frame, invalidate.current ?? homeRefetchInvalidator(name));
      }),
    );
    const offHello = rt.onHello((_hello, resync) => {
      if (resync) markStale(qc, qk.home());
    });
    return () => {
      for (const off of offs) off();
      offHello();
      release();
    };
  }, [qc, enabled]);
}
