// Day words and the training day for the hub and the bank, from `@repo/chess-training` (the server's own label and day
// rules, phase-05 plan §8.4, §8.14; browser-safe subpaths, no ts-fsrs). `NextBatch` carries the clock time
// (`atLabel`, server-formatted) but no day, so the day is derived from `at` in the member's zone against a `now` that
// the server render and the hydration share (the page passes its request time), so SSR and hydration print the same
// word. After mount the page's clock keeps running from that server time (`useClientNow`: the server's instant plus the
// time elapsed on the device), never from the device's own date: the plan, its `dayKey`, `nextBatch` and the server's
// own labels were made with the server's clock, and a device clock that is off (a phone set by hand, a skewed laptop)
// must not relabel tomorrow's batch "today", see a day rollover the server has not reached, or skip the release timer
// (regression: hub-device-clock, CI 43620776665 bank-states "arrive today at 08:00" for a batch due tomorrow).
import { useEffect, useState } from "react";
import type { NextBatch } from "@repo/contracts/http/train";
import { dayKey, trainingDayKeyAt } from "@repo/chess-training/day";
import { dayKeyLabel, dayLabel } from "@repo/chess-training/labels";

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
 * batch Saturday 08:00"). Null when the instant does not parse. Days are the member's training days (`dayStartHour`,
 * P5-FZ-4), the days the hub's header, plan, cap and streak count: at 01:00 Sunday (Saturday's training day) a batch
 * at 08:00 Sunday arrives "tomorrow". `todayKey` is the day the header names (R1's `dayKey`) when the caller shows one:
 * a day pinned by a zone or day-start change outlasts the new zone's rollover, and the words must count from it
 * (regression: hub-pinned-day-words, "SATURDAY" over "arrive today at 08:00" at 04:07 Sunday).
 */
export function dayWord(atIso: string, nowMs: number, timeZone: string, dayStartHour: number, todayKey?: string): string | null {
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) return null;
  const label = dayLabel(new Date(atMs), new Date(nowMs), safeTimeZone(timeZone), { long: true, dayStartHour, ...(todayKey ? { todayKey } : {}) });
  return label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label;
}

/**
 * The next batch's day word on the page's clock (FIX-4, D-P6-FIX4-2): from the training day the page is in to the
 * training day the batch is served on, both from the payload's own days (`todayKey` until `todayEndsAt`, then the
 * zone's days), so a day pinned by a zone change reads the same words as the server's `whenLabel` and the hub's
 * header. A payload from an older build (no day keys): `dayWord` on `at`.
 */
export function batchDayWord(nb: NextBatch, nowMs: number, timeZone: string, dayStartHour: number, todayKey?: string): string | null {
  const dsh = nb.dayStartHour ?? dayStartHour;
  if (!nb.dayKey || !nb.todayKey || !nb.todayEndsAt || !Number.isFinite(Date.parse(nb.todayEndsAt))) return dayWord(nb.at, nowMs, timeZone, dsh, todayKey);
  const today = trainingDayKeyAt(new Date(nowMs), safeTimeZone(timeZone), dsh, { key: nb.todayKey, end: new Date(nb.todayEndsAt) });
  const label = dayKeyLabel(nb.dayKey, today, { long: true });
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
 * The page's clock: the server's instant at render (`serverNowMs`) plus the device time elapsed since `anchorDeviceMs`
 * (the device clock when the page took that instant). Only differences of the device clock are used, so its offset
 * from the server's never enters a label or a day.
 */
export function anchoredNow(serverNowMs: number, anchorDeviceMs: number, deviceNowMs: number): number {
  return serverNowMs + (deviceNowMs - anchorDeviceMs);
}

/** `() => now` on the page's clock (anchored to `serverNowMs` when the component first rendered on this device). */
export function useServerClock(serverNowMs: number): () => number {
  const [anchor] = useState(() => ({ serverNowMs, deviceMs: Date.now() }));
  return () => anchoredNow(anchor.serverNowMs, anchor.deviceMs, Date.now());
}

/**
 * `serverNowMs` for the first render (the same on the server and in hydration), then the page's clock (`useServerClock`):
 * read on mount, on every `visibilitychange` to visible and, with `tickMs`, every `tickMs` while the tab is visible (a
 * pure clock check: no request). The hub ticks it each minute to notice the day rollover.
 */
export function useClientNow(serverNowMs: number, tickMs?: number): number {
  const clock = useServerClock(serverNowMs);
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const read = () => setNow(clock());
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
    // `clock` reads a state that never changes after the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickMs]);
  return now;
}
