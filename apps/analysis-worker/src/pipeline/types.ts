// Shapes the ANALYZE_GAME pipeline reads and writes (phase-03 plan §8.12). The store (store.ts) turns them into
// statements; the pipeline (analyze-game.ts) never writes SQL itself, so the unit tests run it against an in-memory
// store and the integration tests against Postgres with the same code path.
import type { Color } from "@repo/chess-analysis/codec";
import type { StoredLine } from "@repo/chess-analysis/analysis";
import type { ComparisonFactsV1, LinesV1, ReviewContentV1 } from "@repo/db/json";
import type { Statement } from "../db/client";

export type PlayerResultDb = "WIN" | "LOSS" | "DRAW" | "ABORTED";

/** One member side of the game (bots have no row). */
export interface GameMember {
  color: Color;
  userId: string;
  userRef: string;
  result: PlayerResultDb | null;
}

/** The existing `game_analyses` row (resume, regrade). */
export interface StoredAnalysis {
  version: number;
  engine: string;
  nodesPass1: number;
  nodesPass2: number;
  totalPlies: number;
  gradedPlies: number;
  evals: number[];
  second: number[];
  best: number[];
  judgements: number[];
  lines: Record<string, StoredLine> | null;
  /** completedAt is set (the final write ran). */
  completed: boolean;
  depthP50: number | null;
}

/** The legend position a game started from (chess_positions), when it has one. */
export interface LegendSource {
  chessPositionId: string;
  pgn: string | null;
  gameMetadata: unknown;
  moveNumber: number | null;
  /** The linked `legends` records' names (chess_positions.whitePlayerId / blackPlayerId), when a side links one. */
  whiteLegendName: string | null;
  blackLegendName: string | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  /** chess_positions.eventDate's year, else games.meta.position.year. */
  year: number | null;
}

/** One `legend_comparisons` row of the game. */
export interface StoredComparison {
  userId: string;
  status: "FACTS_READY" | "NARRATING" | "READY" | "FAILED";
  facts: unknown;
}

/** Everything one ANALYZE_GAME run reads, in one statement (§8.12 "Load"). */
export interface LoadedGame {
  id: string;
  ref: string;
  status: string;
  mode: string | null;
  startingFen: string;
  startPly: number;
  /** UCI from startingFen. */
  moves: string[];
  plyCount: number;
  completedAtMs: number | null;
  ecoCode: string | null;
  openingName: string | null;
  members: GameMember[];
  analysis: StoredAnalysis | null;
  legend: LegendSource | null;
  comparisons: StoredComparison[];
  /** The job's `lastError` before this attempt ("<code>: …"), for `analysis_retry_succeeded`. */
  jobLastError: string | null;
}

/** The arrays a checkpoint or the final write stores (index = position / ply offset). */
export interface AnalysisArrays {
  evals: number[];
  second: number[];
  best: number[];
  judgements: number[];
}

/** Columns that identify how an analysis was made. */
export interface AnalysisIdentity {
  version: number;
  engine: string;
  nodesPass1: number;
  nodesPass2: number;
  totalPlies: number;
}

/** A comparison row to insert (FACTS_READY) or to complete with its evals (READY). */
export interface ComparisonWrite {
  userId: string;
  facts: ComparisonFactsV1;
  /** True when `facts.evalAtDivergence` is filled: the row becomes READY (only from FACTS_READY / FAILED). */
  ready: boolean;
}

export interface CheckpointWrite {
  jobId: string;
  me: string;
  gameId: string;
  identity: AnalysisIdentity;
  gradedPlies: number;
  arrays: AnalysisArrays;
  /** Legend facts computed by this run that have no row yet (inserted once, ON CONFLICT DO NOTHING). */
  newComparisons: ComparisonWrite[];
  chessPositionId: string | null;
}

export interface MemberWrite {
  color: Color;
  /** Unrounded game accuracy, null below 3 positions. */
  accuracy: number | null;
  headline: string | null;
  momentsCount: number;
  /** 13 counters (this side only). */
  counts: number[];
  /** [opening, middlegame, endgame]; -1 = not reached. */
  phaseAccuracy: number[];
  content: ReviewContentV1;
}

export interface FinalWrite {
  jobId: string;
  me: string;
  gameId: string;
  identity: AnalysisIdentity;
  arrays: AnalysisArrays;
  lines: LinesV1;
  middlegamePly: number | null;
  endgamePly: number | null;
  accuracy: { w: number | null; b: number | null };
  counts: { w: number[]; b: number[] };
  depthP50: number | null;
  /** Write `readyMs` (= now − games.completedAt) for this run (live_end, bot_end, opened; not regrades). */
  measureReady: boolean;
  members: MemberWrite[];
  opening: { eco: string; name: string } | null;
  comparisons: ComparisonWrite[];
  chessPositionId: string | null;
  /** `jobs.result`. */
  result: Record<string, unknown>;
  /** Extra statements from `final-batch/` (P5), already built for this game. */
  extensions: readonly Statement[];
}

export interface SkipWrite {
  jobId: string;
  me: string;
  gameId: string;
  reason: string;
}

/** A job whose game was deleted (AnalysisStore.gone). */
export interface GoneWrite {
  jobId: string;
  me: string;
  gameId: string;
}

/** `openings` rows the worker needs for the book set and the opening name. */
export interface OpeningRow {
  eco: string;
  name: string;
  pgn: string;
}

/** Facts row of a LEGEND_COMPARE job (one member). */
export interface LegendCompareLoad {
  gameId: string;
  ref: string;
  status: string;
  startingFen: string;
  moves: string[];
  member: { color: Color; userRef: string } | null;
  comparison: StoredComparison | null;
}
