// The rating-band baseline (phase-06 plan §7.4.5, §8.4; signatures.md §3): what players of each 100-point Lichess
// rating cell do, per time class, measured with the worker's own grading pipeline (`sf18-v1`, the same STATS_V1 /
// ERROR_LOG_V1 records and the same tagger). `v0-synthetic.json` (generated from fixture distributions) unblocks
// integration until WP2's `v1.json` lands; the worker refuses a synthetic baseline for READY snapshots in production.
//
// The validator is hand-written (the training library has no zod dependency; the worker and the tests parse the file
// once per process). Pure: no Node built-ins.

export const BASELINE_TIME_CLASSES = ["BULLET", "BLITZ", "RAPID"] as const;
export type BaselineTimeClass = (typeof BASELINE_TIME_CLASSES)[number];

export interface BaselineThemeCell {
  /** Errors carrying the theme per 100 moves. */
  per100: number;
  /** Win% points lost to those errors per 100 moves. */
  loss100: number;
  /**
   * FIX-2: the same errors counting at most EVENTS_PER_GAME_CAP (2) per game side, per 100 moves: the rate the
   * eligibility test compares a member's capped count with (a member's count is capped the same way). Absent in v0
   * (synthetic): `per100` stands in.
   */
  capped100?: number;
}

export interface BaselineCell {
  moves: number;
  sides: number;
  /** Every weakness candidate key except `rc:timePressure` (missing key = rate 0). */
  themes: Record<string, BaselineThemeCell>;
  timePressure: { movesLt1: number; blundersLt1: number; per100Lt1: number; loss100: number };
  /** Move-weighted Lichess-style accuracy per phase: opening, middlegame, endgame. */
  phaseAccuracy: [number, number, number];
  /** Blunders per 100 moves by the clock before the move: gt5, 2to5, 1to2, lt1. */
  clockBlunders100: [number, number, number, number];
  clockMoves: [number, number, number, number];
  /** Share of games reaching +3 that were won. */
  conversion: number;
  /** Share of games leaving book with Win% ≥ 45, per colour. */
  bookExitEqualShare: { w: number; b: number };
  /** Errors per 100 moves by the moved piece: p n b r q k. */
  pieceErrors100: [number, number, number, number, number, number];
}

export interface BaselineCalibration {
  MISTAKE: number;
  BLUNDER: number;
  MISS: number;
  /** All errors together: applied to theme rates and losses. */
  ALL: number;
}

export interface BaselineV1 {
  v: 1;
  /** "v0-synthetic" | "v1" (`metrics.inputs.baseline`). */
  id: string;
  synthetic: boolean;
  algoVersion: number;
  gradingVersion: number;
  /** The engine profile the baseline was graded with; must equal ENGINE_PROFILE.id ("sf18-v1"). */
  profile: string;
  source: { dump: string; games: number; builtAt: string };
  ratingOffsets: { CHESSCOM: Record<BaselineTimeClass, number> };
  /**
   * FIX-2: per candidate key (`rc:timePressure` included), the Pearson dispersion of the per-game capped event counts
   * around the cells' rates, pooled over every cell (≥ 1): how much more a member's count varies than a Poisson count
   * does, because errors inside one game are not independent. The eligibility test widens by it. Absent: 1.
   */
  dispersion?: Record<string, number>;
  /** Our engine's rate / the `%eval` rate per band key (R-WK-03); 1 when not calibrated. */
  calibration: Record<string, BaselineCalibration>;
  /** Band key ("600" … "2400", the lower edge of a 100-point cell) → time class → cell. */
  bands: Record<string, Record<BaselineTimeClass, BaselineCell>>;
}

export class BaselineError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`baseline ${path}: ${message}`);
    this.name = "BaselineError";
  }
}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new BaselineError(path, "expected an object");
  return v as Obj;
}

function strictKeys(o: Obj, keys: readonly string[], path: string, optional: readonly string[] = []): void {
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k)) throw new BaselineError(`${path}.${k}`, "unknown key");
  for (const k of keys) if (!(k in o)) throw new BaselineError(`${path}.${k}`, "missing");
}

