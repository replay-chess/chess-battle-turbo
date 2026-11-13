// JSON column registry entry for linked_accounts.ratings (phase-04 plan 6.4; D4-08).
//
// One entry per rating pool the provider reports. Lichess `ultraBullet` folds into `bullet` and `correspondence` into
// `daily` (the pools P4's band suggestion and P9's Glicko seeds read); when both exist, the pool with more games wins.
// The wire view (`RatingsView` in @repo/contracts/http/accounts) is this object without `v`.
import { z } from "zod";

export const RATING_POOLS = ["bullet", "blitz", "rapid", "daily", "classical"] as const;
export type RatingPool = (typeof RATING_POOLS)[number];

export const RatingEntryV1 = z.object({
  rating: z.number().int().min(0).max(4000),
  /** Peak rating when the provider reports it (Chess.com `best.rating`); Lichess has none. */
  best: z.number().int().min(0).max(4000).nullable(),
  games: z.number().int().min(0),
});
export type RatingEntryV1 = z.infer<typeof RatingEntryV1>;

export const RatingsV1 = z.object({
  v: z.literal(1),
  bullet: RatingEntryV1.optional(),
  blitz: RatingEntryV1.optional(),
  rapid: RatingEntryV1.optional(),
  daily: RatingEntryV1.optional(),
  classical: RatingEntryV1.optional(),
});
export type RatingsV1 = z.infer<typeof RatingsV1>;

/** Validates before a write; throws on a bad value (a programming error, never user input). */
export function buildRatings(value: unknown): RatingsV1 {
  return RatingsV1.parse(value);
}

/** Reads a stored value; a missing, newer or malformed value reads as "no ratings" (the UI shows none). */
export function parseRatings(value: unknown): RatingsV1 {
  const parsed = RatingsV1.safeParse(value);
  return parsed.success ? parsed.data : { v: 1 };
}

/**
 * Folds two entries for one pool (Lichess ultraBullet + bullet, correspondence + daily): the entry with more games
 * keeps its rating; games add up; `best` is the higher non-null peak.
 */
export function foldRatingEntries(a: RatingEntryV1 | undefined, b: RatingEntryV1 | undefined): RatingEntryV1 | undefined {
  if (!a) return b;
  if (!b) return a;
  const main = b.games > a.games ? b : a;
  const best = a.best === null ? b.best : b.best === null ? a.best : Math.max(a.best, b.best);
  return { rating: main.rating, best, games: a.games + b.games };
}

/** The wire view (`RatingsView`): the same pools without `v`. */
export function ratingsView(ratings: RatingsV1): Partial<Record<RatingPool, RatingEntryV1>> {
  const out: Partial<Record<RatingPool, RatingEntryV1>> = {};
  for (const pool of RATING_POOLS) {
    const entry = ratings[pool];
    if (entry) out[pool] = entry;
  }
  return out;
}
