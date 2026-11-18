// The member's rating band and the band value of any metric (phase-06 plan §8.4; R-WK-01…03, D-P6-5). The baseline
// is Lichess-based, so Lichess ratings are preferred; Chess.com ratings get the per-time-class offset (0 in v1, [V]);
// rated REPLAY games count from P9; else the onboarding band's midpoint; else no band (`own_only`). Pure.
import type { BaselineCalibration, BaselineCell, BaselineTimeClass, BaselineV1 } from "../../baselines/schema";
import {
  BAND_CENTER_MAX,
  BAND_CENTER_MIN,
  BAND_HALF_WIDTH,
  BAND_RATING_MIN_GAMES,
  BAND_RATING_SAMPLE,
  BASELINE_STEP,
  ONBOARDING_BAND_RATING,
} from "./constants";
import type { BandSource, RatingBandDb, WeaknessBandDoc, WeaknessGameInput } from "./types";

/** The median of a list (the mean of the middle two for an even count), rounded to an integer. */
export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

/** A member time class → the baseline's (CLASSICAL games are compared with rapid players; there is no cell). */
export function baselineTc(tc: string | null): BaselineTimeClass | null {
  if (tc === "BULLET" || tc === "BLITZ" || tc === "RAPID") return tc;
  if (tc === "CLASSICAL") return "RAPID";
  return null;
}

/** The majority baseline time class of `games` (ties: BLITZ, RAPID, BULLET). */
export function majorityTc(games: readonly Pick<WeaknessGameInput, "timeClass">[]): BaselineTimeClass {
  const n: Record<BaselineTimeClass, number> = { BULLET: 0, BLITZ: 0, RAPID: 0 };
  for (const g of games) {
    const tc = baselineTc(g.timeClass);
    if (tc) n[tc] += 1;
  }
  return (["BLITZ", "RAPID", "BULLET"] as const).reduce((best, tc) => (n[tc] > n[best] ? tc : best), "BLITZ" as BaselineTimeClass);
}

/**
 * The member's rating and its source (§8.4 step 1), from in-scope games newest first. Lichess ≥ 10 → the median of
 * the newest 20; Chess.com ≥ 10 → the median + the offset of the majority time class; REPLAY ≥ 10 rated games (P9
 * Glicko; unrated REPLAY rows carry a display rating and are skipped); the onboarding band's midpoint; else null.
 */
export function resolveRating(
  gamesNewestFirst: readonly WeaknessGameInput[],
  ratingBand: RatingBandDb | null,
  baseline: BaselineV1,
): { rating: number; source: BandSource } | null {
  const ratings = (pred: (g: WeaknessGameInput) => boolean) =>
    gamesNewestFirst.filter((g) => g.ratingBefore !== null && pred(g)).map((g) => g.ratingBefore as number);
  const lichess = ratings((g) => g.source === "LICHESS");
  if (lichess.length >= BAND_RATING_MIN_GAMES) return { rating: median(lichess.slice(0, BAND_RATING_SAMPLE)), source: "lichess" };
  const chesscomGames = gamesNewestFirst.filter((g) => g.source === "CHESSCOM" && g.ratingBefore !== null);
  if (chesscomGames.length >= BAND_RATING_MIN_GAMES) {
    const offset = baseline.ratingOffsets.CHESSCOM[majorityTc(chesscomGames)];
    return { rating: median(chesscomGames.slice(0, BAND_RATING_SAMPLE).map((g) => g.ratingBefore as number)) + offset, source: "chesscom" };
  }
  const replay = ratings((g) => g.source === "REPLAY" && g.rated);
  if (replay.length >= BAND_RATING_MIN_GAMES) return { rating: median(replay.slice(0, BAND_RATING_SAMPLE)), source: "replay" };
  if (ratingBand) return { rating: ONBOARDING_BAND_RATING[ratingBand], source: "onboarding" };
  return null;
}

