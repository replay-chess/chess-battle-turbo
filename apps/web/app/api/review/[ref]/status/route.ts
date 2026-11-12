// GET /api/review/[ref]/status (phase-03 plan §7.2 A2, §5.2 fallback poller, §5.8 game-over card): the analysis
// status, the review summary and the legend summary. `private-etag` with the probe (304 = one statement).
// Declared GET writes: the kick CAS (`after()`) and the lazy legend facts insert for a legend game without one.
import type { ReviewRefParams } from "@repo/contracts/http/review";
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route, type Ctx } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { scheduleHealKick } from "@/lib/services/analysis/heal-kick";
import { getReviewStatus, probeReview } from "@/lib/services/analysis/read";
import { requireReviewReader } from "@/lib/services/analysis/reader";
import { statusEtag } from "@/lib/services/analysis/review-dto";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    ...reviewEndpoints.status,
    etagProbe: async (ctx: Ctx<ReviewRefParams>) => {
      const viewer = await requireReviewReader(ctx);
      const db = rawDb(prisma);
      const probe = await probeReview(db, viewer, ctx.params.ref);
      // A legend game without its facts row answers through the handler (it inserts them).
      if (!probe || (probe.chessPositionId != null && probe.comparisonStatus === null)) return null;
      scheduleHealKick(ctx, db, probe);
      return statusEtag(probe, ctx.now.getTime());
    },
  },
  async (ctx) => {
    const viewer = await requireReviewReader(ctx);
    const db = rawDb(prisma);
    const read = await getReviewStatus(db, viewer, ctx.params.ref, ctx.now.getTime());
    scheduleHealKick(ctx, db, read.row);
    return respondWith(read.dto, { etag: read.etag });
  },
);
