// Candidates, eligibility and ranking (phase-06 plan §8.6; R-WK-05 adapted, D-P6-4). With a band (`vs_band`) a
// candidate is a weakness when the member makes it more often than players of their band (FIX-2, D-P6-FIX2-1): the
// capped rate (≤ 2 events a game on both sides) is ≥ 1.25× the band's AND the count is unlikely under the band's rate
// (quasi-Poisson tail ≤ 10 % / the number of candidates tested), over enough moves, events and games; rows rank by
// the excess Win% lost per 100 moves. Time pressure is a candidate only when the member's own blunder rate rises as
// the clock runs down (`clockRises`, the Clock tab's own rule, D-P6-FIX2-6). Without a
// band (`own_only`) rows rank by the member's own loss. When nothing is eligible against the band, the three most
// frequent patterns are listed (`most_frequent`) under a neutral headline. Phase and opening gaps are never rows
// (D-P6-4): they live in the headline clause and the breakdown tabs. Pure.
import { isWeaknessCandidate, TIME_PRESSURE_THEME, WEAKNESS_CANDIDATES, weaknessLabel } from "../themes";
import { type BandMix, bandValue } from "./band";
import { type Aggregate, type PatternAgg, patternAgg, phaseModeOf, ratePer100 } from "./aggregate";
import { clockRises } from "./breakdown";
import { FAMILY_ALPHA, MIN_EVENTS, MIN_GAMES_WITH, MIN_MOVES, MIN_MOVES_TP, MORE_N, MOST_FREQUENT_MIN_EVENTS, RATIO_MIN, TOP_N } from "./constants";
import { poissonUpperTail, quasiZ } from "./stats";
import type { ListMode, WeaknessPhase } from "./types";

/** A ranked row before the trend, the "where" line and the example are attached. */
export interface RankedRow {
  pattern: string;
  label: string;
  unit: "per100" | "per100_under1min";
  you: number;
  band: number | null;
  events: number;
  moves: number;
  gamesWith: number;
  lossYou100: number;
  lossBand100: number | null;
  ratio: number | null;
  z: number | null;
  score: number;
  /** FIX-2: the quasi-Poisson tail probability of the capped count under the band's capped rate (null: no band). */
  p?: number | null;
  phaseMode: WeaknessPhase | null;
  phaseCount: [number, number, number];
  eventsLt1: number;
}

export interface RankResult {
  listMode: ListMode;
  rows: RankedRow[];
}

export interface RankOptions {
  /** Which keys may be rows (default: the taxonomy's weakness candidates). */
  isCandidate?: (key: string) => boolean;
}

/**
 * The candidate keys present in the aggregate. Time pressure needs ≥ MIN_MOVES_TP moves under a minute AND a blunder
 * rate that rises as the clock runs down (FIX-2, D-P6-FIX2-6): a member who blunders less under a minute than with time
 * has no time-pressure weakness, however far above the band that rate is (they blunder more everywhere), and the row
 * would contradict the Clock tab's own sentence on the same screen.
 */
export function candidateKeys(a: Aggregate, isCandidate: (key: string) => boolean = isWeaknessCandidate): string[] {
  const keys = [...a.themes.keys()].filter((k) => k !== TIME_PRESSURE_THEME && isCandidate(k));
  if (a.Mlt1 >= MIN_MOVES_TP && isCandidate(TIME_PRESSURE_THEME) && clockRises(a)) keys.push(TIME_PRESSURE_THEME);
  return keys.sort();
}

/** The candidates tested for every member (the Bonferroni divisor): the taxonomy's candidate keys. */
export const ELIGIBILITY_TESTS = WEAKNESS_CANDIDATES.length;

/** The per-candidate level of the eligibility test (FAMILY_ALPHA / ELIGIBILITY_TESTS). */
export const ELIGIBILITY_ALPHA = FAMILY_ALPHA / ELIGIBILITY_TESTS;

function baseRow(key: string, agg: PatternAgg, a: Aggregate): RankedRow {
  const tp = key === TIME_PRESSURE_THEME;
  const n = tp ? a.Mlt1 : a.M;
  return {
    pattern: key,
    label: weaknessLabel(key),
    unit: tp ? "per100_under1min" : "per100",
    you: ratePer100(agg.k, n),
    band: null,
    events: agg.k,
    moves: n,
    gamesWith: agg.games.size,
    lossYou100: ratePer100(agg.L, a.M),
    lossBand100: null,
    ratio: null,
    z: null,
    score: 0,
    phaseMode: phaseModeOf(agg.phaseCount),
    phaseCount: [...agg.phaseCount],
    eventsLt1: agg.eventsLt1,
  };
}

/**
 * The band rate and band loss of a candidate (time pressure: the lt1 blunder rate and the lt1 loss), the capped rate
 * the eligibility test reads (FIX-2: `capped100`, `per100` where a baseline has none; time pressure is not capped) and
 * the key's dispersion (1 where the baseline has none).
 */
