// Aggregation over the scope set G (phase-06 plan §8.5). With S_g the STATS_V1 record of game g:
//   M = Σ S_g[0] (moves), M_lt1 = Σ S_g[10] (moves with under a minute on the clock);
//   per theme t: k_t (errors carrying t), L_t (their Win% loss; an error with 2 themes counts once per theme, as in
//   the baseline), gamesWith_t, phaseCount_t, and the events made under a minute;
//   time pressure: k_tp = blunders under a minute (rate over M_lt1), L_tp = the loss of every error under a minute
//   (per 100 TOTAL moves, so it ranks on the themes' scale).
// Order-independent (the property test shuffles games). Pure.
import { EVENTS_PER_GAME_CAP } from "./constants";
import { CLOCK_LT1, clockIndex, type DecodedGame, J_BLUNDER } from "./records";
import type { WeaknessGameInput, WeaknessPhase } from "./types";
import { PHASES } from "./types";

export interface AnalysedGame {
  g: WeaknessGameInput;
  d: DecodedGame;
}

export interface PatternAgg {
  /** Events (errors carrying the theme; for time pressure: blunders under a minute). */
  k: number;
  /** Win% points lost. */
  L: number;
  /** Game sides with at least one event (`gameId:color`). */
  games: Set<string>;
  phaseCount: [number, number, number];
  eventsLt1: number;
  /**
   * Events counting at most EVENTS_PER_GAME_CAP per game side (FIX-1, D-P6-FIX1-5): the eligibility statistics (ratio,
   * z) read this, so a theme that clusters inside a few games (every error of one long rook endgame carries
   * `rookEndgame`) is not taken for many independent moves.
   */
  kCapped: number;
  /** Events per game side (`gameId:color`). */
  perGame: Map<string, number>;
}

export interface Aggregate {
  /** Analysed game sides aggregated. */
  n: number;
  M: number;
  Mlt1: number;
  phaseMoves: [number, number, number];
  clockMoves: [number, number, number, number];
  clockBlunders: [number, number, number, number];
  pieceMoves: [number, number, number, number, number, number];
  pieceErrors: [number, number, number, number, number, number];
  themes: Map<string, PatternAgg>;
  /** `rc:timePressure`. */
  tp: PatternAgg;
}

export const sideKey = (g: Pick<WeaknessGameInput, "gameId" | "color">) => `${g.gameId}:${g.color}`;

const emptyPattern = (): PatternAgg => ({ k: 0, L: 0, games: new Set(), phaseCount: [0, 0, 0], eventsLt1: 0, kCapped: 0, perGame: new Map() });

/** One event of a pattern in game side `key`. */
function countEvent(agg: PatternAgg, key: string): void {
  const n = agg.perGame.get(key) ?? 0;
  agg.perGame.set(key, n + 1);
  if (n < EVENTS_PER_GAME_CAP) agg.kCapped += 1;
  agg.k += 1;
  agg.games.add(key);
}

/** Aggregates analysed game sides (decoded inputs). */
export function aggregate(games: readonly AnalysedGame[]): Aggregate {
  const a: Aggregate = {
    n: games.length,
    M: 0,
    Mlt1: 0,
    phaseMoves: [0, 0, 0],
    clockMoves: [0, 0, 0, 0],
    clockBlunders: [0, 0, 0, 0],
    pieceMoves: [0, 0, 0, 0, 0, 0],
    pieceErrors: [0, 0, 0, 0, 0, 0],
    themes: new Map(),
    tp: emptyPattern(),
  };
  for (const { g, d } of games) {
    const s = d.stats;
    const key = sideKey(g);
    a.M += s.moves;
    a.Mlt1 += s.clockMoves[3];
    for (let p = 0; p < 3; p++) a.phaseMoves[p] = a.phaseMoves[p]! + s.phaseMoves[p]!;
    for (let c = 0; c < 4; c++) a.clockMoves[c] = a.clockMoves[c]! + s.clockMoves[c]!;
    for (let i = 0; i < 6; i++) {
      a.pieceMoves[i] = a.pieceMoves[i]! + s.pieceMoves[i]!;
      a.pieceErrors[i] = a.pieceErrors[i]! + s.pieceErrors[i]!;
    }
    for (const e of d.errors) {
      const lt1 = e.clockBucket === CLOCK_LT1;
      const ci = clockIndex(e.clockBucket);
      if (ci !== null && e.judgement === J_BLUNDER) a.clockBlunders[ci] += 1;
      if (lt1) {
        a.tp.L += e.winLoss;
        if (e.judgement === J_BLUNDER) {
          countEvent(a.tp, key);
          a.tp.phaseCount[e.phase] += 1;
          a.tp.eventsLt1 += 1;
        }
      }
      for (const t of new Set(e.themes)) {
        let agg = a.themes.get(t);
        if (!agg) {
          agg = emptyPattern();
          a.themes.set(t, agg);
        }
        countEvent(agg, key);
        agg.L += e.winLoss;
        agg.phaseCount[e.phase] += 1;
        if (lt1) agg.eventsLt1 += 1;
      }
    }
  }
  return a;
}

/** The pattern's aggregate (`rc:timePressure` → the time-pressure one; an absent theme → zeros). */
export function patternAgg(a: Aggregate, key: string): PatternAgg {
  if (key === "rc:timePressure") return a.tp;
  return a.themes.get(key) ?? emptyPattern();
}

/** `you` = 100·k / n (n = M, or M_lt1 for time pressure); 0 when there are no moves. */
export function ratePer100(k: number, n: number): number {
  return n > 0 ? (100 * k) / n : 0;
}

/** The phase with the most events; ties go to the middlegame, then the opening (§8.19). Null without events. */
export function phaseModeOf(phaseCount: readonly number[]): WeaknessPhase | null {
  const total = phaseCount.reduce((s, x) => s + x, 0);
  if (total === 0) return null;
  const order = [1, 0, 2];
  let best = order[0]!;
  for (const p of order) if (phaseCount[p]! > phaseCount[best]!) best = p;
  return PHASES[best]!;
}
