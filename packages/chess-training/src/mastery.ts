// Card mastery dots, theme mastery and milestones (phase-05 plan §8.8, rct-b §3.4). Pure; browser-safe.
import { MASTERY_STABILITY_BOUNDS, THEME_EWMA_ALPHA, THEME_MILESTONES, THEME_MIN_ATTEMPTS } from "./constants";

/** FSRS card state, spelled as the database enum `CardState`. */
export type CardState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

/**
 * Card mastery 0–5 (stored on every card write): 0 while NEW, LEARNING or RELEARNING; then by stability in days,
 * 1 below 4, 2 below 10, 3 below 30, 4 below 90, 5 from 90 ("Mastered").
 */
export function masteryOf(state: CardState, stability: number): number {
  if (state !== "REVIEW") return 0;
  let level = 1;
  for (const bound of MASTERY_STABILITY_BOUNDS) {
    if (stability < bound) return level;
    level += 1;
  }
  return level;
}

export type Milestone = (typeof THEME_MILESTONES)[number];

/** A member's record in one theme (`theme_mastery`). */
export interface ThemeMasteryState {
  attempts: number;
  /** First-try solves counted. */
  firstTry: number;
  ewma: number;
  /** Highest milestone already announced (0 = none). */
  milestonePct: number;
}

export const EMPTY_THEME_MASTERY: ThemeMasteryState = { attempts: 0, firstTry: 0, ewma: 0, milestonePct: 0 };

/** The percentage a theme shows: `round(100 · ewma)` once it has 5 attempts, else null ("New"). */
export function themePct(state: Pick<ThemeMasteryState, "attempts" | "ewma">): number | null {
  if (state.attempts < THEME_MIN_ATTEMPTS) return null;
  return Math.min(100, Math.max(0, Math.round(100 * state.ewma)));
}

/**
 * One attempt in the theme (any deck): `ewma ← ewma + 0.15 · (firstTry − ewma)`, counters +1. A milestone (50, 70,
 * 90) fires the first time `floor(ewma · 10) · 10` reaches it with at least 5 attempts and a lower `milestonePct`;
 * it never fires again, even after the theme drops and climbs back.
 */
export function applyThemeAttempt(prev: ThemeMasteryState, firstTry: boolean): ThemeMasteryState & { milestone: Milestone | null } {
  const x = firstTry ? 1 : 0;
  const ewma = prev.ewma + THEME_EWMA_ALPHA * (x - prev.ewma);
  const attempts = prev.attempts + 1;
  const level = Math.floor(ewma * 10 + 1e-9) * 10;
  let milestone: Milestone | null = null;
  if (attempts >= THEME_MIN_ATTEMPTS) {
    for (const m of THEME_MILESTONES) if (level >= m && m > prev.milestonePct) milestone = m;
  }
  return {
    attempts,
    firstTry: prev.firstTry + x,
    ewma,
    milestonePct: milestone ?? prev.milestonePct,
    milestone,
  };
}

/** A session is perfect when every graded item was solved first try and nothing was skipped. */
export function isPerfectSession(stats: { total: number; firstTry: number; skipped: number }): boolean {
  return stats.total > 0 && stats.firstTry === stats.total && stats.skipped === 0;
}
