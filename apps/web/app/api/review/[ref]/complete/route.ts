// POST /api/review/[ref]/complete (phase-03 plan §7.2 A7): Finish Review. completedAt is set once; a replay answers
// the same body. 409 analysis_not_done before the review exists.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { completeReview } from "@/lib/services/analysis/walkthrough";

export const dynamic = "force-dynamic";

export const POST = route(reviewEndpoints.complete, async (ctx) => {
  const out = await completeReview(rawDb(prisma), ctx.viewer!, ctx.params.ref, ctx.now.getTime());
  if (out === "admin_noop") return new Response(null, { status: 204 });
  return out.body;
});
