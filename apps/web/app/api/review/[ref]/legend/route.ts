// GET /api/review/[ref]/legend[?include=explanation] (phase-03 plan §7.2 A9, §5.7): compare with the legend. The only
// GET write is the derived facts insert (`legend_facts`); it never enqueues engine work, so a hover prefetch is safe.
// 404 for a game without a comparable legend position. `private-etag` (updatedAt + the include flag).
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { buildLegendCompareDTO, getLegendCompare, legendCompareEtag } from "@/lib/services/analysis/legend";
import { requireReviewReader } from "@/lib/services/analysis/reader";

export const dynamic = "force-dynamic";

export const GET = route(reviewEndpoints.legend, async (ctx) => {
  const viewer = await requireReviewReader(ctx);
  const include = ctx.query.include === "explanation";
  const read = await getLegendCompare(rawDb(prisma), viewer, ctx.params.ref, { includeExplanation: include });
  const nowMs = ctx.now.getTime();
  return respondWith(buildLegendCompareDTO(read, { include, nowMs }), { etag: legendCompareEtag(read, include, nowMs) });
});
