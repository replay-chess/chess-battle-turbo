// GET /api/me/games (phase-03 plan §7.2 G1, §5.10, §9.3): the viewer's finished games, newest first, in keyset pages
// over `game_players."endedAt"`. Member (or, with `review-lapsed-read`, a lapsed member). Page 1 and `limit=0` carry
// `meta.filteredTotal` and `meta.counts`; later pages only `meta.nextCursor`. A bad cursor is a 400 on `cursor`.
// `private-etag` with `ETag: "g<gamesVersion>-<hash>"`: the probe needs only the viewer, so a revalidation that still
// matches is a 304 with no statement beyond the viewer read (P3-D27).
import type { GamesQuery } from "@repo/contracts/http/games";
import { archiveEndpoints } from "@repo/contracts/http/registry";
import { paged } from "@/lib/api/paged";
import { respondWith } from "@/lib/api/respond";
import { route, type Ctx } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { archiveEtag, archiveRequestOf, listMyGames } from "@/lib/services/analysis/archive";
import { requireReviewReader } from "@/lib/services/analysis/reader";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    ...archiveEndpoints.list,
    etagProbe: async (ctx: Ctx<unknown, GamesQuery>) => {
      const viewer = await requireReviewReader(ctx);
      return archiveEtag(viewer.gamesVersion, archiveRequestOf(ctx.query), ctx.now.getTime());
    },
  },
  async (ctx) => {
    const viewer = await requireReviewReader(ctx);
    const req = archiveRequestOf(ctx.query);
    const nowMs = ctx.now.getTime();
    const page = await listMyGames(rawDb(prisma), viewer, req, nowMs);
    const extra =
      page.meta.filteredTotal !== undefined ? { filteredTotal: page.meta.filteredTotal, counts: page.meta.counts } : undefined;
    return respondWith(paged(page.rows, page.meta.nextCursor, undefined, extra), {
      etag: archiveEtag(viewer.gamesVersion, req, nowMs),
    });
  },
);
