// The clock before a move (phase-06 plan §8.3.1, §6.4, §8.12). One function feeds STATS_V1 slots 7–14, the
// ERROR_LOG_V1 clock bucket and the bank's `rc:timePressure` tag, so the three can never disagree.
//
// `games."moveClocksMs"[i]` is the mover's remaining time in ms AFTER ply offset i (increment included; data-model D1).
// The time a side had BEFORE ply offset p is therefore the same side's value two plies earlier, or the initial time for
// the first move of each side: clockBefore(p) = p ≥ 2 ? moveClocksMs[p − 2] : initialMs. `p` is the ply offset from
// `games."startPly"` (a game from a FEN starts at offset 0 too).
//
// Unknown (null): an untimed game (empty `moveClocksMs`), a DAILY or UNTIMED time class, a missing or invalid index,
// or no initial time for the first two plies. Pure; no I/O.

/** Bucket edges in ms: lt1 < 60 000 ≤ 1to2 < 120 000 ≤ 2to5 < 300 000 ≤ gt5 (plan §8.1 CLOCK_EDGES_MS). */
export const CLOCK_EDGES_MS = [60_000, 120_000, 300_000] as const;

/** Under one minute on the mover's clock before the move: the time-pressure rule (plan §8.1 TIME_PRESSURE_MS). */
export const TIME_PRESSURE_MS = 60_000;

/**
 * Clock bucket codes as ERROR_LOG_V1 stores them (bits 7–9): 0 unknown or untimed, 1 > 5 min, 2 2–5 min, 3 1–2 min,
 * 4 < 1 min. STATS_V1 slots 7–10 / 11–14 are buckets 1…4 in that order (gt5, 2to5, 1to2, lt1).
 */
export const CLOCK_BUCKET = { UNKNOWN: 0, GT5: 1, TWO_TO_5: 2, ONE_TO_2: 3, LT1: 4 } as const;
export type ClockBucket = (typeof CLOCK_BUCKET)[keyof typeof CLOCK_BUCKET];

/** Wire keys of buckets 1…4 (the weakness payload's clock histogram), index = bucket − 1. */
export const CLOCK_BUCKET_KEYS = ["gt5", "2to5", "1to2", "lt1"] as const;
export type ClockBucketKey = (typeof CLOCK_BUCKET_KEYS)[number];

/** Time classes whose clocks never count (correspondence and untimed play). */
const NO_CLOCK_CLASSES: ReadonlySet<string> = new Set(["DAILY", "UNTIMED"]);

/** The `games` columns the clock reads. */
export interface ClockGame {
  /** games."moveClocksMs": the mover's remaining ms after each ply offset; empty for untimed games. */
  moveClocksMs: readonly number[];
  /** games."initialTimeSeconds". */
  initialTimeSeconds: number | null;
  /** games."timeClass" (TimeClass enum name); null for legacy rows. */
  timeClass: string | null;
}

function validMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** True when the game's clocks can be read at all (timed, recorded). */
export function hasClocks(game: ClockGame): boolean {
  return game.moveClocksMs.length > 0 && !(game.timeClass !== null && NO_CLOCK_CLASSES.has(game.timeClass));
}

/** The mover's remaining ms before ply offset `p`, or null when unknown (see the header). */
export function clockBefore(game: ClockGame, p: number): number | null {
  if (!Number.isInteger(p) || p < 0 || !hasClocks(game)) return null;
  if (p >= 2) {
    const v = game.moveClocksMs[p - 2];
    return validMs(v) ? v : null;
  }
  const initial = game.initialTimeSeconds;
  return typeof initial === "number" && Number.isFinite(initial) && initial > 0 ? initial * 1000 : null;
}

/** ms → bucket code 1…4, or 0 for unknown. */
export function clockBucket(ms: number | null | undefined): ClockBucket {
  if (!validMs(ms)) return CLOCK_BUCKET.UNKNOWN;
  if (ms < CLOCK_EDGES_MS[0]) return CLOCK_BUCKET.LT1;
  if (ms < CLOCK_EDGES_MS[1]) return CLOCK_BUCKET.ONE_TO_2;
  if (ms < CLOCK_EDGES_MS[2]) return CLOCK_BUCKET.TWO_TO_5;
  return CLOCK_BUCKET.GT5;
}

/** The bucket of the clock before ply offset `p`. */
export function clockBucketBefore(game: ClockGame, p: number): ClockBucket {
  return clockBucket(clockBefore(game, p));
}

/** The `rc:timePressure` rule (plan §8.12): the clock before ply offset `p` is known and under one minute. */
export function isTimePressure(game: ClockGame, p: number): boolean {
  const ms = clockBefore(game, p);
  return ms !== null && ms < TIME_PRESSURE_MS;
}

/** Bucket code 1…4 → its wire key; null for 0 (unknown). */
export function clockBucketKey(bucket: number): ClockBucketKey | null {
  return bucket >= 1 && bucket <= 4 ? (CLOCK_BUCKET_KEYS[bucket - 1] as ClockBucketKey) : null;
}
