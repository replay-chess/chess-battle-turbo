// Review URLs for the client chunk: the review page itself comes from the zod-free contract module (AP-12), the
// nested pages are the review's own.
import { reviewPath } from "@repo/contracts/http/plain";

export { reviewPath };

/** The game-over CTA's review link: `?from=game_over` names `review_opened.source` (plan §10.1). */
export function gameOverReviewPath(ref: string): string {
  return reviewPath(ref, { from: "game_over" });
}

/** `/review/<ref>/complete` (F5). */
export function reviewCompletePath(ref: string): string {
  return `/review/${encodeURIComponent(ref)}/complete`;
}

/** `/review/<ref>/share` (F6, flag review-share). */
export function reviewSharePath(ref: string): string {
  return `/review/${encodeURIComponent(ref)}/share`;
}

/** The game this review is of (P2's screen). */
export function gamePath(ref: string): string {
  return `/game/${encodeURIComponent(ref)}`;
}
