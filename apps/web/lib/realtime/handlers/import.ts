// User-room import events → the query cache (phase-04 plan §5.5, §5.6, §7.6; api-perf AP-10, AP-25).
//
// Pure updaters (exported, unit-tested) for the three caches that show an import:
//   qk.imports()   ImportStatusData: the run with `runRef` gets the event's counters (progress), its terminal state
//                  (finished / failed), and `firstReview` from `import:finished` / `analysis:done`;
//   qk.accounts()  AccountsData: the provider's account gets its run patched and its view status (`syncing`, `linked`,
//                  `rate_limited`, `error`);
//   qk.me()        MeData.import / MeData.accounts[].status.
// A progress frame for a run the cache does not hold yet (the link happened in another tab) marks `qk.imports()` stale
// instead of inventing a RunView. Terminal events also mark the archive (`qk.games.all()`) stale and refetch the
// imports / accounts once. `import:failed` with `code: rate_limited` is a pause, not a failure: the run goes back to
// `queued` and the account shows the countdown.
//
// useImportEvents() is the listener (holds the socket with the "user" hold while mounted); lib/realtime/
// useImportProgress.ts adds the ETA on top.
import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AccountsData, LinkedAccountView, RunView } from "@repo/contracts/http/accounts";
import type { ImportStatusData } from "@repo/contracts/http/import";
import type { MeData } from "@repo/contracts/http/me";
import type { AnalysisDoneEvent } from "@repo/contracts/socket/analysis";
import type { ImportFailedEvent, ImportFinishedEvent, ImportProgressEvent, UserEventName } from "@repo/contracts/socket/user";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "../connection";

export const IMPORT_EVENT_NAMES = ["import:progress", "import:finished", "import:failed"] as const satisfies readonly UserEventName[];
export type ImportEventName = (typeof IMPORT_EVENT_NAMES)[number];
export type ImportEvent = ImportProgressEvent | ImportFinishedEvent | ImportFailedEvent;
export type ImportEventHandler = (name: ImportEventName, payload: ImportEvent) => void;

type Outcome<T> = { next: T; missing: boolean };

/** One run after an event (null when the event is not about this run). */
export function runOnEvent(run: RunView, name: ImportEventName, ev: ImportEvent, nowIso: string): RunView {
  if (run.ref !== ev.runRef) return run;
  switch (name) {
    case "import:progress": {
      const p = ev as ImportProgressEvent;
      if (run.status === "done" || run.status === "failed" || run.status === "cancelled") return run;
      return { ...run, status: "running", phase: p.phase, seen: p.seen, imported: Math.max(run.imported, p.imported), total: p.total, analysed: Math.max(run.analysed, p.analysed), error: null, updatedAt: nowIso };
    }
    case "import:finished": {
      const f = ev as ImportFinishedEvent;
      return {
        ...run,
        status: "done",
        phase: null,
        imported: f.imported,
        skipped: f.skipped,
        total: f.total,
        analysisQueued: f.analysisQueued,
        analysed: Math.max(run.analysed, f.analysed),
        error: null,
        finishedAt: run.finishedAt ?? nowIso,
        updatedAt: nowIso,
      };
    }
    case "import:failed": {
      const f = ev as ImportFailedEvent;
      const paused = f.code === "rate_limited";
      return {
        ...run,
        status: paused ? "queued" : "failed",
        imported: Math.max(run.imported, f.imported),
        total: f.total ?? run.total,
        error: { code: f.code, at: nowIso, retryAt: f.retryAt },
        finishedAt: paused ? run.finishedAt : (run.finishedAt ?? nowIso),
        updatedAt: nowIso,
      };
    }
  }
}

export function importsOnEvent(d: ImportStatusData, name: ImportEventName, ev: ImportEvent, nowIso: string): Outcome<ImportStatusData> {
  const i = d.runs.findIndex((r) => r.ref === ev.runRef);
  if (i < 0) return { next: d, missing: true };
  const runs = d.runs.slice();
  runs[i] = runOnEvent(runs[i]!, name, ev, nowIso);
  let firstReview = d.firstReview;
  if (name === "import:finished") {
    const ref = (ev as ImportFinishedEvent).firstReviewGameRef;
    if (ref && firstReview?.gameRef !== ref) firstReview = { gameRef: ref, analysisStatus: "queued", momentsCount: null };
  }
  return { next: { runs, firstReview }, missing: false };
}

/** `analysis:done` for the first imported game: the Done card's "first review" flips to ready. */
export function importsOnAnalysisDone(d: ImportStatusData, ev: Pick<AnalysisDoneEvent, "gameRef" | "momentsCount">): ImportStatusData {
  if (!d.firstReview || d.firstReview.gameRef !== ev.gameRef || d.firstReview.analysisStatus === "done") return d;
  return { ...d, firstReview: { ...d.firstReview, analysisStatus: "done", momentsCount: ev.momentsCount } };
}

function accountStatus(run: RunView, prev: LinkedAccountView["status"]): LinkedAccountView["status"] {
  if (run.status === "running" || run.status === "queued") {
    return run.error?.code === "rate_limited" ? "rate_limited" : run.status === "running" ? "syncing" : "queued";
  }
  if (run.status === "done") return "linked";
  if (run.status === "failed") return "error";
  return prev;
}

