// The book set and the opening names (phase-03 plan §8.4 rule 2, §8.12 step 8, §9.4). Built once per worker process
// from the active `openings` lines (one statement, at the first job that needs it; ~3.6k rows): the book set is
// every position along the lines (CA `buildBookSet`, keyed by EPD so a transposition into theory is theory), and the
// opening name of a game is the deepest of its positions that ends an opening line (CA `deepestOpening`). The
// in-memory map is the same lookup as `openings.epd` (the backfill asserted the replayed final EPD equals it), so the
// worker spends no statement per game on it.
import { buildBookSet, deepestOpening, replayOpening, type BookSet } from "@repo/chess-analysis/book";
import type { Logger } from "../obs/log";
import type { OpeningRow } from "./types";

/** `games.openingName` is varchar(80); `ecoCode` varchar(3). */
const NAME_MAX = 80;

export interface OpeningIndex {
  book: BookSet;
  /** The opening whose line ends at an EPD (the first active line by id wins a tie). */
  byFinalEpd: Map<string, { eco: string; name: string }>;
  lines: number;
}

export function buildOpeningIndex(rows: readonly OpeningRow[]): OpeningIndex {
  const built = buildBookSet(rows.map((r) => r.pgn));
  const byFinalEpd = new Map<string, { eco: string; name: string }>();
  for (const row of rows) {
    const line = replayOpening(row.pgn);
    const last = line.epds[line.epds.length - 1];
    if (line.failedAt !== null || !last || byFinalEpd.has(last)) continue;
    if (!/^[A-E]\d\d$/.test(row.eco)) continue;
    byFinalEpd.set(last, { eco: row.eco, name: row.name.slice(0, NAME_MAX) });
  }
  return { book: built.book, byFinalEpd, lines: built.lines };
}

/** The game's opening (deepest EPD match), or null. */
export function openingOf(index: OpeningIndex, epds: readonly string[]): { eco: string; name: string } | null {
  return deepestOpening(epds, index.byFinalEpd);
}

/** Loads the index once; concurrent first callers share the load, a failed load is retried by the next caller. */
export class OpeningBook {
  private loading: Promise<OpeningIndex> | null = null;

  constructor(
    private readonly load: () => Promise<OpeningRow[]>,
    private readonly log: Logger,
  ) {}

  get(): Promise<OpeningIndex> {
    if (!this.loading) {
      this.loading = this.load().then(
        (rows) => {
          const index = buildOpeningIndex(rows);
          this.log.info("opening book loaded", {
            lines: index.lines,
            epds: index.book.size,
            names: index.byFinalEpd.size,
          });
          return index;
        },
        (error: unknown) => {
          this.loading = null;
          throw error;
        },
      );
    }
    return this.loading;
  }
}
