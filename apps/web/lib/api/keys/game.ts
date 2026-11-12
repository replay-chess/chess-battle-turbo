// Domain `games`: the viewer's games, game status and challenges. P2/P3 fill it.
import { norm } from "./norm";

/**
 * The archive filter as a key (phase-03 plan §5.1, §5.10): scalars only, lists as canonical csv
 * (`features/games/model/filter.ts` `keyFilter()` builds it from `GamesFilter` of `@repo/contracts/http/games`), so two
 * equal filters give equal keys. `src` is reserved for P4.
 */
export type GamesFilter = { q?: string; result?: string; tc?: string; moments?: boolean };

export const gameKeys = {
  games: {
    all: () => ["games"] as const,
    /** G1 pages (infinite; page 1 carries meta.filteredTotal and counts). */
    list: (f: GamesFilter) => ["games", "list", norm(f)] as const,
    /** G1 `limit=0` counts: the prefix; the popover appends `norm(keyFilter(draft))` per draft filter. */
    counts: () => ["games", "counts"] as const,
    status: (ref: string) => ["games", ref, "status"] as const,
    /** GET /api/games/[ref] (P2): staleTime 0 while IN_PROGRESS, Infinity once finished. */
    detail: (ref: string) => ["games", ref, "detail"] as const,
    /** Socket `live:list` (P2, LiveGamesSheet): 15 s stale. */
    live: () => ["games", "live"] as const,
    challenge: (code: string) => ["games", "challenge", code] as const,
  },
};
