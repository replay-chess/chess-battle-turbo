// computeWeakness(inputs, baseline, ctx) → the snapshot to write (phase-06 plan §7.4.2 step 6, §8). The worker, the
// seed, the persona writers and the tests share this one function: pure, deterministic, no I/O, time only from
// `ctx.now`. The worker reads the inputs (Q-W5), heals rows without inputs, calls this, attaches example positions
// (Q-W6, `attachExamples`) and writes the row with the version rule (`weaknessBumped`).
import type { BaselineV1 } from "../../baselines/schema";
import { type AnalysedGame, aggregate, type Aggregate } from "./aggregate";
import { type BandMix, bandMix, bandOf, resolveRating } from "./band";
import { clockBreakdown, phaseBreakdown, phaseSentence, pieceBreakdown } from "./breakdown";
import { GAMES_REQUIRED } from "./constants";
import { verifiedHeadline } from "./headline";
import { openingsBreakdown } from "./openings";
import { rankPatterns } from "./patterns";
import { preliminaryPatterns } from "./preliminary";
import { decodeGame } from "./records";
import { byNewest, resolveScope, scopeSince, selectScope } from "./scope";
import { strengthsOf } from "./strengths";
import { trendOf, trendWindows } from "./trend";
import type {
  RatingBandDb,
  TimeClassW,
  WeaknessBandDoc,
  WeaknessExampleDoc,
  WeaknessGameInput,
  WeaknessMetricsRow,
  WeaknessMetricsV1,
  WeaknessProfileRow,
  WeaknessScope,
} from "./types";
import { gamesWithLast20, last20 } from "./where";

export interface ComputeCtx {
  /** computedAt. */
  now: Date;
  /** `User.timeZone`. */
  timeZone: string;
  profile: WeaknessProfileRow | null;
  /** `User.ratingBand` (onboarding), the last fallback for the band. */
  ratingBand: RatingBandDb | null;
  /** Rows the caller healed in this run (`metrics.inputs.healed`). */
  healed?: number;
}

/** Everything the Q-W10 upsert writes, minus `userId` and `weekStart`. */
export interface WeaknessSnapshotDraft {
  status: "READY" | "INSUFFICIENT";
  timeClasses: TimeClassW[];
  since: Date;
  gamesInScope: number;
  gamesAnalysed: number;
  ratingBandMin: number | null;
  ratingBandMax: number | null;
  metrics: WeaknessMetricsV1;
  /** `metrics.headline.text` (the snapshot's `headline` varchar(200)), or null. */
  headline: string | null;
}

