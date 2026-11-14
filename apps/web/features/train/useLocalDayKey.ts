"use client";

// The member's current training day on the client (phase-05 plan §5.2 S2 "Day rollover"): `dayKey(now, timeZone,
// dayStartHour)` from `@repo/chess-training/day` (the server's own rule), re-checked when the tab becomes visible and
// every 60 s while it is visible. A pure clock check: no request. The hub passes it to `trainTodayQuery(dayKey)`, whose
// stale time drops to 0 once the cached plan belongs to another day, so the plan refetches once at the rollover.
import { dayKey } from "@repo/chess-training/day";
import { useEffect, useState } from "react";

export const DAY_TICK_MS = 60_000;

/** Today's key, or null when the zone is not a valid IANA name (the caller then trusts the server's key). */
export function safeDayKey(now: Date, timeZone: string, dayStartHour: number): string | null {
  try {
    return dayKey(now, timeZone, dayStartHour);
  } catch {
    return null;
  }
}

export function useLocalDayKey(timeZone: string, dayStartHour: number, initial: string | null = null): string | null {
  const [key, setKey] = useState<string | null>(initial);
  useEffect(() => {
    const check = () => setKey(safeDayKey(new Date(), timeZone, dayStartHour));
    check();
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer !== null) clearInterval(timer);
      timer = document.visibilityState === "visible" ? setInterval(check, DAY_TICK_MS) : null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== null) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [timeZone, dayStartHour]);
  return key;
}
