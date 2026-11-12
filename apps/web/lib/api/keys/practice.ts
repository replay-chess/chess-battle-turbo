// Domain `practice`: Practice from a position (phase-03 plan §5.9). The `/practice` RSC reads the DAL directly and
// seeds nothing; this key is for client callers of PR1 outside it (P5's "study this position").
import { norm } from "./norm";

/** One source of a practice session, as PR1's query (`?game=&ply=` · `?position=` · `?fen=`). */
export type PracticeKey = { game?: string; ply?: number; position?: string; fen?: string };

export const practiceKeys = {
  practice: {
    all: () => ["practice"] as const,
    /** PracticeContextDTO (PR1). Immutable for a game ply or a position; staleTime Infinity. */
    context: (q: PracticeKey) => ["practice", "context", norm(q)] as const,
  },
};