export function bandRates(mix: BandMix, key: string): { rate: number | null; loss: number | null; capped: number | null; dispersion: number } {
  const dispersion = Math.max(1, mix.baseline.dispersion?.[key] ?? 1);
  if (key === TIME_PRESSURE_THEME) {
    const rate = bandValue(mix, (c) => c.timePressure.per100Lt1, "BLUNDER");
    return { rate, loss: bandValue(mix, (c) => c.timePressure.loss100, "ALL"), capped: rate, dispersion };
  }
  // A theme the baseline cell does not list was never seen in that cell: rate 0.
  return {
    rate: bandValue(mix, (c) => c.themes[key]?.per100 ?? 0, "ALL"),
    loss: bandValue(mix, (c) => c.themes[key]?.loss100 ?? 0, "ALL"),
    capped: bandValue(mix, (c) => c.themes[key]?.capped100 ?? c.themes[key]?.per100 ?? 0, "ALL"),
    dispersion,
  };
}

/**
 * Eligibility against the band (§8.6 as corrected by FIX-2, D-P6-FIX2-1): n ≥ MIN_MOVES(_TP) ∧ k ≥ 5 ∧ gamesWith ≥ 3
 * ∧ you > band ∧ capped ratio ≥ RATIO_MIN ∧ P(X ≥ k_capped | band) ≤ ELIGIBILITY_ALPHA.
 */
export function isEligibleVsBand(r: RankedRow): boolean {
  const minMoves = r.pattern === TIME_PRESSURE_THEME ? MIN_MOVES_TP : MIN_MOVES;
  if (r.moves < minMoves || r.events < MIN_EVENTS || r.gamesWith < MIN_GAMES_WITH) return false;
  if (r.band === null || !(r.you > r.band)) return false;
  // A band rate of 0 makes any event an infinite ratio and a zero tail.
  if (r.band === 0) return true;
  if (r.ratio === null || r.ratio < RATIO_MIN) return false;
  return r.p !== undefined && r.p !== null && r.p <= ELIGIBILITY_ALPHA;
}

/** Score desc, then events desc, then key asc. */
function byScore(a: RankedRow, b: RankedRow): number {
  return b.score - a.score || b.events - a.events || (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0);
}

/**
 * Two candidates that read the same ("Missed threats": `rc:missedThreat` and `defensiveMove`) are one row: the
 * larger one (more events, then the higher score) stays, the smaller is dropped (§8.6).
 */
export function mergeSameLabel(rows: readonly RankedRow[]): RankedRow[] {
  const byLabel = new Map<string, RankedRow>();
  for (const r of rows) {
    const prev = byLabel.get(r.label);
    if (!prev || r.events > prev.events || (r.events === prev.events && r.score > prev.score)) byLabel.set(r.label, r);
  }
  const keep = new Set(byLabel.values());
  return rows.filter((r) => keep.has(r));
}

/** Ranks the candidates (§8.6): ≤ TOP_N + MORE_N rows (1–3 top, 4–5 more). */
export function rankPatterns(a: Aggregate, mix: BandMix | null, o: RankOptions = {}): RankResult {
  const keys = candidateKeys(a, o.isCandidate);
  const max = TOP_N + MORE_N;
  if (mix === null) {
    const rows = keys
      .map((key) => baseRow(key, patternAgg(a, key), a))
      .filter((r) => r.events >= MIN_EVENTS && r.gamesWith >= MIN_GAMES_WITH)
      .map((r) => ({ ...r, score: r.lossYou100 }));
    return { listMode: "own_only", rows: mergeSameLabel(rows).sort(byScore).slice(0, max) };
  }
  const rows = keys.map((key) => {
    const r = baseRow(key, patternAgg(a, key), a);
    const { rate, loss, capped, dispersion } = bandRates(mix, key);
    r.band = rate;
    r.lossBand100 = loss;
    // Eligibility reads the per-game capped count (EVENTS_PER_GAME_CAP) against the band's rate capped the same way: a
    // pattern must show up across games. Not time pressure: its denominator (moves under a minute) sits in the same
    // scrambles as its events, so its rate already compares like with like against the band's rate under a minute.
    const agg = patternAgg(a, key);
    const k = key === TIME_PRESSURE_THEME ? agg.k : agg.kCapped;
    const mu = capped === null ? null : (r.moves * capped) / 100;
    r.ratio = mu !== null && mu > 0 ? k / mu : null;
    r.z = mu !== null ? quasiZ(k, mu, dispersion) : null;
    r.p = mu !== null ? poissonUpperTail(k, mu, dispersion) : null;
    r.score = r.lossYou100 - (loss ?? 0);
    return r;
  });
  const eligible = mergeSameLabel(rows.filter(isEligibleVsBand)).sort(byScore);
  if (eligible.length > 0) return { listMode: "vs_band", rows: eligible.slice(0, max) };
  const frequent = mergeSameLabel(rows.filter((r) => r.events >= MOST_FREQUENT_MIN_EVENTS))
    .map((r) => ({ ...r, band: null, lossBand100: null, ratio: null, z: null, p: null, score: r.lossYou100 }))
    .sort((x, y) => y.events - x.events || byScore(x, y))
    .slice(0, TOP_N);
  return { listMode: "most_frequent", rows: frequent };
}
