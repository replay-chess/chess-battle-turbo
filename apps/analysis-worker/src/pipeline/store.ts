// The pipeline's persistence seam (phase-03 plan §8.12 "Load", "Checkpoint", "Final write"). `SqlAnalysisStore`
// (sql-store.ts) is the real one: every method is ONE round trip (a single statement or one `sql.transaction([...])`
// batch), every write batch starts with the lock guard so nothing commits once the job was reaped, and every
// statement is idempotent (upserts, guarded updates), so the client's single retry is safe. `MemoryAnalysisStore`
// (testing/memory-store.ts) implements the same contract in memory for the unit tests.
import type { Row } from "../db/client";
import type { CheckpointWrite, FinalWrite, GoneWrite, LegendCompareLoad, LoadedGame, OpeningRow, SkipWrite } from "./types";

export interface AnalysisStore {
  /**
   * Reads the game, its members, the stored analysis, the legend source and comparisons, and the job's last error,
   * and moves `games."analysisStatus"` to RUNNING (from QUEUED, FAILED or NONE). Null when the game is gone.
   */
  load(gameId: string, jobId: string): Promise<LoadedGame | null>;
  /** The checkpoint (§8.12 step 5): partial arrays + heartbeat. Returns the job's current priority. */
  checkpoint(write: CheckpointWrite): Promise<number>;
  /**
   * The final batch (§8.12 step 9), DONE flag last. Returns the rows of `write.extensions` (in order), or null when
   * the batch had committed in an earlier attempt whose response was lost (the rows are unknown).
   */
  finish(write: FinalWrite): Promise<Row[][] | null>;
  /** A game that cannot be analysed (§8.12 step 1): SKIPPED, DONE. */
  skip(write: SkipWrite): Promise<void>;
  /**
   * The game was deleted before or during the analysis (an import purge, a deleted account's cascade): when no game
   * row exists, the job ends DONE `{skipped: "game_gone"}` (lock-guarded, the final batch's retry form) and true is
   * returned; while the game exists nothing is written and the answer is false (the caller's error stands).
   */
  gone(write: GoneWrite): Promise<boolean>;
  /** Active opening lines (book set + opening names); read once per worker process. */
  openings(): Promise<OpeningRow[]>;
  /** For `analysis:batch.queued`: QUEUED analyses per member ref, for the given refs. */
  queuedFor(userRefs: readonly string[]): Promise<Map<string, number>>;
}

export interface LegendCompareStore {
  loadComparison(gameId: string, userId: string): Promise<LegendCompareLoad | null>;
  /** Fills `evalAtDivergence` (or confirms a facts row without a divergence) and marks the row READY + job DONE. */
  completeComparison(input: {
    jobId: string;
    me: string;
    gameId: string;
    userId: string;
    evalAtDivergence: { userWin: number; legendWin: number } | null;
  }): Promise<void>;
  /** After the last attempt failed: the row becomes FAILED with a short reason. */
  failComparison(input: { gameId: string; userId: string; error: string }): Promise<void>;
}
