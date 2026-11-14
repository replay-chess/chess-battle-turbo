// Puzzle rating on top of `@repo/game-core/rating` (phase-05 plan §8.7, owner decision D-3): the one-time seed, the
// "provisional" rule and one puzzle attempt as a Glicko-2 rating period against the puzzle (fixed rating, RD 50).
// Browser-safe: the runner shows the same deterministic preview ("Rating 1524 +12", D-13) and the server's
// `AttemptOut.rating` replaces it on flush. The score is always the objective one (`grade.ts objectiveScore`).
import { glicko2, PUZZLE, type GlickoState } from "@repo/game-core/rating";
import {
  PROVISIONAL_ATTEMPTS,
  PUZZLE_OPPONENT_RD,
  PUZZLE_SEED_DEFAULT,
  PUZZLE_SEED_MAX,
  PUZZLE_SEED_MIN,
  PUZZLE_SEED_OFFSET,
  PUZZLE_SEED_RD,
  PUZZLE_SEED_VOL,
} from "./constants";

/** P4 onboarding bands (`RatingBand`) and the rating each stands for when nothing better is known. */
export const RATING_BAND_MIDPOINTS = {
  NEW_TO_CHESS: 600,
  UNDER_800: 700,
  R800_1200: 1000,
  R1200_1600: 1400,
  R1600_2000: 1800,
  R2000_PLUS: 2100,
} as const;
export type RatingBandKey = keyof typeof RATING_BAND_MIDPOINTS;

export interface SeedInputs {
  /** Linked-account blitz (Chess.com, else Lichess; P4 `LinkedAccount.ratings`). */
  blitz?: number | null;
  rapid?: number | null;
  /** P4 `initialRating`. */
  initialRating?: number | null;
  /** P4 `ratingBand` (used when there is no `initialRating`). */
  ratingBand?: RatingBandKey | null;
}

/**
 * The seed (applied once, `ratingSeeded`): `clamp((blitz ?? rapid ?? onboardingRating ?? 1200) + 300, 800, 2200)`,
 * RD 250, σ 0.06. A blitz 1184 player starts at 1484.
 */
export function seedPuzzleRating(i: SeedInputs): GlickoState {
  const onboarding = i.initialRating ?? (i.ratingBand ? RATING_BAND_MIDPOINTS[i.ratingBand] : null);
  const base = i.blitz ?? i.rapid ?? onboarding ?? PUZZLE_SEED_DEFAULT;
  const r = Math.min(PUZZLE_SEED_MAX, Math.max(PUZZLE_SEED_MIN, Math.round(base) + PUZZLE_SEED_OFFSET));
  return { r, rd: PUZZLE_SEED_RD, vol: PUZZLE_SEED_VOL };
}

/** "Provisional" while fewer than 20 puzzles were rated. */
export function isProvisional(puzzleAttempts: number): boolean {
  return puzzleAttempts < PROVISIONAL_ATTEMPTS;
}

/** One puzzle attempt: the member against the puzzle (rating `puzzleRating`, RD 50) with the objective score. */
export function ratePuzzle(state: GlickoState, puzzleRating: number, score: 0 | 0.5 | 1): GlickoState & { delta: number } {
  const next = glicko2(state, [{ r: puzzleRating, rd: PUZZLE_OPPONENT_RD, s: score }], PUZZLE);
  return { ...next, delta: Math.round(next.r) - Math.round(state.r) };
}
