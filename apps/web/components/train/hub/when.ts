// Day words and the training day for the hub and the bank, from `@repo/chess-training` (the server's own label and day
// rules, phase-05 plan §8.4, §8.14; browser-safe subpaths, no ts-fsrs). `NextBatch` carries the clock time
// (`atLabel`, server-formatted) but no day, so the day is derived from `at` in the member's zone against a `now` that
// the server render and the hydration share (the page passes its request time; `useClientNow` swaps in the device
// clock after mount), so SSR and hydration print the same word.
import { useEffect, useState } from "react";
import { dayKey } from "@repo/chess-training/day";
import { dayLabel } from "@repo/chess-training/labels";

/** A zone the runtime accepts, else UTC (a stale or hand-edited zone never breaks the page). */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * "today" | "tomorrow" | "Saturday" | "Nov 25" for an ISO instant, mid-sentence ("arrive tomorrow at 08:00", "Next
 * batch Saturday 08:00"). Null when the instant does not parse.
 */
export function dayWord(atIso: string, nowMs: number, timeZone: string): string | null {
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) return null;
  const label = dayLabel(new Date(atMs), new Date(nowMs), safeTimeZone(timeZone), { long: true });
  return label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label;
}

/** The member's training day ("YYYY-MM-DD", rolling over at `dayStartHour` local): a change means a new plan. */
export function localDayKey(nowMs: number, timeZone: string, dayStartHour: number): string {
  return dayKey(new Date(nowMs), safeTimeZone(timeZone), dayStartHour);
}

/** The device's zone, or null where Intl cannot tell. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * `serverNowMs` for the first render (the same on the server and in hydration), then the device clock: read on mount,
 * on every `visibilitychange` to visible and, with `tickMs`, every `tickMs` while the tab is visible (a pure clock
 * check: no request). The hub ticks it each minute to notice the day rollover.
 */
export function useClientNow(serverNowMs: number, tickMs?: number): number {
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const read = () => setNow(Date.now());
    read();
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = tickMs
      ? setInterval(() => {
          if (document.visibilityState === "visible") read();
        }, tickMs)
      : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [tickMs]);
  return now;
}
