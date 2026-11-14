// The puzzle-rating preview (phase-05 plan §8.7, D-13): the runner runs the same Glicko-2 update as the server
// (`@repo/game-core/rating`, preset `PUZZLE`) from the session header's `{value, rd, vol}` and the puzzle's rating, with
// the objective score of §8.3 (never the chosen grade), so "Rating 1524 +12" shows the moment a puzzle is solved. The
// server's `AttemptOut.rating` replaces it silently when the outbox flushes. Bank items never move the rating.
import type { PuzzleRatingState } from "@repo/contracts/http/train";
import { glicko2, PUZZLE } from "@repo/game-core/rating";

/** The opponent of one rating period is the puzzle, with a fixed RD (§8.7). */
export const PUZZLE_RD = 50;

export function previewRating(state: PuzzleRatingState, puzzleRating: number, score: 0 | 0.5 | 1): { next: PuzzleRatingState; delta: number } {
  const out = glicko2({ r: state.value, rd: state.rd, vol: state.vol }, [{ r: puzzleRating, rd: PUZZLE_RD, s: score }], PUZZLE);
  const delta = Math.round(out.r) - Math.round(state.value);
  return { next: { value: out.r, rd: out.rd, vol: out.vol, provisional: state.provisional }, delta };
}
