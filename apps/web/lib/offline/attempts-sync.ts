// The attempts outbox wired to the app (phase-05 plan §5.3, §5.4): the W1 sender, one scheduler per user per tab, and
// the tab-wide reaction to every flush result, whichever screen is mounted (the runner, or the next app load after an
// offline drill). Loaded on demand: the runner imports it, and `useOutboxSync()` in the (app) layout imports it only
// when something is queued, so the other routes' first load never carries it.
//
// A result does, once per tab:
//   - `bankDue` → the badge, the viewer payload and Home (`applyBankDue`, no fetch);
//   - today's plan, every bank list and Home → stale here and in the other tabs (`markStaleEverywhere`);
//   - telemetry from the result: conflicts, puzzle rating, milestones, streak, plan steps, the offline flush;
//   - a whole-batch 402 → the paywall (`reactToApiError`), the queue kept for when membership resumes;
//   - a dropped (invalid) attempt → a Sentry breadcrumb;
//   - Sentry (plan §10.2): `train.outbox.age_s` (the batch's oldest attempt, on every applied flush); a failed flush is
//     a breadcrumb, and the 3rd consecutive failure is captured once (`train.outbox.flush_failed`, FIX-2).
// The runner subscribes to the same events for its own patches (rating chip, streak, capRemaining, toasts).
import type { AttemptIn, AttemptsResult, TrainToday } from "@repo/contracts/http/train";
import { AttemptsResult as AttemptsResultSchema } from "@repo/contracts/http/train";
import type { QueryClient } from "@tanstack/react-query";
import { trackTrain } from "@/lib/analytics/train-events";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { reactToApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { applyBankDue } from "@/lib/realtime/handlers/train";
import { withSentry } from "@/lib/sentry/lazy";
import { mayFlushFor } from "./active-user";
import { markStaleEverywhere } from "./crossTab";
import { createOutboxScheduler, subscribeOutbox, type AttemptsSender, type OutboxEvent, type OutboxScheduler } from "./outbox";

/** W1. The schema check runs in dev and test builds only (lib/api/schema.ts). */
export const sendAttempts: AttemptsSender = async (attempts, { keepalive }) => {
  const schema = process.env.NODE_ENV === "production" ? undefined : AttemptsResultSchema;
  const { data } = await api(endpoints.trainAttempts, { method: "POST", body: { attempts }, keepalive, schema });
  return data as AttemptsResult;
};

const schedulers = new Map<string, OutboxScheduler>();

/** Thrown by the sender when the browser's session is not the queue's member: a retry later, never a result. */
export class OtherUserError extends Error {
  readonly status = 0;
  readonly code = "other_user";
  constructor() {
    super("the signed-in member is not this queue's member");
  }
}

/**
 * The sender of `userRef`'s queue: refuses (retry later, the queue untouched) while another member is signed in, so a
 * pending retry or a still-mounted runner of A never sends A's attempts with B's cookie (the server would answer
 * `not_found` for A's sessions and the outbox would drop them: FIX-1).
 */
export function guardedSender(userRef: string, send: AttemptsSender): AttemptsSender {
  return async (attempts, opts) => {
    if (!mayFlushFor(userRef)) throw new OtherUserError();
    return send(attempts, opts);
  };
}

/** The tab's scheduler for this user (shared by the runner and the layout). */
export function getAttemptsScheduler(userRef: string, send: AttemptsSender = sendAttempts): OutboxScheduler {
  let s = schedulers.get(userRef);
  if (!s) {
    s = createOutboxScheduler(userRef, { send: guardedSender(userRef, send) });
    schedulers.set(userRef, s);
  }
  return s;
}

/** Stops and forgets `userRef`'s scheduler (its timers too): the layout unmounting, a switch to another member. */
export function disposeAttemptsScheduler(userRef: string): void {
  schedulers.get(userRef)?.dispose();
  schedulers.delete(userRef);
}

/** Every scheduler but `keep`'s (a sign-in as another member in the same document). */
export function disposeOtherSchedulers(keep: string | null): void {
  for (const ref of [...schedulers.keys()]) if (ref !== keep) disposeAttemptsScheduler(ref);
}

/** The keys an applied batch makes stale (§5.3 "Grade attempts" row). */
export const ATTEMPT_STALE_KEYS = [qk.train.today(), ["train", "bank"] as const, qk.home()];

/** Plan bit i = step i done; the newly set bits of `after` over `before`. */
export function newPlanSteps(before: number, after: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) if ((after & (1 << i)) !== 0 && (before & (1 << i)) === 0) out.push(i);
  return out;
}

