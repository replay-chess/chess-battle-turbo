// The import window and the Chess.com month plan (phase-04 plan §8.6 "Window" and "Reading phase" step 3), pure so
// the worker handler (WK/src/jobs/import-sync.ts) and its tests share one rule:
//
// - window start = the first day (UTC) of the month `IMPORT_WINDOW_MONTHS` (12) months before now; games that end
//   before it are dropped;
// - initial run → every archive month at or after the window start, newest first;
// - incremental run → the current month, every month newer than the newest one stored, and the previous month during
//   the first two days of a month (games that finish across midnight UTC on the 1st), skipping months marked done.
import { compareMonthKeys } from "./chesscom/client";
import type { MonthKey } from "./chesscom/types";

export const IMPORT_WINDOW_MONTHS_DEFAULT = 12;
export const IMPORT_MAX_GAMES_DEFAULT = 2000;

/** ms of 00:00 UTC on the first day of the month `months` months before `nowMs`. */
export function importWindowStart(nowMs: number, months: number = IMPORT_WINDOW_MONTHS_DEFAULT): number {
  if (!Number.isInteger(months) || months < 1) throw new RangeError("IMPORT_WINDOW_MONTHS must be a positive integer");
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1);
}

/** `"2026/10"` for a UTC instant. */
export function monthKeyOf(ms: number): MonthKey {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}` as MonthKey;
}

/** The month key before `key` (`"2026/01"` → `"2025/12"`). */
export function previousMonthKey(key: MonthKey): MonthKey {
  const [y, m] = key.split("/").map(Number) as [number, number];
  return monthKeyOf(Date.UTC(y, m - 2, 1));
}

export interface StoredMonth {
  done: boolean;
}

export interface MonthPlanInput {
  nowMs: number;
  /** Months the provider lists (`getArchives`), any order. */
  archiveMonths: readonly MonthKey[];
  /** `import_cursors.archives.months` (`ArchivesV1`); empty on an initial run. */
  stored: Readonly<Record<string, StoredMonth>>;
  /** `INITIAL` runs read the whole window; `DAILY`, `MANUAL` and `RETRY` runs are incremental. */
  initial: boolean;
  windowMonths?: number;
}

/** Months to fetch, newest first (§8.6 step 3). */
export function monthsToFetch(input: MonthPlanInput): MonthKey[] {
  const startKey = monthKeyOf(importWindowStart(input.nowMs, input.windowMonths));
  const listed = [...new Set(input.archiveMonths)].filter((k) => compareMonthKeys(k, startKey) >= 0);
  listed.sort((a, b) => compareMonthKeys(b, a));
  if (input.initial) return listed;

  const current = monthKeyOf(input.nowMs);
  const storedKeys = Object.keys(input.stored).sort(compareMonthKeys);
  const newestStored = storedKeys.at(-1) ?? null;
  const dayOfMonth = new Date(input.nowMs).getUTCDate();
  const previous = previousMonthKey(current);
  return listed.filter((k) => {
    const s = input.stored[k];
    if (s?.done) return false;
    if (k === current) return true;
    if (newestStored === null || compareMonthKeys(k, newestStored) > 0) return true;
    if (dayOfMonth <= 2 && k === previous) return true;
    // A stored month that is not done was the current month when it was last read (a sync that lapsed past the
    // 2nd would otherwise miss its last days). The conditional GET makes the re-read a 304 when nothing changed.
    return s !== undefined;
  });
}
