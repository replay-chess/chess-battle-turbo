// The synthetic rating-band baseline `baselines/v0-synthetic.json` (phase-06 plan §7.4.5 "until v1.json lands";
// signatures.md §3). Deterministic and pure: the same code always produces the same file, so the committed JSON is
// checked against it (baselines/load.test.ts). `build-baseline.ts --synthetic [--check]` writes / checks the file.
//
// The distributions are smooth functions of the rating cell, anchored at the 1100–1300 band the design boards show
// (fork 1.6, loose piece 1.9, time-pressure blunders 2.2 per 100 moves under a minute, phase accuracy 84/76/74): every
// error rate falls and every accuracy rises linearly with the cell's midpoint, so the mean of the cells "1100" and
// "1200" equals the anchor exactly. Blitz and rapid share the anchors (a member's time-class mix does not move the
// numbers); bullet is 35 % more error-prone and 4 points less accurate. Calibration is 1 everywhere (nothing was
// graded twice) and the dispersion 1 (FIX-2: no game structure, every count Poisson). Never used for production
// snapshots: `synthetic: true`.
import { ENGINE_PROFILE, GRADING_VERSION } from "@repo/chess-analysis/version";
import type { BaselineCell, BaselineTimeClass, BaselineV1 } from "../baselines/schema";
import { baselineJson } from "./baseline/aggregate";
import { ALGO_VERSION } from "../src/weakness/constants";
import { WEAKNESS_CANDIDATES } from "../src/themes";

/** The anchor's midpoint: cells "1100" (mid 1150) and "1200" (mid 1250) average to the anchor value. */
const ANCHOR_MID = 1200;
export const SYNTHETIC_BAND_KEYS = Array.from({ length: 19 }, (_, i) => String(600 + i * 100));
const MOVES_PER_CELL = 60_000;
const SIDES_PER_CELL = 2_000;

/** Errors per 100 moves at the anchor, and the Win% points an error of the theme costs on average. */
const THEME_ANCHORS: Readonly<Record<string, { per100: number; loss: number }>> = {
  fork: { per100: 1.6, loss: 18 },
  pin: { per100: 0.9, loss: 16 },
  skewer: { per100: 0.4, loss: 17 },
  discoveredAttack: { per100: 0.6, loss: 18 },
  doubleCheck: { per100: 0.15, loss: 22 },
  sacrifice: { per100: 0.5, loss: 15 },
  exposedKing: { per100: 0.5, loss: 16 },
  kingsideAttack: { per100: 0.4, loss: 16 },
  queensideAttack: { per100: 0.15, loss: 14 },
  hangingPiece: { per100: 1.9, loss: 16 },
  trappedPiece: { per100: 0.3, loss: 17 },
  backRankMate: { per100: 0.35, loss: 24 },
  smotheredMate: { per100: 0.03, loss: 26 },
  mateIn1: { per100: 0.5, loss: 26 },
  mateIn2: { per100: 0.45, loss: 24 },
  mateIn3: { per100: 0.2, loss: 22 },
  promotion: { per100: 0.4, loss: 20 },
  advancedPawn: { per100: 0.6, loss: 15 },
  rookEndgame: { per100: 0.8, loss: 13 },
  pawnEndgame: { per100: 0.35, loss: 18 },
  bishopEndgame: { per100: 0.2, loss: 12 },
  knightEndgame: { per100: 0.15, loss: 12 },
  queenEndgame: { per100: 0.2, loss: 14 },
  queenRookEndgame: { per100: 0.1, loss: 14 },
  "rc:recapture": { per100: 0.6, loss: 12 },
  "rc:defendedTarget": { per100: 0.5, loss: 11 },
  "rc:pawnStructure": { per100: 0.7, loss: 8 },
  "rc:kingSafety": { per100: 0.6, loss: 12 },
  "rc:development": { per100: 0.5, loss: 7 },
  "rc:missedThreat": { per100: 1.2, loss: 15 },
};

