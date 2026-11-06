"use client";

// Countdowns rendered from absolute `endsAt` values on the server clock (P2 plan 5.2.7): study, first move,
// reconnect grace, opponent grace, rematch offer. Ticks every 250 ms only while mounted and not yet at zero.

import { useEffect, useState } from "react";
import { formatCountdown } from "@repo/game-core/clock/format";

const TICK_MS = 250;

export interface Countdown {
  ms: number;
  /** "0:30" (whole seconds, rounded up). */
  text: string;
  /** 0..1 of `totalMs` elapsed, for the SVG ring's dash offset. */
  progress: number;
}

/**
 * `initialNow` must be the same on the server and the client (the snapshot's `serverNow`) so the first render
 * hydrates; the interval takes over right after.
 */
export function useCountdown(
  endsAt: number | null,
  serverNow: () => number,
  totalMs: number,
  initialNow?: number,
): Countdown {
  const [now, setNow] = useState(() => initialNow ?? serverNow());
  const left = endsAt === null ? 0 : Math.max(0, endsAt - now);

  useEffect(() => {
    if (endsAt === null) return;
    setNow(serverNow());
    const id = setInterval(() => {
      const t = serverNow();
      setNow(t);
      if (t >= endsAt) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [endsAt, serverNow]);

  return {
    ms: left,
    text: formatCountdown(left),
    progress: totalMs > 0 ? Math.min(1, Math.max(0, 1 - left / totalMs)) : 1,
  };
}

/** Circumference of the r=15 ring in the design's 36×36 viewBox. */
export const RING_LENGTH = 94.25;
