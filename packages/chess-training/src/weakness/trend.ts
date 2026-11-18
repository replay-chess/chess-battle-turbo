// Trend (phase-06 plan §8.18 as corrected by FIX-2, docs/decisions.md D-P6-FIX2-3): the rate over the last 30 days
// against the 60 days before, relative to `computedAt` (recent [t − 30 d, t], prior [t − 90 d, t − 30 d)). Both windows
// need ≥ 300 moves (≥ 60 under a minute for time pressure), else "unknown".
//
// The plan's Δ = (recent − prior) / max(prior, 0.1) ≥ ±20 % on ≥ 100 moves (≈ 3 games) labelled two thirds of
// constant-rate members "worse" or "better", and leaned to "worse" (the ratio of two noisy rates skews up). A
// direction now needs both:
//   - an effect, symmetric in the log ratio: recent ≥ 1.25 × prior (worse) or recent ≤ prior / 1.25 (better);
//   - evidence: the conditional test of "same rate in both windows" (given k = k_recent + k_prior events, k_recent is
//     binomial(k, n_recent / (n_recent + n_prior)) under the null), widened by the key's dispersion φ, two-sided at
//     TREND_ALPHA (normal approximation with a continuity correction).
// Counts are capped at 2 events a game (time pressure: not capped), as the eligibility test counts them. The stored
// `trendRecent` / `trendPrior` stay the rates per 100 moves of every event, as the row's "you" is shown.
import { TIME_PRESSURE_THEME } from "../themes";
import { type Aggregate, type AnalysedGame, aggregate, patternAgg, ratePer100 } from "./aggregate";
import type { BandMix } from "./band";
import { TREND_ALPHA, TREND_MIN_MOVES, TREND_MIN_MOVES_TP, TREND_PRIOR_DAYS, TREND_RATIO, TREND_RECENT_DAYS } from "./constants";
import type { Trend } from "./types";

const DAY_MS = 86_400_000;

/** The dispersion a trend uses when there is no baseline value for the key (the largest v1 measured, rounded up). */
export const TREND_DISPERSION_DEFAULT = 1.7;

export interface TrendWindows {
  recent: Aggregate;
  prior: Aggregate;
}

/** Splits analysed games into the two windows by `endedAt` relative to `computedAt`. */
export function trendWindows(games: readonly AnalysedGame[], computedAt: Date): TrendWindows {
  const t = computedAt.getTime();
  const recentFrom = t - TREND_RECENT_DAYS * DAY_MS;
  const priorFrom = recentFrom - TREND_PRIOR_DAYS * DAY_MS;
  const recent: AnalysedGame[] = [];
  const prior: AnalysedGame[] = [];
  for (const x of games) {
    const e = x.g.endedAt?.getTime();
    if (e === undefined) continue;
    if (e >= recentFrom && e <= t) recent.push(x);
    else if (e >= priorFrom && e < recentFrom) prior.push(x);
  }
  return { recent: aggregate(recent), prior: aggregate(prior) };
}

/** Φ(x), the standard normal CDF (Abramowitz–Stegun 7.1.26 erfc, |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/**
 * Two-sided p of "k_recent of k events fall in the recent window" when each event lands there with probability q, the
 * variance widened by φ (continuity-corrected normal approximation). 1 without events.
 */
export function trendP(kRecent: number, k: number, q: number, phi: number): number {
  if (k <= 0 || q <= 0 || q >= 1) return 1;
  const sd = Math.sqrt(Math.max(1, phi) * k * q * (1 - q));
  const dev = Math.max(0, Math.abs(kRecent - k * q) - 0.5);
  return Math.min(1, 2 * (1 - normalCdf(dev / sd)));
}

/** The trend of one pattern (`mix`: the member's band, for the key's dispersion; null → TREND_DISPERSION_DEFAULT). */
export function trendOf(w: TrendWindows, key: string, mix: BandMix | null = null): { trend: Trend; recent: number | null; prior: number | null } {
  const tp = key === TIME_PRESSURE_THEME;
  const min = tp ? TREND_MIN_MOVES_TP : TREND_MIN_MOVES;
  const nR = tp ? w.recent.Mlt1 : w.recent.M;
  const nP = tp ? w.prior.Mlt1 : w.prior.M;
  if (nR < min || nP < min) return { trend: "unknown", recent: null, prior: null };
  const aR = patternAgg(w.recent, key);
  const aP = patternAgg(w.prior, key);
  const recent = ratePer100(aR.k, nR);
  const prior = ratePer100(aP.k, nP);
  const kR = tp ? aR.k : aR.kCapped;
  const kP = tp ? aP.k : aP.kCapped;
  const phi = mix?.baseline.dispersion?.[key] ?? TREND_DISPERSION_DEFAULT;
  const p = trendP(kR, kR + kP, nR / (nR + nP), phi);
  const rR = kR / nR;
  const rP = kP / nP;
  let trend: Trend = "same";
  if (p <= TREND_ALPHA) {
    if (rR >= TREND_RATIO * rP && rR > rP) trend = "worse";
    else if (rR * TREND_RATIO <= rP && rR < rP) trend = "better";
  }
  return { trend, recent, prior };
}