function num(v: unknown, path: string, o: { min?: number; max?: number; int?: boolean } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BaselineError(path, "expected a finite number");
  if (o.int && !Number.isInteger(v)) throw new BaselineError(path, "expected an integer");
  if (o.min !== undefined && v < o.min) throw new BaselineError(path, `below ${o.min}`);
  if (o.max !== undefined && v > o.max) throw new BaselineError(path, `above ${o.max}`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string" || v.length === 0) throw new BaselineError(path, "expected a non-empty string");
  return v;
}

function tuple<N extends number>(v: unknown, n: N, path: string, o: { min?: number; max?: number; int?: boolean } = {}): number[] {
  if (!Array.isArray(v) || v.length !== n) throw new BaselineError(path, `expected ${n} numbers`);
  return v.map((x, i) => num(x, `${path}[${i}]`, o));
}

const THEME_KEY = /^(rc:)?[a-z][A-Za-z0-9]{1,31}$/;
const BAND_KEY = /^(\d{3,4})$/;

function parseCell(raw: unknown, path: string): BaselineCell {
  const c = obj(raw, path);
  strictKeys(
    c,
    ["moves", "sides", "themes", "timePressure", "phaseAccuracy", "clockBlunders100", "clockMoves", "conversion", "bookExitEqualShare", "pieceErrors100"],
    path,
  );
  const themesRaw = obj(c.themes, `${path}.themes`);
  const themes: Record<string, BaselineThemeCell> = {};
  for (const [key, cellRaw] of Object.entries(themesRaw)) {
    if (!THEME_KEY.test(key) || key === "rc:timePressure") throw new BaselineError(`${path}.themes.${key}`, "not a theme candidate key");
    const t = obj(cellRaw, `${path}.themes.${key}`);
    strictKeys(t, ["per100", "loss100"], `${path}.themes.${key}`, ["capped100"]);
    const per100 = num(t.per100, `${path}.themes.${key}.per100`, { min: 0, max: 100 });
    themes[key] = { per100, loss100: num(t.loss100, `${path}.themes.${key}.loss100`, { min: 0 }) };
    if (t.capped100 !== undefined) themes[key].capped100 = num(t.capped100, `${path}.themes.${key}.capped100`, { min: 0, max: per100 });
  }
  const tp = obj(c.timePressure, `${path}.timePressure`);
  strictKeys(tp, ["movesLt1", "blundersLt1", "per100Lt1", "loss100"], `${path}.timePressure`);
  const share = obj(c.bookExitEqualShare, `${path}.bookExitEqualShare`);
  strictKeys(share, ["w", "b"], `${path}.bookExitEqualShare`);
  return {
    moves: num(c.moves, `${path}.moves`, { min: 0, int: true }),
    sides: num(c.sides, `${path}.sides`, { min: 0, int: true }),
    themes,
    timePressure: {
      movesLt1: num(tp.movesLt1, `${path}.timePressure.movesLt1`, { min: 0, int: true }),
      blundersLt1: num(tp.blundersLt1, `${path}.timePressure.blundersLt1`, { min: 0, int: true }),
      per100Lt1: num(tp.per100Lt1, `${path}.timePressure.per100Lt1`, { min: 0, max: 100 }),
      loss100: num(tp.loss100, `${path}.timePressure.loss100`, { min: 0 }),
    },
    phaseAccuracy: tuple(c.phaseAccuracy, 3, `${path}.phaseAccuracy`, { min: 0, max: 100 }) as BaselineCell["phaseAccuracy"],
    clockBlunders100: tuple(c.clockBlunders100, 4, `${path}.clockBlunders100`, { min: 0, max: 100 }) as BaselineCell["clockBlunders100"],
    clockMoves: tuple(c.clockMoves, 4, `${path}.clockMoves`, { min: 0, int: true }) as BaselineCell["clockMoves"],
    conversion: num(c.conversion, `${path}.conversion`, { min: 0, max: 1 }),
    bookExitEqualShare: { w: num(share.w, `${path}.bookExitEqualShare.w`, { min: 0, max: 1 }), b: num(share.b, `${path}.bookExitEqualShare.b`, { min: 0, max: 1 }) },
    pieceErrors100: tuple(c.pieceErrors100, 6, `${path}.pieceErrors100`, { min: 0, max: 100 }) as BaselineCell["pieceErrors100"],
  };
}

/** Parses and validates a baseline document (strict: unknown keys are errors). Throws BaselineError(path). */
export function parseBaseline(raw: unknown): BaselineV1 {
  const b = obj(raw, "$");
  strictKeys(b, ["v", "id", "synthetic", "algoVersion", "gradingVersion", "profile", "source", "ratingOffsets", "calibration", "bands"], "$", ["dispersion"]);
  if (b.v !== 1) throw new BaselineError("$.v", "expected 1");
  if (typeof b.synthetic !== "boolean") throw new BaselineError("$.synthetic", "expected a boolean");
  const source = obj(b.source, "$.source");
  strictKeys(source, ["dump", "games", "builtAt"], "$.source");
  const offsets = obj(b.ratingOffsets, "$.ratingOffsets");
  strictKeys(offsets, ["CHESSCOM"], "$.ratingOffsets");
  const chesscom = obj(offsets.CHESSCOM, "$.ratingOffsets.CHESSCOM");
  strictKeys(chesscom, BASELINE_TIME_CLASSES, "$.ratingOffsets.CHESSCOM");
  const calibrationRaw = obj(b.calibration, "$.calibration");
  const calibration: Record<string, BaselineCalibration> = {};
  for (const [band, cRaw] of Object.entries(calibrationRaw)) {
    if (!BAND_KEY.test(band)) throw new BaselineError(`$.calibration.${band}`, "not a band key");
    const c = obj(cRaw, `$.calibration.${band}`);
    strictKeys(c, ["MISTAKE", "BLUNDER", "MISS", "ALL"], `$.calibration.${band}`);
    calibration[band] = {
      MISTAKE: num(c.MISTAKE, `$.calibration.${band}.MISTAKE`, { min: 0.1, max: 10 }),
      BLUNDER: num(c.BLUNDER, `$.calibration.${band}.BLUNDER`, { min: 0.1, max: 10 }),
      MISS: num(c.MISS, `$.calibration.${band}.MISS`, { min: 0.1, max: 10 }),
      ALL: num(c.ALL, `$.calibration.${band}.ALL`, { min: 0.1, max: 10 }),
    };
  }
  const bandsRaw = obj(b.bands, "$.bands");
  const bands: Record<string, Record<BaselineTimeClass, BaselineCell>> = {};
  for (const [band, tcRaw] of Object.entries(bandsRaw)) {
    const m = BAND_KEY.exec(band);
    if (!m || Number(band) % 100 !== 0) throw new BaselineError(`$.bands.${band}`, "a band key is the lower edge of a 100-point cell");
    const tcs = obj(tcRaw, `$.bands.${band}`);
    strictKeys(tcs, BASELINE_TIME_CLASSES, `$.bands.${band}`);
    bands[band] = {
      BULLET: parseCell(tcs.BULLET, `$.bands.${band}.BULLET`),
      BLITZ: parseCell(tcs.BLITZ, `$.bands.${band}.BLITZ`),
      RAPID: parseCell(tcs.RAPID, `$.bands.${band}.RAPID`),
    };
  }
  if (Object.keys(bands).length === 0) throw new BaselineError("$.bands", "no band");
  let dispersion: Record<string, number> | undefined;
  if (b.dispersion !== undefined) {
    const d = obj(b.dispersion, "$.dispersion");
    dispersion = {};
    for (const [key, v] of Object.entries(d)) {
      if (!THEME_KEY.test(key)) throw new BaselineError(`$.dispersion.${key}`, "not a candidate key");
      dispersion[key] = num(v, `$.dispersion.${key}`, { min: 1, max: 10 });
    }
  }
  return {
    v: 1,
    id: str(b.id, "$.id"),
    synthetic: b.synthetic,
    algoVersion: num(b.algoVersion, "$.algoVersion", { min: 1, int: true }),
    gradingVersion: num(b.gradingVersion, "$.gradingVersion", { min: 1, int: true }),
    profile: str(b.profile, "$.profile"),
    source: { dump: str(source.dump, "$.source.dump"), games: num(source.games, "$.source.games", { min: 0, int: true }), builtAt: str(source.builtAt, "$.source.builtAt") },
    ratingOffsets: {
      CHESSCOM: {
        BULLET: num(chesscom.BULLET, "$.ratingOffsets.CHESSCOM.BULLET", { min: -500, max: 500 }),
        BLITZ: num(chesscom.BLITZ, "$.ratingOffsets.CHESSCOM.BLITZ", { min: -500, max: 500 }),
        RAPID: num(chesscom.RAPID, "$.ratingOffsets.CHESSCOM.RAPID", { min: -500, max: 500 }),
      },
    },
    ...(dispersion ? { dispersion } : {}),
    calibration,
    bands,
  };
}

/** The band keys of a baseline, low to high. */
export function bandKeys(b: BaselineV1): string[] {
  return Object.keys(b.bands).sort((x, y) => Number(x) - Number(y));
}

/* ------------------------------------------------------------------------------------------------------------ */
/* v1.meta.json: how a real baseline was built (plan §7.4.5 step 7; FE 10.12.4 engine pin)                        */
/* ------------------------------------------------------------------------------------------------------------ */

export interface BaselineMetaCell {
  sides: number;
  moves: number;
  /** Eligible sides offered to the cell's reservoir. */
  offers: number;
  /** Sides that could not be graded (an illegal SAN, an eval gap the screen missed). */
  skipped: number;
}

export interface BaselineMetaV1 {
  v: 1;
  /** The baseline this describes ("v1"). */
  id: string;
  profile: string;
  algoVersion: number;
  gradingVersion: number;
  builtAt: string;
  engine: {
    engine: string;
    tag: string;
    commit: string;
    binarySha256: string;
    buildId: string;
    nets: { big: string; small: string };
    benchNodes: number;
    threads: number;
    hashMb: number;
    pass1: { nodes: number; multipv: number };
    runner: string;
  };
  dump: {
    name: string;
    url: string | null;
    /** The sha256 database.lichess.org publishes for the file. */
    sha256Published: string;
    /** True when the whole file was hashed here; false when only byte ranges of it were read (chunk mode). */
    sha256Verified: boolean;
    size: number | null;
    mode: "chunks" | "stream";
    seed: number;
    chunkBytes: number;
    /** Chunk indexes read, in order (chunk k = bytes [k·chunkBytes, (k+1)·chunkBytes)). */
    chunks: number[];
    compressedBytesDecoded: number;
    decompressedBytes: number;
    games: number;
    analysed: number;
    eligible: number;
    offered: number;
    closedReason: string;
  };
  sampling: { samplePerCell: number; closeFactor: number; closeMinChunks: number; rules: string[] };
  cells: Record<string, BaselineMetaCell>;
  /** Cells with fewer sides than samplePerCell, each with its reason. */
  shortfalls: { cell: string; sides: number; moves: number; reason: string }[];
  calibration: {
    timeClass: string;
    sidesPerCell: number;
    detail: Record<string, { sides: number; moves: { eval: number; engine: number }; events: Record<string, { eval: number; engine: number }>; pooled: string[] }>;
  };
  /** How the pipeline differs from the worker's, where it must (recorded residuals, R2). */
  notes: string[];
  runtime: { phases: Record<string, { startedAt: string; finishedAt: string | null; hours: number | null }>; searches: number; threads: number };
}

const SHA256 = /^[0-9a-f]{64}$/;

/** Validates the parts of v1.meta.json the tests and the worker rely on (strict on the pin, loose on the detail). */
export function parseBaselineMeta(raw: unknown): BaselineMetaV1 {
  const m = obj(raw, "meta");
  if (m.v !== 1) throw new BaselineError("meta.v", "expected 1");
  str(m.id, "meta.id");
  str(m.profile, "meta.profile");
  const e = obj(m.engine, "meta.engine");
  for (const k of ["binarySha256"] as const) if (typeof e[k] !== "string" || !SHA256.test(e[k] as string)) throw new BaselineError(`meta.engine.${k}`, "expected a sha256");
  const nets = obj(e.nets, "meta.engine.nets");
  for (const k of ["big", "small"] as const) if (typeof nets[k] !== "string" || !SHA256.test(nets[k] as string)) throw new BaselineError(`meta.engine.nets.${k}`, "expected a sha256");
  if (typeof e.commit !== "string" || !/^[0-9a-f]{40}$/.test(e.commit)) throw new BaselineError("meta.engine.commit", "expected a git commit");
  num(e.benchNodes, "meta.engine.benchNodes", { min: 1, int: true });
  const d = obj(m.dump, "meta.dump");
  str(d.name, "meta.dump.name");
  if (typeof d.sha256Published !== "string" || !SHA256.test(d.sha256Published)) throw new BaselineError("meta.dump.sha256Published", "expected a sha256");
  const s = obj(m.sampling, "meta.sampling");
  num(s.samplePerCell, "meta.sampling.samplePerCell", { min: 1, int: true });
  const cells = obj(m.cells, "meta.cells");
  for (const [k, c] of Object.entries(cells)) {
    const cell = obj(c, `meta.cells.${k}`);
    strictKeys(cell, ["sides", "moves", "offers", "skipped"], `meta.cells.${k}`);
    for (const f of ["sides", "moves", "offers", "skipped"]) num(cell[f], `meta.cells.${k}.${f}`, { min: 0, int: true });
  }
  if (!Array.isArray(m.shortfalls)) throw new BaselineError("meta.shortfalls", "expected an array");
  return raw as BaselineMetaV1;
}
