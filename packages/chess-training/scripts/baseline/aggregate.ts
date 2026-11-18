// J5 aggregation (phase-06 plan §7.4.5 steps 5–7): per-side records → one BaselineCell per (band × time class), the
// calibration factors, and the v1 document. Pure. The cell numbers are computed by the weakness engine's OWN
// aggregation (TRN src/weakness: decodeGame, aggregate, bookExitOf, the phase rule; conversion from the same STATS_V1
// slots over every side, where a member's own rate looks at their newest 30 games), so a member's
// "you" and the band's number come out of one computation and can only differ by the games they are given.
import { GRADING_VERSION, ENGINE_PROFILE } from "@repo/chess-analysis/version";
import type { BaselineCalibration, BaselineCell, BaselineV1 } from "../../baselines/schema";
import { WEAKNESS_CANDIDATES } from "../../src/themes";
import { aggregate, type AnalysedGame } from "../../src/weakness/aggregate";
import { ALGO_VERSION, PHASE_MIN_MOVES_GAME } from "../../src/weakness/constants";
import { decodeGame } from "../../src/weakness/records";
import { bookExitOf } from "../../src/weakness/strengths";
import { WEAKNESS_INPUTS_VERSION } from "@repo/chess-analysis/weakness-inputs";
import { BAND_KEYS, SAMPLE_TIME_CLASSES } from "./pgn";
import type { CalibrationRecord, SideRecord } from "./side";

export const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** A side record as the weakness engine's game input (only the fields the aggregation reads matter). */
export function asAnalysed(r: SideRecord): AnalysedGame {
  const g = {
    gameId: r.id,
    color: r.color,
    endedAt: null,
    timeClass: null,
    mode: "IMPORTED",
    result: r.result,
    ratingBefore: r.elo,
    rated: true,
    source: "LICHESS",
    oppTitle: null,
    ecoCode: null,
    accuracy: r.accuracy,
    phaseAccuracy: r.phaseAccuracy,
    stats: r.inputs.stats,
    errorLog: r.inputs.errorLog,
    errorThemeN: r.inputs.errorThemeN,
    errorThemes: r.inputs.errorThemes,
    weaknessInputsV: WEAKNESS_INPUTS_VERSION,
    evalSource: "LICHESS",
  } as const;
  const d = decodeGame(g);
  if (!d) throw new Error(`side ${r.id}:${r.color}: inputs do not decode`);
  return { g: { ...g, phaseAccuracy: [...r.phaseAccuracy], stats: [...r.inputs.stats] }, d };
}

/** The theme keys a cell lists: every weakness candidate except time pressure (its own block). */
export function cellThemeKeys(): string[] {
  return WEAKNESS_CANDIDATES.filter((k) => k !== "rc:timePressure").sort();
}

/** One cell from its sides (plan §7.4.5 step 5). */
export function aggregateCell(records: readonly SideRecord[]): BaselineCell {
  const games = records.map(asAnalysed);
  const a = aggregate(games);
  const themes: BaselineCell["themes"] = {};
  for (const key of cellThemeKeys()) {
    const t = a.themes.get(key);
    themes[key] = { per100: r4(100 * ratio(t?.k ?? 0, a.M)), loss100: r4(100 * ratio(t?.L ?? 0, a.M)), capped100: r4(100 * ratio(t?.kCapped ?? 0, a.M)) };
  }
  const phaseAccuracy = [0, 1, 2].map((p) => {
    let num = 0;
    let den = 0;
    for (const { g, d } of games) {
      const acc = g.phaseAccuracy[p] as number;
      const m = d.stats.phaseMoves[p] as number;
      if (acc < 0 || m < PHASE_MIN_MOVES_GAME) continue;
      num += acc * m;
      den += m;
    }
    return r4(ratio(num, den));
  }) as BaselineCell["phaseAccuracy"];
  const clockBlunders100 = a.clockBlunders.map((b, i) => r4(100 * ratio(b, a.clockMoves[i] as number))) as BaselineCell["clockBlunders100"];
  // Conversion over every side of the cell (STATS_V1 slots 27–28; a member's own rate uses their newest 30 games).
  const conv = { reached: 0, converted: 0 };
  for (const { d } of games) {
    if (d.stats.reachedPlus3) conv.reached += 1;
    if (d.stats.converted) conv.converted += 1;
  }
  const exits = bookExitOf(games);
  return {
    moves: a.M,
    sides: records.length,
    themes,
    timePressure: { movesLt1: a.Mlt1, blundersLt1: a.tp.k, per100Lt1: clockBlunders100[3], loss100: r4(100 * ratio(a.tp.L, a.M)) },
    phaseAccuracy,
    clockBlunders100,
    clockMoves: [...a.clockMoves] as BaselineCell["clockMoves"],
    conversion: r4(ratio(conv.converted, conv.reached)),
    bookExitEqualShare: { w: r4(ratio(exits.w.equal, exits.w.n)), b: r4(ratio(exits.b.equal, exits.b.n)) },
    pieceErrors100: a.pieceErrors.map((e, i) => r4(100 * ratio(e, a.pieceMoves[i] as number))) as BaselineCell["pieceErrors100"],
  };
}

