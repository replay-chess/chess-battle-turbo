// POST /api/review/[ref]/analyse (phase-03 plan §7.2 A3): queue an unanalysed game, or regrade an outdated one, at
// USER_OPENED. 202 queued|running, 200 done (already done at the current grading version), 409 skipped, 410 gone.
// The kick (with `watch`) and `analysis:queued` go out after the commit, in `after()`.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { requestAnalysis } from "@/lib/services/analysis/enqueue";

export const dynamic = "force-dynamic";

export const POST = route(reviewEndpoints.analyse, async (ctx) => {
  const out = await requestAnalysis(rawDb(prisma), ctx.viewer!, ctx.params.ref, ctx.body.reason, ctx);
  if (out.status === 204) return new Response(null, { status: 204 });
  return respondWith(out.body, { status: out.status });
});
