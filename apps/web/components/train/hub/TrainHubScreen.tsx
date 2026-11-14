"use client";

// /train wired (phase-05 plan §4.2 transitions, §5.1, §5.2 S2). The RSC seeds `qk.train.today()`, so the first paint
// makes no /api request; after that:
// - day rollover: the local training day (`dayStartHour` in the member's zone) is re-read each minute while visible
//   and on `visibilitychange`; when it no longer matches the plan's `dayKey` the query is stale at once and refetches,
//   and the plan card shows its skeleton in place until today's plan arrives;
// - release timer: one timeout at `nextBatch.at` (≤ 24 h, re-armed by every refetch) marks today's plan and the
//   badge stale, refetching only while the tab is visible ("Nothing is due" turns into the 08:00 batch, no push);
// - push: `bank:due_changed`, `mistakes:added`, `analysis:done|batch` patch the counts and invalidate through
//   `invalidateThrottled` (useTrainEvents' default);
// - time zone: when the server still has the default "UTC" and the device says otherwise, one silent PATCH per tab;
// - Start / Continue Today's Plan: W2 `{kind: "daily", source: "plan"}`, then the runner.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrainToday } from "@repo/contracts/http/train";
import { ErrorState } from "@/components/data/ErrorState";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { trackTrain } from "@/lib/analytics/train-events";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/keys";
import { trainTodayQuery } from "@/lib/api/queries/train";
import { useTrainEvents } from "@/lib/realtime/handlers/train";
import { HubSkeleton } from "./HubSkeleton";
import { releaseDelayMs, viewedState } from "./model";
import { TrainHubView } from "./TrainHubView";
import { useStartSession } from "./useStartSession";
import { dayWord, deviceTimeZone, localDayKey, safeTimeZone, useClientNow } from "./when";

/** The rollover check's period while the tab is visible. */
export const DAY_TICK_MS = 60_000;
const TZ_SYNC_KEY = "rc-train-tz-sync";

/** Once per tab: the server still has the default zone and the device knows better. */
function shouldSyncTimeZone(stored: string, device: string | null): device is string {
  if (!device || device === stored || stored !== "UTC") return false;
  try {
    if (sessionStorage.getItem(TZ_SYNC_KEY) === device) return false;
    sessionStorage.setItem(TZ_SYNC_KEY, device);
  } catch {
    // Storage blocked: sync anyway (the PATCH is idempotent).
  }
  return true;
}

export function TrainHubScreen({ serverNowMs }: { serverNowMs: number }) {
  const qc = useQueryClient();
  const now = useClientNow(serverNowMs, DAY_TICK_MS);
  const seeded = qc.getQueryData<TrainToday>(qk.train.today());
  const prefs = seeded?.prefs;
  const currentDayKey = prefs ? localDayKey(now, prefs.timeZone, prefs.dayStartHour) : undefined;
  const query = useQuery(trainTodayQuery(currentDayKey));
  const today = query.data;

  useTrainEvents();

  // Release timer: re-armed whenever the plan (and so `nextBatch`) changes.
  const nextAt = today?.nextBatch?.at ?? null;
  useEffect(() => {
    if (!nextAt) return;
    const delay = releaseDelayMs(nextAt, Date.now());
    if (delay === null) return;
    const t = setTimeout(() => {
      const refetchType = document.visibilityState === "visible" ? "active" : "none";
      void qc.invalidateQueries({ queryKey: qk.train.today(), refetchType });
      void qc.invalidateQueries({ queryKey: qk.badges(), refetchType });
    }, delay);
    return () => clearTimeout(t);
  }, [nextAt, qc]);

  // Time zone: one silent PATCH, then today's plan again (its labels and day are zone-bound).
  const storedZone = today?.prefs.timeZone ?? null;
  useEffect(() => {
    if (!storedZone) return;
    const device = deviceTimeZone();
    if (!shouldSyncTimeZone(storedZone, device)) return;
    void api(endpoints.trainPrefs, { method: "PATCH", body: { timeZone: device } })
      .then(() => qc.invalidateQueries({ queryKey: qk.train.today() }))
      .catch(() => {
        // Silent (§5.3 W8): the next visit tries again.
      });
  }, [storedZone, qc]);

  // train_hub_viewed: once per plan day.
  const viewedDay = useRef<string | null>(null);
  useEffect(() => {
    if (!today || viewedDay.current === today.dayKey) return;
    viewedDay.current = today.dayKey;
    trackTrain("train_hub_viewed", {
      state: viewedState(today),
      due_shown: today.due.shown,
      due_raw: today.due.raw,
      plan_done: Math.min(3, today.plan.done),
      plan_total: Math.min(3, today.plan.total),
      streak: today.streak.current,
    });
  }, [today]);

  const start = useStartSession({
    onStarted: () => {
      if (!today) return;
      const left = today.plan.steps.filter((s) => s.status !== "done");
      trackTrain("train_plan_started", {
        steps: Math.min(3, left.length),
        est_min: Math.min(120, left.reduce((n, s) => n + s.estMin, 0)),
        resumed: today.plan.cta.kind === "continue",
      });
    },
  });
  const startLimit = useRetryCountdown(start, { routeId: "train.sessions.create" });

  if (!today) {
    if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} object="today’s training" />;
    return <HubSkeleton />;
  }

  const rolledOver = currentDayKey !== undefined && today.dayKey !== currentDayKey;
  const tz = safeTimeZone(today.prefs.timeZone);
  const nextDay = today.nextBatch ? dayWord(today.nextBatch.at, now, tz) : null;

  return (
    <TrainHubView
      today={today}
      nextDay={nextDay}
      planLoading={rolledOver && query.isFetching}
      onStart={() => start.mutate({ kind: "daily", source: "plan" })}
      starting={start.isPending || start.isSuccess}
      startLimit={startLimit}
      onFollow={(target) => trackTrain("train_hub_link_clicked", { target })}
    />
  );
}
