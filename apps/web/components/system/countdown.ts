// Countdown maths for the rate-limit UI (plan §4.8, §8.9; V3RateLimited).
//
// Pure and React-free so it is unit-tested with a fake clock (countdown.test.ts) and shared by
// useRetryCountdown (inline) and the /too-many-requests page.
//
// Rule (IS §3.6): count down from the seconds the server sent, using monotonic `performance.now()`
// deltas, never absolute times, so a client clock that is minutes off still shows the right wait.
// The label is `m:ss`; the tick is 250 ms so the label never lags a second behind.

/** Render tick (plan §8.9). */
export const COUNTDOWN_TICK_MS = 250;

/** What a 429 without a usable Retry-After waits (the route wrapper's own default). */
export const DEFAULT_RETRY_AFTER_SEC = 30;

/** Upper bound for any received wait: one day (the analytics schema's ceiling). */
export const MAX_RETRY_AFTER_SEC = 86_400;

/** `m:ss` from seconds, rounded up (0 → "0:00", 65 → "1:05", 3600 → "60:00"). Negative and NaN → "0:00". */
export function formatMmSs(totalSec: number): string {
  const s = Number.isFinite(totalSec) ? Math.max(0, Math.ceil(totalSec)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A received wait as whole seconds within [0, MAX_RETRY_AFTER_SEC]. `undefined`, NaN or a negative value
 * falls back to `fallback` (30 s).
 */
export function normalizeRetryAfter(value: unknown, fallback: number = DEFAULT_RETRY_AFTER_SEC): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return fallback;
  return Math.min(MAX_RETRY_AFTER_SEC, Math.ceil(n));
}

/** Seconds left (fractional, ≥ 0) of a `totalSec` wait that started at `startedAtMs` on the same monotonic clock. */
export function remainingSec(totalSec: number, startedAtMs: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - startedAtMs) / 1000;
  return Math.max(0, totalSec - elapsed);
}

export type Countdown = {
  readonly totalSec: number;
  /** Seconds left, fractional. */
  remaining(): number;
  /** The `m:ss` label of `remaining()`. */
  label(): string;
  done(): boolean;
  /** Whole seconds waited so far (for `rate_limited_retry.waited_sec`). */
  waitedSec(): number;
};

/** The default monotonic clock; `Date.now` only where `performance` is missing (very old engines). */
export function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** A countdown from `totalSec`, started now on `clock` (injectable for tests). */
export function startCountdown(totalSec: number, clock: () => number = monotonicNow): Countdown {
  const total = normalizeRetryAfter(totalSec);
  const startedAt = clock();
  const remaining = () => remainingSec(total, startedAt, clock());
  return {
    totalSec: total,
    remaining,
    label: () => formatMmSs(remaining()),
    done: () => remaining() <= 0,
    waitedSec: () => Math.round(Math.max(0, clock() - startedAt) / 1000),
  };
}
