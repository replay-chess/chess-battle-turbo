// GET /api/review/[ref] (phase-03 plan §7.2 A1, §9.2): the review payload of one of the viewer's games.
// Member (or, with `review-lapsed-read`, a lapsed member) + player; admins read any game; non-players 404.
// `private-etag`: a revalidation runs the one-statement probe only and answers 304 when nothing changed. GETs never
// enqueue (P3-D23); the only write is the declared kick CAS in `after()` for a QUEUED job stale for 30 s.
import type { ReviewRefParams } from "@repo/contracts/http/review";
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route, type Ctx } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { scheduleHealKick } from "@/lib/services/analysis/heal-kick";
import { getReview, probeReview } from "@/lib/services/analysis/read";
import { requireReviewReader } from "@/lib/services/analysis/reader";
import { reviewEtag } from "@/lib/services/analysis/review-dto";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    ...reviewEndpoints.get,
    etagProbe: async (ctx: Ctx<ReviewRefParams>) => {
      const viewer = await requireReviewReader(ctx);
      const db = rawDb(prisma);
      const probe = await probeReview(db, viewer, ctx.params.ref);
      if (!probe) return null;
      scheduleHealKick(ctx, db, probe);
      return reviewEtag(probe, ctx.now.getTime());
    },
  },
  async (ctx) => {
    const viewer = await requireReviewReader(ctx);
    const db = rawDb(prisma);
    const read = await getReview(db, viewer, ctx.params.ref, ctx.now.getTime());
    scheduleHealKick(ctx, db, read.row);
    return respondWith(read.dto, { etag: read.etag });
  },
);
