// Provider ratings → the `linked_accounts.ratings` buckets (`RatingsV1`, phase-04 plan §6.4): `{ bullet?, blitz?,
// rapid?, daily?, classical? }`, each `{ rating, best, games }`. Lichess `ultraBullet` folds into `bullet` and
// `correspondence` into `daily`; a folded bucket sums the games and takes the rating of the pool with more games
// (bullet / correspondence on a tie) and the higher best. Chess.com chess960 and the puzzle ratings are left out.
// WP-A's `RatingsV1` schema adds `v: 1` when the link stores it.
import type { ChessComClassStats, ChessComStats } from "./chesscom/types";
import type { RatingBucket } from "./time-class";

export interface RatingEntry {
  rating: number;
  /** Highest rating the provider reports; null when it reports none (Lichess perfs carry no best). */
  best: number | null;
  /** Rated games in the pool, all time. */
  games: number;
}

export type Ratings = Partial<Record<RatingBucket, RatingEntry>>;

const fromChessCom = (s: ChessComClassStats | undefined): RatingEntry | undefined =>
  s
    ? {
        rating: s.last.rating,
        best: s.best?.rating ?? null,
        games: s.record.win + s.record.loss + s.record.draw,
      }
    : undefined;

export function chessComRatings(stats: ChessComStats): Ratings {
  const out: Ratings = {};
  const pairs: [RatingBucket, ChessComClassStats | undefined][] = [
    ["bullet", stats.chess_bullet],
    ["blitz", stats.chess_blitz],
    ["rapid", stats.chess_rapid],
    ["daily", stats.chess_daily],
  ];
  for (const [bucket, s] of pairs) {
    const e = fromChessCom(s);
    if (e) out[bucket] = e;
  }
  return out;
}

/** The perf entries `GET /api/user/{u}` / `GET /api/account` send (`perfs.<name>`); unknown shapes are ignored. */
type LichessPerfLike = { games?: unknown; rating?: unknown };

function perfEntry(p: unknown): RatingEntry | undefined {
  if (!p || typeof p !== "object") return undefined;
  const { games, rating } = p as LichessPerfLike;
  if (typeof games !== "number" || typeof rating !== "number" || games <= 0) return undefined;
  return { rating: Math.round(rating), best: null, games };
}

function fold(primary: RatingEntry | undefined, secondary: RatingEntry | undefined): RatingEntry | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const lead = secondary.games > primary.games ? secondary : primary;
  const bests = [primary.best, secondary.best].filter((b): b is number => b !== null);
  return {
    rating: lead.rating,
    best: bests.length ? Math.max(...bests) : null,
    games: primary.games + secondary.games,
  };
}

export function lichessRatings(perfs: Readonly<Record<string, unknown>> | undefined): Ratings {
  const out: Ratings = {};
  if (!perfs) return out;
  const set = (bucket: RatingBucket, e: RatingEntry | undefined) => {
    if (e) out[bucket] = e;
  };
  set("bullet", fold(perfEntry(perfs.bullet), perfEntry(perfs.ultraBullet)));
  set("blitz", perfEntry(perfs.blitz));
  set("rapid", perfEntry(perfs.rapid));
  set("classical", perfEntry(perfs.classical));
  set("daily", perfEntry(perfs.correspondence));
  return out;
}
