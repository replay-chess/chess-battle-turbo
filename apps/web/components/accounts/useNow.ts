"use client";

// A wall clock for the connected-accounts cards: the rate-limit countdown needs a 1 s tick while it runs; the
// "Last sync 2 hours ago" lines only need a refresh every 30 s. The first render uses the server's clock (so the
// relative times hydrate without a mismatch), then the browser's.
import { useEffect, useState } from "react";

export const FAST_TICK_MS = 1_000;
export const SLOW_TICK_MS = 30_000;

export function useNow(initialMs: number, fast: boolean): number {
  const [now, setNow] = useState(initialMs);
  useEffect(() => {
    setNow(Date.now());
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), fast ? FAST_TICK_MS : SLOW_TICK_MS);
    return () => clearInterval(t);
  }, [fast]);
  return now;
}