export function accountsOnEvent(d: AccountsData, name: ImportEventName, ev: ImportEvent, nowIso: string): Outcome<AccountsData> {
  const i = d.items.findIndex((a) => a.provider === ev.provider);
  if (i < 0) return { next: d, missing: true };
  const account = d.items[i]!;
  if (!account.run || account.run.ref !== ev.runRef) return { next: d, missing: true };
  const run = runOnEvent(account.run, name, ev, nowIso);
  const items = d.items.slice();
  items[i] = {
    ...account,
    run,
    status: accountStatus(run, account.status),
    nextAllowedSyncAt: name === "import:failed" && (ev as ImportFailedEvent).code === "rate_limited" ? (ev as ImportFailedEvent).retryAt : account.nextAllowedSyncAt,
    lastSyncAt: name === "import:progress" ? account.lastSyncAt : nowIso,
    lastSyncOkAt: name === "import:finished" ? nowIso : account.lastSyncOkAt,
    importedCount: name === "import:finished" ? account.importedCount + (ev as ImportFinishedEvent).newGames : account.importedCount,
  };
  return { next: { items }, missing: false };
}

export function meOnEvent(d: MeData, name: ImportEventName, ev: ImportEvent): MeData {
  const prev = d.import ?? null;
  let status: NonNullable<MeData["import"]>["status"];
  if (name === "import:progress") status = "running";
  else if (name === "import:finished") status = "done";
  else status = (ev as ImportFailedEvent).code === "rate_limited" ? "queued" : "failed";
  const progress = ev as Partial<ImportProgressEvent>;
  const next: NonNullable<MeData["import"]> = {
    ref: ev.runRef,
    provider: ev.provider,
    status,
    phase: name === "import:progress" ? (progress.phase ?? null) : null,
    imported: ev.imported,
    total: ev.total ?? (prev?.ref === ev.runRef ? prev.total : null),
  };
  const accounts = d.accounts?.map((a) =>
    a.provider !== ev.provider ? a : { ...a, status: status === "running" ? ("syncing" as const) : status === "done" ? ("linked" as const) : status === "queued" ? ("rate_limited" as const) : ("error" as const) },
  );
  return { ...d, import: next, ...(accounts ? { accounts } : {}) };
}

/** Applies one import event to every cache that holds the run. Returns whether a refetch was scheduled. */
export function applyImportEvent(qc: QueryClient, name: ImportEventName, ev: ImportEvent, now: Date = new Date()): boolean {
  const nowIso = now.toISOString();
  let refetch = name !== "import:progress";
  const imports = qc.getQueryData<ImportStatusData>(qk.imports());
  if (imports) {
    const out = importsOnEvent(imports, name, ev, nowIso);
    if (out.missing) refetch = true;
    else if (out.next !== imports) qc.setQueryData(qk.imports(), out.next);
  }
  const accounts = qc.getQueryData<AccountsData>(qk.accounts());
  if (accounts) {
    const out = accountsOnEvent(accounts, name, ev, nowIso);
    if (out.missing) refetch = true;
    else if (out.next !== accounts) qc.setQueryData(qk.accounts(), out.next);
  }
  const me = qc.getQueryData<MeData>(qk.me());
  if (me) qc.setQueryData(qk.me(), meOnEvent(me, name, ev));
  if (refetch) {
    void qc.invalidateQueries({ queryKey: qk.imports(), exact: true, refetchType: "active" });
    void qc.invalidateQueries({ queryKey: qk.accounts(), exact: true, refetchType: "active" });
  }
  if (name === "import:finished") void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
  return refetch;
}

type Frame = { useq?: unknown };

let validator: Promise<((name: string, payload: unknown) => void) | null> | null = null;

/** Dev-only contract check of every frame (the dynamic import keeps zod out of production chunks). */
function validateDev(name: ImportEventName | "analysis:done", payload: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    validator ??= Promise.all([import("@repo/contracts/socket/user"), import("@repo/contracts/socket/analysis")])
      .then(([{ USER_EVENTS }, { ANALYSIS_EVENTS }]) => (n: string, p: unknown) => {
        const schema = n === "analysis:done" ? ANALYSIS_EVENTS["analysis:done"] : USER_EVENTS[n as ImportEventName];
        const r = schema.safeParse(p);
        if (!r.success) console.error(`[realtime] "${n}" does not match its contract`, r.error.issues);
      })
      .catch(() => null);
    void validator.then((v) => v?.(name, payload));
  }
}

/**
 * Listens to `import:*` (and `analysis:done` for the first imported review) while mounted and `enabled`. Holds the
 * socket ("user"). On a reconnect that may have missed user-room events, the import and account caches are
 * refetched (active ones) and `qk.me()` is marked stale.
 */
export function useImportEvents(options: { enabled?: boolean; onEvent?: ImportEventHandler } = {}): void {
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  const onEvent = useRef(options.onEvent);
  useEffect(() => {
    onEvent.current = options.onEvent;
  });

  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire("user");
    const offs = IMPORT_EVENT_NAMES.map((name) =>
      rt.on<ImportEvent & Frame>(name, (frame) => {
        if (!frame || typeof frame !== "object") return;
        if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
        validateDev(name, frame);
        applyImportEvent(qc, name, frame);
        onEvent.current?.(name, frame);
      }),
    );
    offs.push(
      rt.on<AnalysisDoneEvent & Frame>("analysis:done", (frame) => {
        const d = qc.getQueryData<ImportStatusData>(qk.imports());
        if (!d || !frame || d.firstReview?.gameRef !== frame.gameRef) return;
        validateDev("analysis:done", frame);
        qc.setQueryData(qk.imports(), importsOnAnalysisDone(d, frame));
      }),
    );
    const offHello = rt.onHello((_hello, resync) => {
      if (!resync) return;
      void qc.invalidateQueries({ queryKey: qk.imports(), exact: true, refetchType: "active" });
      void qc.invalidateQueries({ queryKey: qk.accounts(), exact: true, refetchType: "active" });
      void qc.invalidateQueries({ queryKey: qk.me(), exact: true, refetchType: "none" });
    });
    return () => {
      for (const off of offs) off();
      offHello();
      release();
    };
  }, [qc, enabled]);
}