/** Time pressure at the anchor: blunders per 100 moves under a minute, and Win% lost per 100 total moves. */
const TP_ANCHOR = { per100Lt1: 2.2, loss100: 3.0 };
const PHASE_ANCHOR: [number, number, number] = [84, 76, 74];
/** gt5, 2to5, 1to2, lt1; the lt1 rate is the time-pressure rate (one computation, copy note C4). */
const CLOCK_ANCHOR: [number, number, number, number] = [0.6, 0.8, 1.5, TP_ANCHOR.per100Lt1];
const CLOCK_SHARES: Record<BaselineTimeClass, [number, number, number, number]> = {
  BULLET: [0.02, 0.33, 0.37, 0.28],
  BLITZ: [0.45, 0.3, 0.17, 0.08],
  RAPID: [0.7, 0.18, 0.08, 0.04],
};
const PIECE_ANCHOR: [number, number, number, number, number, number] = [1.2, 0.8, 0.8, 0.9, 1.1, 0.6];
const CONVERSION_ANCHOR = 0.7;
const BOOK_EXIT_ANCHOR = { w: 0.62, b: 0.55 };

/** Error rates fall 6 % per 100 points; accuracy rises 0.8 points, conversion 1 point, book exit 1 point. */
const RATE_SLOPE = 0.06;
const ACC_SLOPE = 0.8;
const SHARE_SLOPE = 0.01;
const BULLET_RATE = 1.35;
const BULLET_ACC = -4;

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function cell(band: number, tc: BaselineTimeClass): BaselineCell {
  const d = (band + 50 - ANCHOR_MID) / 100;
  const rate = (anchor: number) => r4(anchor * (1 - RATE_SLOPE * d) * (tc === "BULLET" ? BULLET_RATE : 1));
  const acc = (anchor: number) => r4(clamp(anchor + ACC_SLOPE * d + (tc === "BULLET" ? BULLET_ACC : 0), 0, 100));
  const share = (anchor: number) => r4(clamp(anchor + SHARE_SLOPE * d, 0.05, 0.98));
  const clockMoves = CLOCK_SHARES[tc].map((s) => Math.round(s * MOVES_PER_CELL)) as BaselineCell["clockMoves"];
  const clockBlunders100 = CLOCK_ANCHOR.map(rate) as BaselineCell["clockBlunders100"];
  const themes: BaselineCell["themes"] = {};
  for (const key of WEAKNESS_CANDIDATES) {
    const a = THEME_ANCHORS[key];
    if (!a) continue;
    const per100 = rate(a.per100);
    themes[key] = { per100, loss100: r4(per100 * a.loss) };
  }
  const per100Lt1 = clockBlunders100[3];
  return {
    moves: MOVES_PER_CELL,
    sides: SIDES_PER_CELL,
    themes,
    timePressure: {
      movesLt1: clockMoves[3],
      blundersLt1: Math.round((per100Lt1 * clockMoves[3]) / 100),
      per100Lt1,
      loss100: rate(TP_ANCHOR.loss100),
    },
    phaseAccuracy: PHASE_ANCHOR.map(acc) as BaselineCell["phaseAccuracy"],
    clockBlunders100,
    clockMoves,
    conversion: share(CONVERSION_ANCHOR),
    bookExitEqualShare: { w: share(BOOK_EXIT_ANCHOR.w), b: share(BOOK_EXIT_ANCHOR.b) },
    pieceErrors100: PIECE_ANCHOR.map(rate) as BaselineCell["pieceErrors100"],
  };
}

/** The synthetic baseline document (keys in a stable order). */
export function buildSyntheticBaseline(): BaselineV1 {
  const bands: BaselineV1["bands"] = {};
  const calibration: BaselineV1["calibration"] = {};
  for (const key of SYNTHETIC_BAND_KEYS) {
    const band = Number(key);
    bands[key] = { BULLET: cell(band, "BULLET"), BLITZ: cell(band, "BLITZ"), RAPID: cell(band, "RAPID") };
    calibration[key] = { MISTAKE: 1, BLUNDER: 1, MISS: 1, ALL: 1 };
  }
  return {
    v: 1,
    id: "v0-synthetic",
    synthetic: true,
    algoVersion: ALGO_VERSION,
    gradingVersion: GRADING_VERSION,
    profile: ENGINE_PROFILE.id,
    source: { dump: "synthetic (scripts/synthetic-baseline.ts)", games: 0, builtAt: "2026-11-17" },
    ratingOffsets: { CHESSCOM: { BULLET: 0, BLITZ: 0, RAPID: 0 } },
    // FIX-2: the synthetic cells are rates with no game structure behind them: every count is taken as Poisson.
    dispersion: Object.fromEntries([...WEAKNESS_CANDIDATES].sort().map((k) => [k, 1])),
    calibration,
    bands,
  };
}

/** The committed file's text: one line per band and time class (diffable, ≈ 100 KB), with a trailing newline. */
export function syntheticBaselineJson(): string {
  return baselineJson(buildSyntheticBaseline());
}