/** The plan bitmask the cached hub shows (step i done = bit i). */
export function planBitsOf(today: TrainToday | undefined): number {
  if (!today) return 0;
  return today.plan.steps.reduce((bits, s, i) => (s.status === "done" ? bits | (1 << i) : bits), 0);
}

/** Seconds from the batch's oldest `reviewedAt` to `now` (0 for an empty or undated batch). */
export function oldestAgeSeconds(attempts: readonly AttemptIn[], now: number): number {
  const oldest = Math.min(...attempts.map((a) => Date.parse(a.reviewedAt)).filter(Number.isFinite));
  return Number.isFinite(oldest) ? Math.max(0, Math.round((now - oldest) / 1000)) : 0;
}

/** Consecutive failed flushes after which one is captured (plan §10.2: breadcrumbs until 3 consecutive failures). */
export const FLUSH_FAILURES_ESCALATE_AT = 3;

/** The outbox's Sentry side (injectable for tests). */
export type OutboxSentry = {
  metric: (name: string, value: number, unit: string) => void;
  breadcrumb: (message: string, data: Record<string, unknown>) => void;
  capture: (message: string, extra: Record<string, unknown>) => void;
};

const sentryOutbox: OutboxSentry = {
  metric: (name, value, unit) => withSentry((Sentry) => Sentry.metrics.distribution(name, value, { unit })),
  breadcrumb: (message, data) => withSentry((Sentry) => Sentry.addBreadcrumb({ category: "train.outbox", level: "info", message, data })),
  capture: (message, extra) => withSentry((Sentry) => Sentry.captureMessage(message, { level: "warning", extra })),
};

/** Telemetry for one applied batch (no FEN, move, name or ref ever leaves). */
export function reportResultTelemetry(qc: QueryClient, attempts: readonly AttemptIn[], result: AttemptsResult, now: number, wasOffline: boolean): void {
  const kindOf = new Map(attempts.map((a) => [a.clientAttemptId, a.kind] as const));
  let duplicates = 0;
  let lastStreak: number | undefined;
  for (const r of result.results) {
    if (r.status === "duplicate") duplicates++;
    if (r.status === "conflict") trackTrain("train_attempt_conflict", { kind: kindOf.get(r.clientAttemptId) ?? "mistake" });
    if (r.status !== "ok") continue;
    if (r.rating && r.rating.delta !== 0) trackTrain("puzzle_rating_changed", { delta: r.rating.delta, rating: Math.max(0, r.rating.value), provisional: r.rating.provisional });
    if (r.theme?.milestone) trackTrain("theme_milestone_reached", { theme: r.theme.key, pct: r.theme.milestone });
    if (typeof r.dayStreak === "number") lastStreak = r.dayStreak;
  }
  const today = qc.getQueryData<TrainToday>(qk.train.today());
  if (today && lastStreak !== undefined) {
    if (lastStreak > today.streak.current) trackTrain("streak_extended", { days: lastStreak });
    else if (lastStreak < today.streak.current) trackTrain("streak_reset", { days_before: today.streak.current });
  }
  if (today) {
    for (const i of newPlanSteps(planBitsOf(today), result.planDone)) {
      const step = today.plan.steps[i];
      if (step) trackTrain("train_plan_step_completed", { step: i + 1, kind: step.kind });
    }
  }
  if (wasOffline) {
    const maxAge = oldestAgeSeconds(attempts, now);
    trackTrain("train_offline_flush", { items: Math.min(500, attempts.length), max_age_s: Math.min(30 * 86_400, maxAge), duplicates: Math.min(500, duplicates) });
  }
}