/** Calibration factors are clamped to the schema's range (a factor outside it means a broken grading, not a bias). */
export const CALIBRATION_MIN = 0.1;
export const CALIBRATION_MAX = 10;
/** A band needs this many %eval errors of a judgement before its factor is trusted; else the pooled factor is used. */
export const CALIBRATION_MIN_EVENTS = 30;

export interface CalibrationResult {
  factors: Record<string, BaselineCalibration>;
  /** Per band: sides, moves and events behind each factor, and which factors fell back to the pooled one. */
  detail: Record<string, { sides: number; moves: { eval: number; engine: number }; events: Record<string, { eval: number; engine: number }>; pooled: string[] }>;
}

const JUDGEMENTS = ["MISTAKE", "BLUNDER", "MISS"] as const;

/**
 * calibration[band][J] = (our engine's J per graded move) / (the %eval J per graded move) over the band's calibration
 * sides (plan §7.4.5 step 6, R-WK-03); ALL = every error. Bands without calibration sides (or with too few events)
 * take the factor pooled over every calibrated band.
 */
export function calibrationOf(records: readonly CalibrationRecord[], bandKeys: readonly string[] = BAND_KEYS): CalibrationResult {
  const byBand = new Map<string, CalibrationRecord[]>();
  for (const r of records) {
    const band = r.key.split(":")[0] as string;
    byBand.set(band, [...(byBand.get(band) ?? []), r]);
  }
  const sum = (rs: readonly CalibrationRecord[]) => {
    const s = { eval: { moves: 0, MISTAKE: 0, BLUNDER: 0, MISS: 0 }, engine: { moves: 0, MISTAKE: 0, BLUNDER: 0, MISS: 0 } };
    for (const r of rs)
      for (const side of ["eval", "engine"] as const) {
        s[side].moves += r[side].moves;
        for (const j of JUDGEMENTS) s[side][j] += r[side][j];
      }
    return s;
  };
  const factor = (s: ReturnType<typeof sum>, j: (typeof JUDGEMENTS)[number] | "ALL"): { value: number; events: number; engineEvents: number } => {
    const ev = j === "ALL" ? JUDGEMENTS.reduce((t, k) => t + s.eval[k], 0) : s.eval[j];
    const en = j === "ALL" ? JUDGEMENTS.reduce((t, k) => t + s.engine[k], 0) : s.engine[j];
    const rateEval = ratio(ev, s.eval.moves);
    const rateEngine = ratio(en, s.engine.moves);
    const value = rateEval > 0 ? rateEngine / rateEval : 1;
    return { value: r4(Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, value))), events: ev, engineEvents: en };
  };
  const pooled = sum(records);
  const factors: Record<string, BaselineCalibration> = {};
  const detail: CalibrationResult["detail"] = {};
  for (const band of bandKeys) {
    const rs = byBand.get(band) ?? [];
    const s = sum(rs);
    const f: Record<string, number> = {};
    const events: Record<string, { eval: number; engine: number }> = {};
    const usedPooled: string[] = [];
    for (const j of [...JUDGEMENTS, "ALL"] as const) {
      const own = factor(s, j);
      events[j] = { eval: own.events, engine: own.engineEvents };
      if (own.events >= CALIBRATION_MIN_EVENTS) f[j] = own.value;
      else {
        f[j] = factor(pooled, j).value;
        usedPooled.push(j);
      }
    }
    factors[band] = { MISTAKE: f.MISTAKE as number, BLUNDER: f.BLUNDER as number, MISS: f.MISS as number, ALL: f.ALL as number };
    detail[band] = { sides: rs.length, moves: { eval: s.eval.moves, engine: s.engine.moves }, events, pooled: usedPooled };
  }
  return { factors, detail };
}

