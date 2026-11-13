// The final-batch extension contract (phase-03 plan §8.12 step 9, AP-27). A later phase adds statements to the ONE
// transaction that finishes an analysis by adding a file to this directory and one line to `index.ts`. P5 adds its
// set-based mistake / occurrence / card statements here.
//
// Rules for an extension:
// - set-based statements keyed by natural keys (`(gameId, ply)`, `(userId, epd)`), so no statement needs another's
//   RETURNING and every statement is idempotent (the batch may be retried once);
// - only the tables and columns its phase grants to `replay_worker`;
// - it runs after the analysis rows and before the job's DONE flag, behind the same lock guard, so its rows commit
//   together with the analysis or not at all;
// - no I/O while building: `statements()` is pure and synchronous.
import type { Color } from "@repo/chess-analysis/codec";
import type { AnalysisResult } from "@repo/chess-analysis/analysis";
import type { Row, Statement } from "../../db/client";
import type { Metrics } from "../../obs/metrics";
import type { ProductEvents } from "../../obs/posthog";
import type { Telemetry } from "../../obs/telemetry";
import type { GameMember } from "../types";

export interface FinalBatchContext {
  gameId: string;
  gameRef: string;
  startPly: number;
  /** UCI from the start position. */
  moves: readonly string[];
  members: readonly GameMember[];
  /** The grading this batch writes (judgements, counts, accuracy, lines, the member reviews). */
  result: AnalysisResult;
  /** The member sides that have a review in this batch. */
  memberSides: readonly Color[];
  /** True for an engine-free regrade (§8.14). */
  regrade: boolean;
  /** P4: the import run that queued this analysis (AnalyzeGamePayloadV1.importRunId), if any. */
  importRunId?: string | null;
  /** P4: where the stored evals came from (Lichess evalHint, §8.7); absent = ENGINE, unchanged. */
  evalSource?: "ENGINE" | "LICHESS" | "MIXED";
}

/** Where an extension reports what its committed statements returned (telemetry only; never another write). */
export interface FinalBatchSink {
  metrics: Metrics;
  telemetry: Telemetry;
  events: ProductEvents;
}

export interface FinalBatchExtension {
  /** "p5-mistakes", … */
  id: string;
  statements(ctx: FinalBatchContext): Statement[];
  /**
   * Optional, after the batch committed: the rows this extension's statements returned, in `statements()` order
   * (P4: the import run's first review, `import.review_ready_ms` + `review_ready_after_import`, FIX-1). Not called
   * when the batch had committed in an earlier attempt whose response was lost (its rows are unknown), so a
   * telemetry value is never counted twice.
   */
  committed?(ctx: FinalBatchContext, rows: readonly Row[][], sink: FinalBatchSink): void;
}
