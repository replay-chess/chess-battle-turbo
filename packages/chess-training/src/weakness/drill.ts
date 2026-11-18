// Weakness drills (phase-06 plan §8.11; rct-b W2, Q16; D-P6-7, D-P6-8). One composition rule for the session
// (`session.ts` → TR-7) and the config preview on the client, so the "6 from your games + 4 matched Lichess puzzles"
// line always describes the session that starts:
//
//   matchTheme = lichessMatch(pattern) (null for rc:timePressure: puzzles have no clock)
//   !matchable ∧ no own items           → empty_drill
//   mixEff     = matchable ∧ (mix ∨ no own items)       (zero own → mix forced on)
//   ownTarget  = mixEff ? round(size × 0.6) : size       (10 → 6, 20 → 12)
//   puzzles    = mixEff ? size − own taken : 0           (an own shortfall is filled with puzzles)
//   order      = o p o p …, then the rest               (6 + 4 → o p o p o p o p o o)
//
// Browser-safe: never imports session.ts (ts-fsrs). The session module imports this one.
import { isWeaknessCandidate, lichessMatch, TIME_PRESSURE_THEME, weaknessLabel } from "../themes";
import { DRILL_OWN_SHARE, MIN_PER_ITEM } from "./constants";

export type DrillSize = 10 | 20;

/** The Lichess theme a drill of `pattern` fills with, or null (no matching puzzles; time pressure never). */
export function weaknessMatchTheme(pattern: string): string | null {
  if (pattern === TIME_PRESSURE_THEME) return null;
  return lichessMatch(pattern);
}

export type DrillPlan =
  | { ok: true; matchTheme: string | null; matchable: boolean; mixEff: boolean; ownTarget: number; ownTake: number; puzTarget: number }
  | { ok: false; reason: "empty_drill" | "unknown_pattern" };

/** Sizes a drill before the puzzles are fetched (TR-7 asks the shards for `puzTarget` puzzles). */
export function planWeaknessDrill(i: { pattern: string; size: DrillSize; mix: boolean; ownCount: number }): DrillPlan {
  if (!isWeaknessCandidate(i.pattern)) return { ok: false, reason: "unknown_pattern" };
  const matchTheme = weaknessMatchTheme(i.pattern);
  const matchable = matchTheme !== null;
  const own = Math.max(0, i.ownCount);
  if (!matchable && own === 0) return { ok: false, reason: "empty_drill" };
  const mixEff = matchable && (i.mix || own === 0);
  const ownTarget = mixEff ? Math.round(i.size * DRILL_OWN_SHARE) : i.size;
  const ownTake = Math.min(own, ownTarget);
  return { ok: true, matchTheme, matchable, mixEff, ownTarget, ownTake, puzTarget: mixEff ? i.size - ownTake : 0 };
}

/** o p o p …, then whatever is left of the longer list. */
export function interleaveDrill<T>(own: readonly T[], puzzles: readonly T[]): T[] {
  const out: T[] = [];
  const n = Math.max(own.length, puzzles.length);
  for (let i = 0; i < n; i++) {
    if (i < own.length) out.push(own[i]!);
    if (i < puzzles.length) out.push(puzzles[i]!);
  }
  return out;
}

export type DrillEntry<O, P> = { source: "own"; item: O } | { source: "puzzle"; item: P };

export interface ComposedDrill<O, P> {
  entries: DrillEntry<O, P>[];
  own: number;
  puzzles: number;
  /** size' (≤ size; "few" when smaller). */
  size: number;
  estMin: number;
  mixEff: boolean;
  matchTheme: string | null;
}

/**
 * Composes the drill from the own items (Q-W7 order: due first, lowest mastery, newest) and the puzzles the shards
 * returned (any number; a shortfall gives a shorter drill). Throws on a plan that is not ok (the caller answers 400).
 */
export function composeWeaknessDrill<O, P>(i: { pattern: string; size: DrillSize; mix: boolean; own: readonly O[]; puzzles: readonly P[] }): ComposedDrill<O, P> {
  const plan = planWeaknessDrill({ pattern: i.pattern, size: i.size, mix: i.mix, ownCount: i.own.length });
  if (!plan.ok) throw new Error(`weakness drill: ${plan.reason}`);
  const own = i.own.slice(0, plan.ownTake).map((item) => ({ source: "own", item }) as DrillEntry<O, P>);
  const puzzles = i.puzzles.slice(0, plan.puzTarget).map((item) => ({ source: "puzzle", item }) as DrillEntry<O, P>);
  const entries = interleaveDrill<DrillEntry<O, P>>(own, puzzles);
  return {
    entries,
    own: own.length,
    puzzles: puzzles.length,
    size: entries.length,
    estMin: Math.round(entries.length * MIN_PER_ITEM),
    mixEff: plan.mixEff,
    matchTheme: plan.matchTheme,
  };
}

export interface DrillPreview {
  matchable: boolean;
  mixEff: boolean;
  /** The mix checkbox cannot be changed: no matching puzzles, time pressure, or no own positions (forced on). */
  mixDisabled: boolean;
  mixDisabledReason: "unmatched" | "time_pressure" | "zero_own" | null;
  own: number;
  puzzles: number;
  total: number;
  estMin: number;
  /** "6 from your games + 4 matched Lichess puzzles near 1512" / "12 from your games only (12 in your bank)". */
  mixLine: string;
  /** "Start drill · 10 positions · ~5 min". */
  cta: string;
  /** Nothing to drill (no own positions, no matching puzzles): the CTA is disabled. */
  empty: boolean;
  /** Fewer positions than the size asked for. */
  few: boolean;
}

/** The client preview (§8.11 "Preview"), matching `composeWeaknessDrill` when the shards have enough puzzles. */
export function previewWeaknessDrill(i: { pattern: string; inBank: number; size: DrillSize; mix: boolean; rating: number | null }): DrillPreview {
  const matchTheme = weaknessMatchTheme(i.pattern);
  const matchable = matchTheme !== null;
  const inBank = Math.max(0, i.inBank);
  const mixEff = matchable && (i.mix || inBank === 0);
  const own = mixEff ? Math.min(Math.round(i.size * DRILL_OWN_SHARE), inBank) : Math.min(inBank, i.size);
  const puzzles = mixEff ? i.size - own : 0;
  const total = own + puzzles;
  const near = i.rating === null ? "at your level" : `near ${i.rating}`;
  const mixLine = mixEff
    ? own === 0
      ? `${puzzles} matched Lichess puzzles ${near}`
      : `${own} from your games + ${puzzles} matched Lichess puzzles ${near}`
    : `${own} from your games only (${inBank} in your bank)`;
  const mixDisabledReason = i.pattern === TIME_PRESSURE_THEME ? "time_pressure" : !matchable ? "unmatched" : inBank === 0 ? "zero_own" : null;
  const estMin = Math.round(total * MIN_PER_ITEM);
  return {
    matchable,
    mixEff,
    mixDisabled: mixDisabledReason !== null,
    mixDisabledReason,
    own,
    puzzles,
    total,
    estMin,
    mixLine,
    cta: `Start drill · ${total} ${total === 1 ? "position" : "positions"} · ~${estMin} min`,
    empty: total === 0,
    few: total > 0 && total < i.size,
  };
}

/** "Drill missed forks" (the config's label and the sheet title). */
export function drillTitle(pattern: string): string {
  const label = weaknessLabel(pattern);
  return `Drill ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
