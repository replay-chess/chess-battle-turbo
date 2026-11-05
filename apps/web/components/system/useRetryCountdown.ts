"use client";

// useRetryCountdown (plan §4.8, §5.6; V3RateLimited `inline` → `inline_ready`): the state behind an inline 429.
//
//   const load = useMutation({ mutationFn, meta: { errorUi: "inline" } });
//   const rl = useRetryCountdown(load, { routeId: "catalog.openings.index" });
//   <Button {...rl.controlProps} onClick={() => { if (!rl.limited) load.mutate(); }}>Look Up Profile</Button>
//   <RetryCountdown countdown={rl} />
//
// - `limited` while a `rate_limited` ApiError's wait runs; the control stays focusable with `aria-disabled` and
//   `aria-describedby` pointing at the countdown row (`controlProps`).
// - Counts down from the received `retryAfterSec` with performance.now() deltas (countdown.ts); per tab.
// - At 0:00 → `ready`: the row goes away and `onReady` runs once (queries pass `refetch`; mutations wait for a click).
// - Telemetry: `rate_limited_shown` once per 429, `rate_limited_retry` on the first outcome after `ready`.
import { useEffect, useId, useRef, useState } from "react";
import { isApiError, type ApiError } from "@/lib/api/errors";
import { bucketOf, routeIdForPath, trackSystem } from "@/lib/analytics/system-events";
import { COUNTDOWN_TICK_MS, formatMmSs, normalizeRetryAfter, startCountdown, type Countdown } from "./countdown";

/** The parts of a TanStack query or mutation result the hook reads. */
export type RetrySource = { error: unknown; status: string };

export type UseRetryCountdownOptions = {
  /** Registry id for telemetry; derived from the error's path when omitted. */
  routeId?: string;
  /** Runs once when the wait ends (queries: `refetch`). */
  onReady?: () => unknown;
  /** Telemetry surface. Default "inline". */
  surface?: "inline" | "page";
};

export type RetryCountdownState = {
  /** A rate-limit wait is running. */
  limited: boolean;
  /** A rate-limit wait ran out and the control is usable again (`inline_ready`). */
  ready: boolean;
  /** Seconds left (fractional). */
  left: number;
  /** `m:ss`. */
  label: string;
  /** The countdown row's id (for aria-describedby). */
  rowId: string;
  /** Spread on the host control. */
  controlProps: { "aria-disabled"?: true; "aria-describedby"?: string };
  /** The 429 that started the wait. */
  error: ApiError | null;
};

export function rateLimitError(err: unknown): ApiError | null {
  return isApiError(err) && err.code === "rate_limited" ? err : null;
}

type Running = { error: ApiError; countdown: Countdown; left: number };

export function useRetryCountdown(source: RetrySource, options: UseRetryCountdownOptions = {}): RetryCountdownState {
  const { routeId, onReady, surface = "inline" } = options;
  const limitedError = rateLimitError(source.error);
  const rowId = `rc-retry-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [running, setRunning] = useState<Running | null>(null);

  // Latest callbacks without restarting the timer.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // After a wait ends, the next outcome is the retry result.
  const pendingRetry = useRef<{ error: ApiError; routeId: string; waitedSec: number } | null>(null);

  useEffect(() => {
    if (!limitedError) return;
    const resolvedRoute = routeId ?? routeIdForPath(limitedError.path);

    // A new 429 right after a finished wait is the retry's outcome.
    const pending = pendingRetry.current;
    if (pending && pending.error !== limitedError) {
      trackSystem("rate_limited_retry", {
        route_id: pending.routeId,
        waited_sec: pending.waitedSec,
        result: "limited_again",
      });
      pendingRetry.current = null;
    }

    const countdown = startCountdown(normalizeRetryAfter(limitedError.retryAfterSec));
    setRunning({ error: limitedError, countdown, left: countdown.remaining() });
    trackSystem("rate_limited_shown", {
      route_id: resolvedRoute,
      bucket: bucketOf(limitedError.details),
      retry_after_sec: countdown.totalSec,
      surface,
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(id);
      pendingRetry.current = { error: limitedError, routeId: resolvedRoute, waitedSec: countdown.waitedSec() };
      setRunning((r) => (r && r.error === limitedError ? { ...r, left: 0 } : r));
      void onReadyRef.current?.();
    };
    const tick = () => {
      const left = countdown.remaining();
      if (left <= 0) finish();
      else setRunning((r) => (r && r.error === limitedError ? { ...r, left } : r));
    };
    const id = setInterval(tick, COUNTDOWN_TICK_MS);
    if (countdown.done()) finish();
    return () => clearInterval(id);
  }, [limitedError, routeId, surface]);

  // The first success after a finished wait.
  useEffect(() => {
    const pending = pendingRetry.current;
    if (!pending || source.status !== "success") return;
    trackSystem("rate_limited_retry", { route_id: pending.routeId, waited_sec: pending.waitedSec, result: "ok" });
    pendingRetry.current = null;
  }, [source.status]);

  // Until the effect has started the timer for a new 429, show its full wait (no flash of an enabled control).
  const current = limitedError && running?.error === limitedError ? running : null;
  const left = limitedError ? (current ? current.left : normalizeRetryAfter(limitedError.retryAfterSec)) : 0;
  const limited = Boolean(limitedError) && left > 0;
  const ready = Boolean(limitedError) && !limited;

  return {
    limited,
    ready,
    left,
    label: formatMmSs(left),
    rowId,
    controlProps: limited ? { "aria-disabled": true, "aria-describedby": rowId } : {},
    error: limitedError,
  };
}
