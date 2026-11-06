// Time class, rating pool and labels (plan 8.11). estimated = initialSeconds + 40 × incrementSeconds.

import type { WireTimeClass } from "../machine/types";

/** Stored enum (`Game.timeClass`, data-model). DAILY is written only by imports (P4). */
export type TimeClass = "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL" | "DAILY" | "UNTIMED";
export type Pool = "Bullet" | "Blitz" | "Rapid";

export interface TimeControlSeconds {
  initialSeconds: number;
  incrementSeconds: number;
}

export function estimatedSeconds(tc: TimeControlSeconds): number {
  return tc.initialSeconds + 40 * tc.incrementSeconds;
}

export function timeClassOf(tc: TimeControlSeconds | null): TimeClass {
  if (!tc) return "UNTIMED";
  const e = estimatedSeconds(tc);
  if (e < 180) return "BULLET";
  if (e < 480) return "BLITZ";
  if (e < 1500) return "RAPID";
  return "CLASSICAL";
}

export function wireTimeClass(tc: TimeClass): WireTimeClass {
  switch (tc) {
    case "BULLET":
      return "bullet";
    case "BLITZ":
      return "blitz";
    case "RAPID":
      return "rapid";
    case "CLASSICAL":
    case "DAILY":
      return "classical";
    case "UNTIMED":
      return "untimed";
  }
}

/** Pool for labels and P9 ratings; CLASSICAL is grouped under Rapid (the design files 30+0 there). */
export function poolOf(tc: TimeClass | WireTimeClass): Pool | null {
  switch (tc.toUpperCase()) {
    case "BULLET":
      return "Bullet";
    case "BLITZ":
      return "Blitz";
    case "RAPID":
    case "CLASSICAL":
      return "Rapid";
    default:
      return null;
  }
}

/** "5+3" (minutes + increment seconds); sub-minute or odd starts show seconds ("15s+0"). */
export function tcLabel(tc: TimeControlSeconds | null): string {
  if (!tc) return "";
  const base = tc.initialSeconds % 60 === 0 ? String(tc.initialSeconds / 60) : `${tc.initialSeconds}s`;
  return `${base}+${tc.incrementSeconds}`;
}

/** "Blitz 5+3"; untimed → "Untimed". */
export function timeLabel(tc: TimeControlSeconds | null): string {
  if (!tc) return "Untimed";
  return `${poolOf(timeClassOf(tc)) ?? ""} ${tcLabel(tc)}`.trim();
}

/** The nine time controls of the design (plan 8.11), in display order. */
export const DESIGN_TIME_CONTROLS: readonly TimeControlSeconds[] = [
  { initialSeconds: 60, incrementSeconds: 0 },
  { initialSeconds: 120, incrementSeconds: 1 },
  { initialSeconds: 180, incrementSeconds: 0 },
  { initialSeconds: 180, incrementSeconds: 2 },
  { initialSeconds: 300, incrementSeconds: 0 },
  { initialSeconds: 300, incrementSeconds: 3 },
  { initialSeconds: 600, incrementSeconds: 0 },
  { initialSeconds: 900, incrementSeconds: 10 },
  { initialSeconds: 1800, incrementSeconds: 0 },
];
