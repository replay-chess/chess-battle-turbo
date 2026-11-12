// The archive DAL for server components (phase-03 plan §5.10, §7.3 listMyGames). Server-only. The `/games` page runs
// its gate (layout + page), parses its searchParams with the same rules as G1 (`gamesFilterOf`) and prefetches page 1
// into `qk.games.list(keyFilter(filter))` with this function, so the first paint and a client refetch agree.
import "server-only";
import { cache } from "react";
import { GAMES_PAGE_LIMIT, type GamesFilter } from "@repo/contracts/http/games";
import type { Viewer } from "@/lib/auth/viewer";
import { requestNow } from "@/lib/api/now";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { decodeArchiveCursor, listMyGames as readMyGames, type ArchivePage } from "@/lib/services/analysis/archive";

export { parseGamesFilter } from "@/lib/services/analysis/archive";
export type { ArchivePage };

/** Page 1 (or the page after `cursor`) of the viewer's games: GameRowDTO[] + the G1 meta. */
export const listMyGames = cache(
  async (viewer: Viewer, filter: GamesFilter, cursor: string | null = null): Promise<ArchivePage> => {
    const nowMs = (await requestNow()).getTime();
    return readMyGames(rawDb(prisma), viewer, { filter, cursor: decodeArchiveCursor(cursor), limit: GAMES_PAGE_LIMIT }, nowMs);
  },
);