/** The dispersion's clamp (the schema's range). */
export const DISPERSION_MAX = 10;

/**
 * FIX-2: the pooled Pearson dispersion of every candidate key (plan §8.6 as corrected, docs/decisions.md D-P6-FIX2-1):
 * per cell c with rate p_c = Σ capped events / Σ moves, φ = Σ_sides (k_i − m_i·p_c)² / Σ_sides m_i·p_c over every cell,
 * floored at 1 (a count is never treated as less variable than Poisson). Time pressure: blunders under a minute over
 * moves under a minute (its count is not capped, as the member's is not).
 */
export function dispersionOf(cells: ReadonlyMap<string, readonly SideRecord[]>): Record<string, number> {
  const keys = [...cellThemeKeys(), "rc:timePressure"];
  const num = new Map<string, number>(keys.map((k) => [k, 0]));
  const den = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const records of cells.values()) {
    const sides = records.map((r) => aggregate([asAnalysed(r)]));
    const count = (a: (typeof sides)[number], key: string): { k: number; m: number } =>
      key === "rc:timePressure" ? { k: a.tp.k, m: a.Mlt1 } : { k: a.themes.get(key)?.kCapped ?? 0, m: a.M };
    for (const key of keys) {
      let k = 0;
      let m = 0;
      for (const a of sides) {
        const c = count(a, key);
        k += c.k;
        m += c.m;
      }
      const p = ratio(k, m);
      if (p === 0) continue;
      let resid = 0;
      for (const a of sides) {
        const c = count(a, key);
        resid += (c.k - c.m * p) ** 2;
      }
      num.set(key, (num.get(key) ?? 0) + resid);
      den.set(key, (den.get(key) ?? 0) + m * p);
    }
  }
  const out: Record<string, number> = {};
  for (const key of keys.sort()) {
    const d = den.get(key) ?? 0;
    out[key] = r4(Math.min(DISPERSION_MAX, Math.max(1, d > 0 ? (num.get(key) ?? 0) / d : 1)));
  }
  return out;
}

export interface BuildInput {
  cells: ReadonlyMap<string, readonly SideRecord[]>;
  calibration: Record<string, BaselineCalibration>;
  dump: string;
  games: number;
  builtAt: string;
}

/** The v1 document (plan §7.4.5 step 7). Every band 600–2400 × BULLET / BLITZ / RAPID must have records. */
export function buildBaseline(input: BuildInput): BaselineV1 {
  const bands: BaselineV1["bands"] = {};
  for (const band of BAND_KEYS) {
    const row: Partial<Record<(typeof SAMPLE_TIME_CLASSES)[number], BaselineCell>> = {};
    for (const tc of SAMPLE_TIME_CLASSES) {
      const rs = input.cells.get(`${band}:${tc}`) ?? [];
      if (rs.length === 0) throw new Error(`cell ${band}:${tc} has no graded side`);
      row[tc] = aggregateCell(rs);
    }
    bands[band] = row as BaselineV1["bands"][string];
  }
  return {
    v: 1,
    id: "v1",
    synthetic: false,
    algoVersion: ALGO_VERSION,
    gradingVersion: GRADING_VERSION,
    profile: ENGINE_PROFILE.id,
    source: { dump: input.dump, games: input.games, builtAt: input.builtAt },
    ratingOffsets: { CHESSCOM: { BULLET: 0, BLITZ: 0, RAPID: 0 } },
    dispersion: dispersionOf(input.cells),
    calibration: input.calibration,
    bands,
  };
}

/** The committed text of a baseline: one line per band and time class (diffable), keys in a fixed order. */
export function baselineJson(b: BaselineV1): string {
  const { bands, calibration, ...head } = b;
  const lines: string[] = ["{"];
  for (const [k, v] of Object.entries(head)) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const cal = Object.entries(calibration).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  lines.push(`  "calibration": {`, cal.join(",\n"), "  },", `  "bands": {`);
  const bandLines = Object.entries(bands).map(([k, tcs]) => {
    const cells = Object.entries(tcs).map(([tc, c]) => `      ${JSON.stringify(tc)}: ${JSON.stringify(c)}`);
    return `    ${JSON.stringify(k)}: {\n${cells.join(",\n")}\n    }`;
  });
  lines.push(bandLines.join(",\n"), "  }", "}");
  return `${lines.join("\n")}\n`;
}
