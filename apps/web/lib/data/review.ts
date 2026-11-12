// The review DAL for server components (phase-03 plan §5.2, §5.3, §7.3): React cache() per request around the same
// one-statement reads the API routes use (lib/services/analysis/read.ts), so the RSC first paint and A1 / A2 agree
// byte for byte. Server-only. Pages call these after `requireMemberPage()` (the layout gate) and turn a DataError
// `not_found` into notFound() (`isNotFound` from ./errors). No function here writes, except getReviewStatus's
// declared lazy legend-facts insert; nothing here enqueues (P3-D23).
import "server-only";
import { cache } from "react";
import type { ReviewCompleteView, ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import type { Viewer } from "@/lib/auth/viewer";
import { requestNow } from "@/lib/api/now";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import {
  getReview as readReview,
  getReviewComplete as readReviewComplete,
  getReviewStatus as readReviewStatus,
} from "@/lib/services/analysis/read";

export { DataError, isNotFound } from "./errors";

/** ReviewDTO for `qk.review.detail(ref)`; throws DataError not_found for an unknown game or a non-player. */
export const getReview = cache(async (viewer: Viewer, ref: string): Promise<ReviewDTO> => {
  const { dto } = await readReview(rawDb(prisma), viewer, ref, (await requestNow()).getTime());
  return dto;
});

/** ReviewStatusDTO for `qk.review.status(ref)` (the game-over card's server seed). */
export const getReviewStatus = cache(async (viewer: Viewer, ref: string): Promise<ReviewStatusDTO> => {
  const { dto } = await readReviewStatus(rawDb(prisma), viewer, ref, (await requestNow()).getTime());
  return dto;
});

/**
 * The `/review/[ref]/complete` view (RSC only, no client query). Throws DataError not_found (non-player) or
 * `conflict {reason: analysis_not_done}` (the page redirects to the review). `shareEnabled` = the `review-share` flag.
 */
export const getReviewComplete = cache(
  async (viewer: Viewer, ref: string, shareEnabled: boolean): Promise<ReviewCompleteView> =>
    readReviewComplete(rawDb(prisma), viewer, ref, (await requestNow()).getTime(), { shareEnabled }),
);
