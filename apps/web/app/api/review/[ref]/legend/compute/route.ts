// POST /api/review/[ref]/legend/compute (phase-03 plan §7.2 A9b): queue LEGEND_COMPARE for the evals at the
// divergence. One CTE bumps attempts (≤ 3) and requeues the job; 202 computing, 409 already_ready|analysis_not_done,
// 410 gone after three attempts. The kick goes out in `after()`.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { computeLegend } from "@/lib/services/analysis/legend";

export const dynamic = "force-dynamic";

export const POST = route(reviewEndpoints.legendCompute, async (ctx) => {
  const out = await computeLegend(rawDb(prisma), ctx.viewer!, ctx.params.ref, ctx);
  if (out === "admin_noop") return new Response(null, { status: 204 });
  return respondWith({ status: "computing" as const }, { status: 202 });
});