/** The analysed rows of the scope set with decodable inputs. */
export function analysedOf(games: readonly WeaknessGameInput[]): AnalysedGame[] {
  const out: AnalysedGame[] = [];
  for (const g of games) {
    if (g.accuracy === null) continue;
    const d = decodeGame(g);
    if (d) out.push({ g, d });
  }
  return out;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** The displayed "since": the later of the window start and the earliest in-scope game (§8.21). */
function effectiveSince(windowSince: Date, games: readonly WeaknessGameInput[]): Date {
  let earliest: number | null = null;
  for (const g of games) {
    const t = g.endedAt?.getTime();
    if (t !== undefined && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest !== null && earliest > windowSince.getTime() ? new Date(earliest) : windowSince;
}

function rowsOf(analysed: readonly AnalysedGame[], agg: Aggregate, mix: BandMix | null, now: Date) {
  const ranked = rankPatterns(agg, mix);
  const windows = trendWindows(analysed, now);
  const l20 = last20(analysed);
  const rows: WeaknessMetricsRow[] = ranked.rows.map((row) => {
    // The tail probability `p` decides eligibility; the stored row (a strict contract object) does not carry it.
    const r: Omit<typeof row, "p"> = { ...row };
    delete (r as Partial<typeof row>).p;
    const t = trendOf(windows, r.pattern, mix);
    return {
      ...r,
      gamesWithLast20: gamesWithLast20(l20, r.pattern),
      lastN: l20.n,
      trend: t.trend,
      trendRecent: t.recent,
      trendPrior: t.prior,
      example: null,
    };
  });
  return { listMode: ranked.listMode, rows };
}

export function computeWeakness(inputs: readonly WeaknessGameInput[], baseline: BaselineV1, ctx: ComputeCtx): WeaknessSnapshotDraft {
  const scope: WeaknessScope = resolveScope(ctx.profile);
  const windowSince = scopeSince(ctx.now, ctx.timeZone, scope.months);
  const { games, excludedBot } = selectScope(inputs, scope, windowSince);
  const analysed = analysedOf(games);
  const since = effectiveSince(windowSince, games);
  const agg = aggregate(analysed);

  const rating = resolveRating(games, ctx.ratingBand, baseline);
  const band: WeaknessBandDoc | null = rating ? bandOf(rating.rating, rating.source) : null;
  const mix = band ? bandMix(band, baseline, analysed.map((x) => ({ g: x.g, moves: x.d.stats.moves })), scope.timeClasses) : null;

  let watermark: Date | null = null;
  for (const { g } of analysed) if (g.endedAt && (!watermark || g.endedAt > watermark)) watermark = g.endedAt;

  const base = {
    v: 1 as const,
    scope: { timeClasses: scope.timeClasses, since: since.toISOString(), months: scope.months, maxGames: scope.maxGames },
    games: { inScope: games.length, analysed: analysed.length, excludedBot },
    band,
    failure: null,
    inputs: { watermarkEndedAt: iso(watermark), healed: ctx.healed ?? 0, baseline: baseline.id, engineProfile: baseline.profile },
  };

  if (analysed.length < GAMES_REQUIRED) {
    const metrics: WeaknessMetricsV1 = {
      ...base,
      listMode: band ? "vs_band" : "own_only",
      rows: [],
      topKeys: [],
      preliminary: preliminaryPatterns(agg, analysed.length),
      headline: null,
      breakdown: null,
    };
    return draft("INSUFFICIENT", scope, since, metrics, null);
  }

  const { listMode, rows } = rowsOf(analysed, agg, mix, ctx.now);
  const phase = phaseBreakdown(analysed, mix);
  const clock = clockBreakdown(agg, mix);
  const strengths = strengthsOf(analysed, phase, mix);
  const breakdown = {
    phase,
    phaseSentence: phaseSentence(phase),
    clock,
    openings: openingsBreakdown(games),
    strengths: strengths.sentences,
    strengthKeys: strengths.keys,
    pieces: pieceBreakdown(agg),
  };
  const headline = verifiedHeadline(listMode, rows, breakdown);
  const metrics: WeaknessMetricsV1 = {
    ...base,
    listMode,
    rows,
    topKeys: rows.slice(0, 3).map((r) => r.pattern),
    preliminary: [],
    headline,
    breakdown,
  };
  return draft("READY", scope, since, metrics, headline.text);
}

function draft(status: "READY" | "INSUFFICIENT", scope: WeaknessScope, since: Date, metrics: WeaknessMetricsV1, headline: string | null): WeaknessSnapshotDraft {
  return {
    status,
    timeClasses: scope.timeClasses,
    since,
    gamesInScope: metrics.games.inScope,
    gamesAnalysed: metrics.games.analysed,
    ratingBandMin: metrics.band?.min ?? null,
    ratingBandMax: metrics.band?.max ?? null,
    metrics,
    headline,
  };
}

/**
 * The metrics of a FAILED row (written by the worker after the final attempt, only when no READY row exists): the
 * scope and counts it knew, no rows, `failure {code, at}`.
 */
export function failedMetrics(i: {
  code: string;
  at: Date;
  scope: WeaknessScope;
  since: Date;
  inScope: number;
  analysed: number;
  baseline: Pick<BaselineV1, "id" | "profile">;
}): WeaknessMetricsV1 {
  return {
    v: 1,
    scope: { timeClasses: i.scope.timeClasses, since: i.since.toISOString(), months: i.scope.months, maxGames: i.scope.maxGames },
    games: { inScope: i.inScope, analysed: i.analysed, excludedBot: 0 },
    band: null,
    listMode: "own_only",
    rows: [],
    topKeys: [],
    preliminary: [],
    headline: null,
    breakdown: null,
    failure: { code: i.code.slice(0, 40), at: i.at.toISOString() },
    inputs: { watermarkEndedAt: null, healed: 0, baseline: i.baseline.id, engineProfile: i.baseline.profile },
  };
}

/**
 * Attaches the example positions the worker read (Q-W6: the newest visible mistake carrying each row's pattern,
 * puzzles first; the FEN after `setupUci`, the member to move; `orient` = the member's colour). Rows without an
 * example keep `null` (no board in the row).
 */
export function attachExamples(metrics: WeaknessMetricsV1, examples: ReadonlyMap<string, WeaknessExampleDoc>): WeaknessMetricsV1 {
  return { ...metrics, rows: metrics.rows.map((r) => ({ ...r, example: examples.get(r.pattern) ?? r.example })) };
}

/** The newest-first order of game sides (Q-W5), for callers that build inputs. */
export { byNewest };
