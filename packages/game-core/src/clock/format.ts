// Clock display (plan 8.4, the template's fmt()): s ≤ 0 → "0:00"; s < 10 → "0:0" + tenths ("0:09.6");
// otherwise m:ss with floored seconds (h:mm:ss from one hour). Chip colours by remaining time.

import { AMBER_MS, LOW_TIME_MS, RED_MS } from "../constants";

export function formatClock(ms: number): string {
  if (!(ms > 0)) return "0:00";
  if (ms < LOW_TIME_MS) {
    const tenths = Math.floor(ms / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Countdown text for study, first-move, grace and rematch rings ("0:30", "0:05"): whole seconds, rounded up. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type ClockTone = "default" | "amber" | "red" | "zero";

/** Running chip: default, amber ≤ 60 s, red ≤ 20 s. Idle at zero: red text ("zero"). */
export function clockTone(ms: number, running: boolean): ClockTone {
  if (!running) return ms <= 0 ? "zero" : "default";
  if (ms <= RED_MS) return "red";
  if (ms <= AMBER_MS) return "amber";
  return "default";
}

/** Token colours from the template (cb-accent, cb-amber-*, cb-defeat-*). */
export const CLOCK_TONE_COLORS: Record<ClockTone, string> = {
  default: "#3d3229",
  amber: "#8a5a12",
  red: "#a3412e",
  zero: "#a3412e",
};

export function isLowTime(ms: number): boolean {
  return ms < LOW_TIME_MS;
}