/**
 * The tab-wide reaction to the outbox (installed once per user by useOutboxSync and by the runner; a second install
 * for the same user is a no-op). Returns the uninstall function.
 */
export function installAttemptsSync(
  userRef: string,
  qc: QueryClient,
  opts: { isOnline?: () => boolean; now?: () => number; sentry?: OutboxSentry } = {},
): () => void {
  const key = `${userRef}`;
  const existing = installed.get(key);
  if (existing) {
    existing.count++;
    return () => release(key);
  }
  const isOnline = opts.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const now = opts.now ?? Date.now;
  const sentry = opts.sentry ?? sentryOutbox;
  let failures = 0;
  let offlineSince: number | null = isOnline() ? null : now();
  const onOffline = () => {
    offlineSince ??= now();
  };
  if (typeof window !== "undefined") window.addEventListener("offline", onOffline);
  const off = subscribeOutbox(userRef, (e: OutboxEvent) => {
    if (e.type === "result") {
      failures = 0;
      sentry.metric("train.outbox.age_s", oldestAgeSeconds(e.attempts, now()), "second");
      applyBankDue(qc, e.result.bankDue);
      markStaleEverywhere(qc, ATTEMPT_STALE_KEYS);
      const wasOffline = offlineSince !== null;
      if (wasOffline && isOnline()) offlineSince = null;
      reportResultTelemetry(qc, e.attempts, e.result, now(), wasOffline);
      // The plan bits after the batch, so the next batch only reports new steps.
      const today = qc.getQueryData<TrainToday>(qk.train.today());
      if (today) {
        qc.setQueryData<TrainToday>(qk.train.today(), {
          ...today,
          plan: { ...today.plan, steps: today.plan.steps.map((s, i) => ((e.result.planDone & (1 << i)) !== 0 ? { ...s, status: "done" } : s)) },
        });
      }
    } else if (e.type === "paywall") {
      reactToApiError(e.error, { kind: "outbox", queryClient: qc });
    } else if (e.type === "unauthorized") {
      reactToApiError(e.error, { kind: "outbox", queryClient: qc });
    } else if (e.type === "dropped") {
      withSentry((Sentry) =>
        Sentry.addBreadcrumb({ category: "train.outbox", level: "warning", message: "attempt dropped", data: { reason: e.reason, kind: e.attempt.kind } }),
      );
    } else if (e.type === "flushed" && (e.outcome.status === "retry" || e.outcome.status === "busy")) {
      sentry.breadcrumb(`flush ${e.outcome.status}`, { pending: e.outcome.pending });
      // A failed flush (network, 5xx, 429) is a breadcrumb; the 3rd in a row is captured once (another tab holding the
      // lock is not a failure).
      if (e.outcome.status === "retry") {
        failures += 1;
        if (failures === FLUSH_FAILURES_ESCALATE_AT) sentry.capture("train.outbox.flush_failed", { failures, pending: e.outcome.pending });
      }
    } else if (e.type === "flushed" && (e.outcome.status === "sent" || e.outcome.status === "empty")) {
      failures = 0;
    }
  });
  installed.set(key, {
    count: 1,
    dispose: () => {
      off();
      if (typeof window !== "undefined") window.removeEventListener("offline", onOffline);
    },
  });
  return () => release(key);
}

const installed = new Map<string, { count: number; dispose: () => void }>();

function release(key: string): void {
  const entry = installed.get(key);
  if (!entry) return;
  entry.count--;
  if (entry.count > 0) return;
  entry.dispose();
  installed.delete(key);
}
