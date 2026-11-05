// Domain `games`: the viewer's games, game status and challenges. P2/P3 fill it.
import { norm, type Filters } from "./norm";

/** Narrowed by P3 (`{ q?, result?, tc?, moments? }`). */
export type GamesFilter = Filters;

export const gameKeys = {
  games: {
    all: () => ["games"] as const,
    list: (f: GamesFilter) => ["games", "list", norm(f)] as const,
    counts: () => ["games", "counts"] as const,
    status: (ref: string) => ["games", ref, "status"] as const,
    challenge: (code: string) => ["games", "challenge", code] as const,
  },
};
