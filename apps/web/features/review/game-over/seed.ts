// Seeding `qk.review.status(ref)` from what the finish answered (phase-03 plan §5.8): `game:result.review` on live
// games (useAnalysisProgress listens), the bot `complete` response on bot games (applyCompleted in
// lib/api/mutations/games.ts imports this module lazily). A seed never overwrites a state the cache already has.
// Small on purpose (no hooks, no realtime): the complete path loads it on its own.
import type { QueryClient } from "@tanstack/react-query";
import type { CompleteResponse } from "@repo/contracts/http/games";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import { qk } from "@/lib/api/keys";
import { statusFromSeed, type ReviewSeed } from "./model";

/** Writes a seed into the status cache (no-op when the cache already knows better). */
export function seedReviewStatus(qc: QueryClient, ref: string, seed: ReviewSeed, totalPlies: number): void {
  const key = qk.review.status(ref);
  const next = statusFromSeed(qc.getQueryData<ReviewStatusDTO>(key), seed, totalPlies);
  if (next) qc.setQueryData(key, next);
}

/** The bot `complete` answer as a seed; `totalPlies` = the moves the client sent (the game's length). */
export function seedReviewStatusFromComplete(
  qc: QueryClient,
  ref: string,
  result: Pick<CompleteResponse, "analysis" | "comparison">,
  totalPlies: number,
): void {
  seedReviewStatus(qc, ref, { status: result.analysis.status, etaSec: result.analysis.etaSec, comparison: result.comparison }, totalPlies);
}
