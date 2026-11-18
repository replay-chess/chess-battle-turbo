// The headline (phase-06 plan §8.17): a template, verified by construction. Every claim it makes (the top pattern,
// its phase, the clock) is recorded in `claims`; `verifyHeadline` recomputes each one from the stored rows and the
// clock data, and the text must equal the template for those claims. A headline that fails (it should not) drops to
// the claim-free "You lose most points to {label}.". The UI always shows VERIFIED: the text is never free-form.
import { TIME_PRESSURE_THEME, weaknessPhaseNamed, weaknessPhrase } from "../themes";
import { CLOCK_MIN_MOVES_BUCKET, HEADLINE_CLOCK_MIN_EVENTS, HEADLINE_CLOCK_RATIO } from "./constants";
import type { HeadlineClaim, ListMode, WeaknessHeadlineDoc, WeaknessMetricsRow } from "./types";

type Row = Pick<WeaknessMetricsRow, "pattern" | "label" | "phaseMode" | "events" | "eventsLt1" | "moves">;

/** What the clock clause reads of the clock section: the moves per bucket (lt1 = moves under a minute). */
export interface HeadlineClock {
  buckets: readonly { key: string; moves: number }[];
}

export const NEUTRAL_HEADLINE = "Nothing stands out against players at your level. Your mistakes are spread across many patterns.";

/**
 * True when the clock clause holds (§8.17 as corrected by FIX-1, docs/decisions.md D-P6-FIX1-4): a clock section, and
 * the top pattern itself is more frequent in time trouble: ≥ 5 of its events under a minute, ≥ 30 moves under a
 * minute, and its rate per move under a minute ≥ 1.5× its rate per move with more time. Time pressure on top always
 * holds. (The plan's "or time pressure is another row" made the clause about a pattern that may rarely happen under a
 * minute: member H's missed threats, 8 of 146 under a minute.)
 */
export function clockClaimHolds(rows: readonly Row[], clock: HeadlineClock | null): boolean {
  const top = rows[0];
  if (!top || !clock) return false;
  if (top.pattern === TIME_PRESSURE_THEME) return true;
  const mLt1 = clock.buckets.find((b) => b.key === "lt1")?.moves ?? 0;
  const mRest = top.moves - mLt1;
  if (top.eventsLt1 < HEADLINE_CLOCK_MIN_EVENTS || mLt1 < CLOCK_MIN_MOVES_BUCKET || mRest <= 0) return false;
  const rateLt1 = top.eventsLt1 / mLt1;
  const rateRest = (top.events - top.eventsLt1) / mRest;
  return rateLt1 >= HEADLINE_CLOCK_RATIO * rateRest;
}

/** The template for a set of claims. */
export function headlineText(top: Row, claims: readonly HeadlineClaim[]): { text: string; short: string } {
  if (top.pattern === TIME_PRESSURE_THEME) {
    return {
      text: "You lose most points to blunders with under a minute on your clock.",
      short: "You lose most points to blunders under a minute.",
    };
  }
  const phase = claims.find((c): c is Extract<HeadlineClaim, { k: "phase" }> => c.k === "phase");
  const clock = claims.some((c) => c.k === "clock");
  // FIX-2 (D-P6-FIX2-5): the pattern's own noun phrase ("missed recaptures", "weakening your king's shelter"), never the
  // row label lower-cased, and no phase clause on a label that names its phase ("rook endgames in the endgame").
  const base = `You lose most points to ${weaknessPhrase(top.pattern)}${phase ? ` in the ${phase.phase}` : ""}`;
  return {
    text: `${base}${clock ? ", especially with under a minute on your clock" : ""}.`,
    short: `${base}${clock ? ", especially under a minute" : ""}.`,
  };
}

/** Builds the headline for ranked rows (null rows → null). `clock` is the stored clock section (null: no Clock tab). */
export function buildHeadline(listMode: ListMode, rows: readonly Row[], clock: HeadlineClock | null): WeaknessHeadlineDoc {
  const top = rows[0];
  if (listMode === "most_frequent" || !top) return { text: NEUTRAL_HEADLINE, short: NEUTRAL_HEADLINE, claims: [] };
  const claims: HeadlineClaim[] = [{ k: "pattern", key: top.pattern }];
  if (top.pattern === TIME_PRESSURE_THEME) {
    claims.push({ k: "clock", bucket: "lt1" });
  } else {
    if (top.phaseMode && !weaknessPhaseNamed(top.pattern)) claims.push({ k: "phase", phase: top.phaseMode });
    if (clockClaimHolds(rows, clock)) claims.push({ k: "clock", bucket: "lt1" });
  }
  return { ...headlineText(top, claims), claims };
}

/** Re-checks every claim against the metrics, and the text against the template. */
export function verifyHeadline(m: { listMode: ListMode; rows: readonly Row[]; headline: WeaknessHeadlineDoc | null; breakdown: { clock: HeadlineClock | null } | null }): boolean {
  const h = m.headline;
  if (!h) return true;
  if (m.listMode === "most_frequent" || m.rows.length === 0) return h.claims.length === 0 && h.text === NEUTRAL_HEADLINE && h.short === NEUTRAL_HEADLINE;
  const top = m.rows[0]!;
  for (const c of h.claims) {
    if (c.k === "pattern" && c.key !== top.pattern) return false;
    if (c.k === "phase" && (c.phase !== top.phaseMode || weaknessPhaseNamed(top.pattern))) return false;
    if (c.k === "clock" && !clockClaimHolds(m.rows, m.breakdown?.clock ?? null)) return false;
  }
  if (!h.claims.some((c) => c.k === "pattern")) return false;
  const expected = headlineText(top, h.claims);
  return expected.text === h.text && expected.short === h.short;
}

/** The claim-free fallback: "You lose most points to {label}." (or the neutral sentence without a row). */
export function fallbackHeadline(rows: readonly Row[]): WeaknessHeadlineDoc {
  const top = rows[0];
  if (!top) return { text: NEUTRAL_HEADLINE, short: NEUTRAL_HEADLINE, claims: [] };
  const text = `You lose most points to ${weaknessPhrase(top.pattern)}.`;
  return { text, short: text, claims: [{ k: "pattern", key: top.pattern }] };
}

/**
 * The headline to store: the built one when it verifies, else the claim-free fallback. `build` is the template
 * (injectable so the fallback path is testable; production always uses `buildHeadline`).
 */
export function verifiedHeadline(
  listMode: ListMode,
  rows: readonly Row[],
  breakdown: { clock: HeadlineClock | null } | null,
  build: typeof buildHeadline = buildHeadline,
): WeaknessHeadlineDoc {
  const h = build(listMode, rows, breakdown?.clock ?? null);
  if (verifyHeadline({ listMode, rows, headline: h, breakdown })) return h;
  return listMode === "most_frequent" ? fallbackHeadline([]) : fallbackHeadline(rows);
}
