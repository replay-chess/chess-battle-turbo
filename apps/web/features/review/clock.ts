"use client";

// A one-second wall clock for countdowns (the failed card's "Trying again in N s"), read only after hydration.
//
// The server and the hydrating client both see `null` (getServerSnapshot), so the HTML never carries a time that the
// client would render one second later as a different number (a React hydration error). The snapshot is also `null`
// until something subscribes, so a client-side mount never shows a stale time: React subscribes after the commit,
// the subscription starts the clock and sets the time, and React re-renders with it.
import { useSyncExternalStore } from "react";

const TICK_MS = 1000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now: number | null = null;

export function subscribeClock(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of [...listeners]) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      now = null;
    }
  };
}

/** The last tick's time while the clock runs, else null. */
export function clockSnapshot(): number | null {
  return now;
}

const serverSnapshot = (): number | null => null;
const idle = () => () => undefined;

/** `Date.now()` refreshed every second while `active`; null on the server, during hydration and while inactive. */
export function useClientNow(active: boolean): number | null {
  return useSyncExternalStore(active ? subscribeClock : idle, active ? clockSnapshot : serverSnapshot, serverSnapshot);
}
