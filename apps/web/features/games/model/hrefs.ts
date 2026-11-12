// Links out of /games. /games exists only with `review-v3` on, so its links always point at the P3 screens. The
// builders are the zod-free contract module's (AP-12), so the /games chunk carries no zod.
import { legendComparePath, reviewPath } from "@repo/contracts/http/plain";

/** `?from=archive` names the source of `review_opened` (a soft navigation keeps the old referrer). */
export function reviewHrefOf(ref: string): string {
  return reviewPath(ref, { from: "archive" });
}

export function compareHrefOf(ref: string): string {
  return legendComparePath(ref);
}

/** The empty state's primary (plan §4.9: **Play a Game** → /play). */
export const PLAY_HREF = "/play";
