// Domain `catalog`: public catalogue reads (openings, positions).
import { norm } from "./norm";

export const catalogKeys = {
  catalog: {
    all: () => ["catalog"] as const,
    /** P1, temporary: GET /api/openings (every opening). P8 CAT-3 replaces it with `openings(…)` and deletes it. */
    openingsIndex: () => ["catalog", "openings", "index"] as const,
    openings: (q: string, family?: string) => ["catalog", "openings", norm({ q, family })] as const,
    positions: (q: string) => ["catalog", "positions", q] as const,
  },
};
