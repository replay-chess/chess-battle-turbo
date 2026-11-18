// Weakness Profile labels (phase-06 plan §4, §8.11, §8.13, §8.18, §8.19, §8.21). Every string the payload carries is
// built here on the server, in the member's time zone, so SSR and hydration agree and the client renders text only.
// Browser-safe (the drill preview and the progress events use the same functions on the client).
import type { ClockKey, TimeClassW, Trend, WeaknessPhase } from "./types";

const TC_ORDER: readonly TimeClassW[] = ["RAPID", "BLITZ", "BULLET", "CLASSICAL"];
const TC_WORD: Readonly<Record<TimeClassW, string>> = { RAPID: "rapid", BLITZ: "blitz", BULLET: "bullet", CLASSICAL: "classical" };

/** "rapid and blitz", "rapid, blitz and bullet" (§8.21 order: rapid, blitz, bullet, classical). */
export function timeClassesLower(tcs: readonly string[]): string {
  const words = TC_ORDER.filter((tc) => tcs.includes(tc)).map((tc) => TC_WORD[tc]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** "Rapid and blitz". */
export function timeClassesLabel(tcs: readonly string[]): string {
  const s = timeClassesLower(tcs);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

/** "Aug 2026" in the member's zone. */
export function monthYearLabel(at: Date, timeZone: string): string {
  let f = monthFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone });
    monthFormatters.set(timeZone, f);
  }
  return f.format(at);
}

/** Ready: "212 games · rapid and blitz · since Aug 2026"; otherwise "Rapid and blitz · since Aug 2026". */
export function scopeLabel(o: { ready: boolean; gamesInScope: number; timeClasses: readonly string[]; since: Date; timeZone: string }): string {
  const month = monthYearLabel(o.since, o.timeZone);
  return o.ready
    ? `${o.gamesInScope} ${o.gamesInScope === 1 ? "game" : "games"} · ${timeClassesLower(o.timeClasses)} · since ${month}`
    : `${timeClassesLabel(o.timeClasses)} · since ${month}`;
}

/** "212 games · since Aug 2026". */
export function scopeLabelShort(o: { gamesInScope: number; since: Date; timeZone: string }): string {
  return `${o.gamesInScope} ${o.gamesInScope === 1 ? "game" : "games"} · since ${monthYearLabel(o.since, o.timeZone)}`;
}

/** "1100–1300". */
export function bandLabel(min: number, max: number): string {
  return `${min}–${max}`;
}

/** The trend line under a row label (§8.18; copy note C2: "About the same" everywhere). */
export function trendLabel(t: Trend): string {
  switch (t) {
    case "worse":
      return "Getting worse this month";
    case "better":
      return "Improving";
    case "same":
      return "About the same";
    case "unknown":
      return "Not enough recent games for a trend";
  }
}

export const PHASE_LABELS: Readonly<Record<WeaknessPhase, string>> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };

/** Clock bucket labels as on the board's chart. */
export const CLOCK_LABELS: Readonly<Record<ClockKey, string>> = { gt5: "> 5 min", "2to5": "2–5 min", "1to2": "1–2 min", lt1: "< 1 min" };
/** The same buckets as words, for the chart's accessible sentence. */
export const CLOCK_WORDS: Readonly<Record<ClockKey, string>> = {
  gt5: "over 5 minutes",
  "2to5": "2 to 5 minutes",
  "1to2": "1 to 2 minutes",
  lt1: "under 1 minute",
};

/** "Middlegame · 7 of the last 20 games"; time pressure: "Under 1 minute · 4 of the last 20 games" (§8.19). */
export function whereLabel(o: { timePressure: boolean; phaseMode: WeaknessPhase | null; gamesWithLast20: number; lastN: number }): string {
  const lead = o.timePressure ? "Under 1 minute" : o.phaseMode ? PHASE_LABELS[o.phaseMode] : "All phases";
  return `${lead} · ${o.gamesWithLast20} of the last ${o.lastN} ${o.lastN === 1 ? "game" : "games"}`;
}

/** The summary eyebrow of a weakness drill (§8.11): "Missed forks drill · 10 positions". */
export function weaknessDrillEyebrow(label: string, n: number): string {
  return `${label} drill · ${n} ${n === 1 ? "position" : "positions"}`;
}

/** The lower-case form of a row label in running text ("missed forks", "loose pieces"). */
export function lowerLabel(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** One decimal, as every rate is shown ("3.1"). */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** "3.1" (always one decimal). */
export function fmt1(x: number): string {
  return round1(x).toFixed(1);
}
