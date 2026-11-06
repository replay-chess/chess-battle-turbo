// Server clock arithmetic (plan 8.4). Pure: callers pass `now` (server epoch ms; the socket may feed a monotonic
// clock mapped to epoch). Wire clocks are `{w, b, run, at}`: the `run` side counts down from its value at `at`.

import {
  LAG_CREDIT_GAME_CAP_RATIO,
  LAG_CREDIT_MAX_MS,
  PREMOVE_MIN_SPEND_MS,
  RTT_ALPHA,
  RTT_START_MS,
} from "../constants";
import type { Clocks, Side } from "../machine/types";

export interface ClockRules {
  lagCreditMaxMs: number;
  lagCreditGameCap: number;
  premoveMinSpendMs: number;
}

export const DEFAULT_CLOCK_RULES: ClockRules = {
  lagCreditMaxMs: LAG_CREDIT_MAX_MS,
  lagCreditGameCap: LAG_CREDIT_GAME_CAP_RATIO,
  premoveMinSpendMs: PREMOVE_MIN_SPEND_MS,
};

export function initialClocks(initialMs: number, at: number): Clocks {
  return { w: initialMs, b: initialMs, run: null, at };
}

/** Remaining ms for `side` at `now`, unclamped (negative = flagged). */
export function remainingRaw(clocks: Clocks, side: Side, now: number): number {
  return clocks[side] - (clocks.run === side ? now - clocks.at : 0);
}

/** Remaining ms for display, clamped at 0. */
export function remaining(clocks: Clocks, side: Side, now: number): number {
  return Math.max(0, remainingRaw(clocks, side, now));
}

/** Values at `now`, with `at = now` (same running side). */
export function settle(clocks: Clocks, now: number): Clocks {
  return { w: remainingRaw(clocks, "w", now), b: remainingRaw(clocks, "b", now), run: clocks.run, at: now };
}

/** Stops both clocks at `at`; returns the stopped clocks and the side that was running. */
export function freezeClocks(clocks: Clocks, at: number): { clocks: Clocks; run: Side | null } {
  const s = settle(clocks, at);
  return { clocks: { ...s, w: Math.max(0, s.w), b: Math.max(0, s.b), run: null }, run: clocks.run };
}

/** Starts `run` from the current values at `at`. */
export function startClocks(clocks: Clocks, run: Side | null, at: number): Clocks {
  return { w: clocks.w, b: clocks.b, run, at };
}

/**
 * Lag credit for one move: 0 for a premove; min(rtt/2, cap) bounded by the per-game budget. Whole milliseconds:
 * the RTT is an EWMA (fractional), and clocks are stored in `int` columns (a fractional clock made Postgres refuse
 * the checkpoint with 22P03).
 */
export function lagCredit(opts: {
  premove: boolean;
  rttMs: number;
  usedMs: number;
  initialMs: number;
  rules?: ClockRules;
}): number {
  const rules = opts.rules ?? DEFAULT_CLOCK_RULES;
  if (opts.premove) return 0;
  const budget = Math.max(0, rules.lagCreditGameCap * opts.initialMs - opts.usedMs);
  return Math.floor(Math.max(0, Math.min(opts.rttMs / 2, rules.lagCreditMaxMs, budget)));
}

export type MoveClockResult =
  | { flagged: true; remainingMs: number }
  | { flagged: false; clocks: Clocks; clockMs: number; spentMs: number; lagCreditMs: number };

/**
 * Charges a move by `mover` at `now` (plan 8.4): spent = max(premove ? 100 : 0, now − turnStart − lagCredit);
 * if the mover's clock minus spent is ≤ 0 the move flags instead; otherwise clock − spent + increment and the
 * opponent's clock starts at `now`.
 */
export function chargeMove(opts: {
  clocks: Clocks;
  mover: Side;
  now: number;
  premove: boolean;
  rttMs: number;
  lagUsedMs: number;
  initialMs: number;
  incrementMs: number;
  rules?: ClockRules;
}): MoveClockResult {
  const rules = opts.rules ?? DEFAULT_CLOCK_RULES;
  const turnStart = opts.clocks.run === opts.mover ? opts.clocks.at : opts.now;
  const credit = lagCredit({
    premove: opts.premove,
    rttMs: opts.rttMs,
    usedMs: opts.lagUsedMs,
    initialMs: opts.initialMs,
    rules,
  });
  const spent = Math.max(opts.premove ? rules.premoveMinSpendMs : 0, opts.now - turnStart - credit);
  const left = opts.clocks[opts.mover] - spent;
  if (left <= 0) return { flagged: true, remainingMs: left };
  const after = left + opts.incrementMs;
  const other: Side = opts.mover === "w" ? "b" : "w";
  const clocks: Clocks = {
    w: opts.mover === "w" ? after : remainingRaw(opts.clocks, "w", opts.now),
    b: opts.mover === "b" ? after : remainingRaw(opts.clocks, "b", opts.now),
    run: other,
    at: opts.now,
  };
  return {
    flagged: false,
    clocks,
    clockMs: after,
    spentMs: spent,
    lagCreditMs: Math.min(credit, Math.max(0, opts.now - turnStart)),
  };
}

/** RTT EWMA (α = 0.2, start 150 ms). */
export function ewma(prev: number | undefined, sample: number, alpha = RTT_ALPHA): number {
  if (prev === undefined || !Number.isFinite(prev)) return sample;
  return prev + alpha * (sample - prev);
}

export const RTT_START = RTT_START_MS;

/** When the running side flags (absolute ms), or null when no clock runs. */
export function flagAt(clocks: Clocks): number | null {
  if (!clocks.run) return null;
  return clocks.at + clocks[clocks.run];
}

/** Per-move time spent, derived for reviews: spent_i = clock_{i−2} − clock_i + increment. */
export function spentFromClocks(clocksMs: readonly number[], initialMs: number, incrementMs: number): number[] {
  return clocksMs.map((c, i) => {
    const prev = i >= 2 ? clocksMs[i - 2]! : initialMs;
    return Math.max(0, prev - c + (i >= 2 ? incrementMs : 0));
  });
}