/**
 * The display band (§8.4 step 2): centre c = clamp(round(r/100)·100, 700, 2400), band [c − 100, c + 100], baseline
 * cells "c−100" and "c" (1184 → c 1200 → cells 1100 and 1200 → "1100–1300").
 */
export function bandOf(rating: number, source: BandSource): WeaknessBandDoc {
  const center = Math.min(BAND_CENTER_MAX, Math.max(BAND_CENTER_MIN, Math.round(rating / BASELINE_STEP) * BASELINE_STEP));
  return {
    min: center - BAND_HALF_WIDTH,
    max: center + BAND_HALF_WIDTH,
    center,
    source,
    rating: Math.round(rating),
    baselineBands: [String(center - BASELINE_STEP), String(center)],
  };
}

/** How band values are mixed for one member (§8.4 step 3). */
export interface BandMix {
  band: WeaknessBandDoc;
  baseline: BaselineV1;
  /** The member's move share per baseline time class (sums to 1). */
  weights: Array<{ tc: BaselineTimeClass; w: number }>;
  /** Share of the member's moves graded by our engine (not imported Lichess `%eval`). */
  engineShare: number;
}

/**
 * The mix for a member: time-class weights from the analysed games' moves (STATS_V1 slot 0), equal weights over the
 * scope's classes when nothing is analysed yet; `engineShare` from `evalSource` (ENGINE or unknown = ours).
 */
export function bandMix(
  band: WeaknessBandDoc,
  baseline: BaselineV1,
  analysed: readonly { g: WeaknessGameInput; moves: number }[],
  scopeTimeClasses: readonly string[],
): BandMix {
  const moves: Record<BaselineTimeClass, number> = { BULLET: 0, BLITZ: 0, RAPID: 0 };
  let total = 0;
  let engine = 0;
  for (const { g, moves: m } of analysed) {
    const tc = baselineTc(g.timeClass);
    if (!tc) continue;
    moves[tc] += m;
    total += m;
    if (!g.evalSource || g.evalSource === "ENGINE") engine += m;
  }
  let weights: BandMix["weights"];
  if (total > 0) {
    weights = (["BULLET", "BLITZ", "RAPID"] as const).filter((tc) => moves[tc] > 0).map((tc) => ({ tc, w: moves[tc] / total }));
  } else {
    const tcs = [...new Set(scopeTimeClasses.map(baselineTc).filter((x): x is BaselineTimeClass => x !== null))];
    weights = tcs.map((tc) => ({ tc, w: 1 / tcs.length }));
  }
  return { band, baseline, weights, engineShare: total > 0 ? engine / total : 1 };
}

/**
 * band(x) = Σ_tc w_tc · (Σ_cell moves_cell·x_cell / Σ_cell moves_cell) · cal, with
 * cal = s_e·calibration + (1 − s_e) (R-WK-03; `kind` null = no calibration, e.g. accuracies and shares).
 * Null when no cell of the band has the value (`pick` returns null) or the baseline has no cell for the band.
 */
export function bandValue(mix: BandMix, pick: (cell: BaselineCell) => number | null, kind: keyof BaselineCalibration | null): number | null {
  let sum = 0;
  let weightSeen = 0;
  for (const { tc, w } of mix.weights) {
    let num = 0;
    let den = 0;
    for (const key of mix.band.baselineBands) {
      const cell = mix.baseline.bands[key]?.[tc];
      if (!cell) continue;
      const x = pick(cell);
      if (x === null) continue;
      num += cell.moves * x;
      den += cell.moves;
    }
    if (den === 0) continue;
    sum += w * (num / den);
    weightSeen += w;
  }
  if (weightSeen === 0) return null;
  const value = sum / weightSeen;
  if (kind === null) return value;
  const cals = mix.band.baselineBands.map((k) => mix.baseline.calibration[k]?.[kind]).filter((c): c is number => typeof c === "number");
  const calibration = cals.length > 0 ? cals.reduce((s, c) => s + c, 0) / cals.length : 1;
  return value * (mix.engineShare * calibration + (1 - mix.engineShare));
}
