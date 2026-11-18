// Shapes of the Weakness Profile engine (phase-06 plan §6.3, §7.4.2, §8; signatures.md §2, §6). One source for each:
//   - the per-game record vocabulary (phases, clock buckets, pieces) is the codec's (@repo/chess-analysis: STATS_V1 /
//     ERROR_LOG_V1 index order), re-exported here;
//   - the stored document (`weakness_snapshots.metrics`, WeaknessMetricsV1) and its parts are the types of the ONE zod
//     schema in @repo/contracts/internal/weakness-metrics, imported as types only (no zod in a browser bundle).
//     @repo/db/json validates writes and reads with that same schema;
//   - the input row (`WeaknessGameInput`) and the scope types are the engine's own.
// `vocabulary.test.ts` checks that the codec's tuples and the wire contract's (which cannot import the codec) agree.
import type { ClockBucketKey } from "@repo/chess-analysis/clock";
import { CLOCK_BUCKET_KEYS } from "@repo/chess-analysis/clock";
import type { StatsPiece, WeaknessPhase } from "@repo/chess-analysis/codec";
import { STATS_V1_PIECES, WEAKNESS_PHASES } from "@repo/chess-analysis/codec";
import type {
  ClockBucketDoc,
  HeadlineClaim,
  OpeningRowDoc,
  WeaknessBandDoc,
  WeaknessBreakdownDoc,
  WeaknessExampleDoc,
  WeaknessHeadlineDoc,
  WeaknessMetricsRow,
  WeaknessMetricsV1,
} from "@repo/contracts/internal/weakness-metrics";

export type {
  ClockBucketDoc,
  HeadlineClaim,
  OpeningRowDoc,
  WeaknessBandDoc,
  WeaknessBreakdownDoc,
  WeaknessExampleDoc,
  WeaknessHeadlineDoc,
  WeaknessMetricsRow,
  WeaknessMetricsV1,
  WeaknessPhase,
};

export type TimeClassW = WeaknessMetricsV1["scope"]["timeClasses"][number];
export type DbTimeClass = TimeClassW | "DAILY" | "UNTIMED";
export type ClockKey = ClockBucketKey;
export type GameModeDb = "LEGEND_BOT" | "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT" | "IMPORTED";
export type PlayerResultDb = "WIN" | "LOSS" | "DRAW" | "ABORTED";
export type GameSourceDb = "REPLAY" | "CHESSCOM" | "LICHESS";
export type RatingBandDb = "NEW_TO_CHESS" | "UNDER_800" | "R800_1200" | "R1200_1600" | "R1600_2000" | "R2000_PLUS";
export type BandSource = WeaknessBandDoc["source"];
export type ListMode = WeaknessMetricsV1["listMode"];
export type Trend = WeaknessMetricsRow["trend"];
export type StrengthKey = WeaknessBreakdownDoc["strengthKeys"][number];
export type PieceKey = StatsPiece;

/** Phase order of the STATS_V1 phase slots and ERROR_LOG_V1's phase field. */
export const PHASES: readonly WeaknessPhase[] = WEAKNESS_PHASES;
/** Clock bucket order of STATS_V1 slots 7–14 (ERROR_LOG_V1 bucket − 1). */
export const CLOCK_KEYS: readonly ClockKey[] = CLOCK_BUCKET_KEYS;
/** Moved-piece order of STATS_V1 slots 15–26. */
export const PIECES = STATS_V1_PIECES;

/**
 * One member side of a game (a `game_players` row joined to its game; Q-W5 plus `evalSource`). The four input
 * arrays come from `computeSideInputs()` (CA/src/weakness-inputs.ts) in P3's final analysis batch or the heal.
 */
export interface WeaknessGameInput {
  /** Decimal string. */
  gameId: string;
  color: "w" | "b";
  endedAt: Date | null;
  timeClass: DbTimeClass | null;
  mode: GameModeDb;
  result: PlayerResultDb | null;
  ratingBefore: number | null;
  rated: boolean;
  source: GameSourceDb;
  /** The opponent's title (`games."whiteTitle"`/`"blackTitle"`); imported `BOT` opponents are excluded (R-LI-09). */
  oppTitle: string | null;
  ecoCode: string | null;
  /** Analysed ⇔ not null. */
  accuracy: number | null;
  /** [opening, middlegame, endgame]; −1 = phase not reached. */
  phaseAccuracy: readonly number[];
  /** STATS_V1 (30 smallints) or [] when not computed. */
  stats: readonly number[];
  /** ERROR_LOG_V1: one code per MISTAKE/BLUNDER/MISS ply of this side, ply order. */
  errorLog: readonly number[];
  /** Per error: how many consecutive `errorThemes` entries belong to it. */
  errorThemeN: readonly number[];
  errorThemes: readonly string[];
  /** 0 = the four arrays are not computed yet (the caller heals first). */
  weaknessInputsV: number;
  /** `game_analyses."evalSource"`; ENGINE when absent. Imported Lichess `%eval` games are not calibrated (§8.4). */
  evalSource?: "ENGINE" | "LICHESS" | "MIXED" | null;
}

/** The scope columns of `training_profiles` (M6). */
export interface WeaknessProfileRow {
  /** Empty = the default (RAPID, BLITZ). */
  weaknessTimeClasses: readonly string[];
  /** 0 = the default (6). */
  weaknessMonths: number;
}

export interface WeaknessScope {
  timeClasses: TimeClassW[];
  months: 3 | 6 | 12;
  maxGames: 300;
}

/** Snapshot status values the worker writes (COMPUTING is derived at read time and never stored). */
export type SnapshotStatus = "READY" | "INSUFFICIENT" | "FAILED";
