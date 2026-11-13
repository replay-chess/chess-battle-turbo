// Rating band suggestion from a linked account's ratings (phase-04 plan §8.2). Pure and client-safe: the Level
// step's server page suggests, the band picker computes the "Puzzles start near …" note.
//
// Ratings are structural (`RatingsV1` from @repo/db/json fits): `{ bullet?, blitz?, rapid?, daily?, classical? }`,
// each `{ rating, games }`. Lichess ultraBullet and correspondence are already folded into bullet and daily by the
// importer (`foldRatingEntries`).
import type { RatingBandDb } from "@repo/contracts/http/p04-plain";

export const TIME_CLASSES = ["rapid", "blitz", "bullet", "daily", "classical"] as const;
export type SuggestTimeClass = (typeof TIME_CLASSES)[number];

/** Tie-break order: when two classes have the same number of games, the first one here wins (rapid). */
const PREFERENCE: readonly SuggestTimeClass[] = TIME_CLASSES;

/** A class needs this many games to count; with none that qualifies, any class with games does. */
export const MIN_GAMES = 10;

/** Lichess ratings run higher than Chess.com's for the same strength. Unsourced constant (research §19 gap 10). */
export const LICHESS_OFFSET: Readonly<Record<SuggestTimeClass, number>> = {
  bullet: -50,
  blitz: -100,
  rapid: -100,
  classical: -100,
  daily: 0,
};

/** The rating a band stands for when the member picks it themselves (`ratingBandSource = "self"`). */
export const BAND_MIDPOINT: Readonly<Record<RatingBandDb, number>> = {
  NEW_TO_CHESS: 400,
  UNDER_800: 700,
  R800_1200: 1000,
  R1200_1600: 1400,
  R1600_2000: 1800,
  R2000_PLUS: 2100,
};

export const INITIAL_RATING_MIN = 400;
export const INITIAL_RATING_MAX = 2400;

export type RatingEntryLike = { rating: number; games: number };
export type RatingsLike = Partial<Record<SuggestTimeClass, RatingEntryLike | null | undefined>>;

export type SuggestProvider = "chesscom" | "lichess";

export type BandSuggestion = {
  band: Exclude<RatingBandDb, "NEW_TO_CHESS">;
  /** `chesscom:rapid`, `lichess:blitz` … (RATING_BAND_SOURCE_RE). */
  source: `${SuggestProvider}:${SuggestTimeClass}`;
  /** The offset rating clamped to 400…2400 (`users."initialRating"`). */
  initialRating: number;
  timeClass: SuggestTimeClass;
  /** The provider's own number, as the banner shows it ("Rapid 1184"). */
  displayRating: number;
};

function gamesOf(ratings: RatingsLike, tc: SuggestTimeClass): number {
  const entry = ratings[tc];
  return entry && Number.isFinite(entry.games) && Number.isFinite(entry.rating) ? entry.games : 0;
}

/** Band of a (provider-adjusted) rating. Never NEW_TO_CHESS: that one is only ever picked by hand. */
export function bandOfRating(r: number): BandSuggestion["band"] {
  if (r < 800) return "UNDER_800";
  if (r < 1200) return "R800_1200";
  if (r < 1600) return "R1200_1600";
  if (r < 2000) return "R1600_2000";
  return "R2000_PLUS";
}

/** Chess.com has no classical pool (RATING_BAND_SOURCE_RE); its ratings never carry one. */
function classesFor(provider: SuggestProvider): readonly SuggestTimeClass[] {
  return provider === "chesscom" ? PREFERENCE.filter((tc) => tc !== "classical") : PREFERENCE;
}

/**
 * The band to preselect on Level: the time class with the most games (≥ 10 if any class has that many; rapid wins
 * ties), its rating with the Lichess offset applied. Null when the account has no rated games at all.
 */
export function suggestBand(ratings: RatingsLike | null | undefined, provider: SuggestProvider): BandSuggestion | null {
  if (!ratings) return null;
  const classes = classesFor(provider);
  const usable = classes.filter((tc) => gamesOf(ratings, tc) >= MIN_GAMES);
  const pool = usable.length ? usable : classes.filter((tc) => gamesOf(ratings, tc) > 0);
  if (!pool.length) return null;
  // reduce keeps the earlier class on a tie, so PREFERENCE order breaks ties.
  const tc = pool.reduce((a, b) => (gamesOf(ratings, b) > gamesOf(ratings, a) ? b : a));
  const displayRating = ratings[tc]!.rating;
  const r = displayRating + (provider === "lichess" ? LICHESS_OFFSET[tc] : 0);
  return {
    band: bandOfRating(r),
    source: `${provider}:${tc}`,
    initialRating: Math.min(INITIAL_RATING_MAX, Math.max(INITIAL_RATING_MIN, Math.round(r))),
    timeClass: tc,
    displayRating,
  };
}

/** The first puzzle rating shown in the band note: 1184 → 1150 (V3OnbRating). */
export const puzzleStart = (initialRating: number): number => Math.floor(initialRating / 50) * 50;

/** "Rapid", "Blitz" … for the banner. */
export function timeClassLabel(tc: SuggestTimeClass): string {
  return tc.charAt(0).toUpperCase() + tc.slice(1);
}

/** "From Chess.com" / "From Lichess". */
export function providerLabel(provider: SuggestProvider): string {
  return provider === "chesscom" ? "Chess.com" : "Lichess";
}

/**
 * What the Level step saves for a band: the suggestion's source and rating when the member kept it, else
 * `self` and the band's midpoint (§8.2).
 */
export function levelChoice(
  band: RatingBandDb,
  suggestion: BandSuggestion | null,
): { ratingBand: RatingBandDb; ratingBandSource: string; initialRating: number } {
  if (suggestion && suggestion.band === band) {
    return { ratingBand: band, ratingBandSource: suggestion.source, initialRating: suggestion.initialRating };
  }
  return { ratingBand: band, ratingBandSource: "self", initialRating: BAND_MIDPOINT[band] };
}

/** Parses a stored `ratingBandSource` (`chesscom:rapid`) into its parts; null for `self` or anything else. */
export function parseBandSource(source: string | null | undefined): { provider: SuggestProvider; timeClass: SuggestTimeClass } | null {
  if (!source) return null;
  const m = /^(chesscom|lichess):(bullet|blitz|rapid|daily|classical)$/.exec(source);
  if (!m) return null;
  return { provider: m[1] as SuggestProvider, timeClass: m[2] as SuggestTimeClass };
}
