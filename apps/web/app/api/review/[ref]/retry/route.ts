// POST /api/review/[ref]/retry (phase-03 plan §7.2 A4): pull a failed, retryable analysis forward (attempts are not
// reset; it resumes from its last checkpoint). 202, 409 already_running|not_failed, 410 gone.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { retryAnalysis } from "@/lib/services/analysis/enqueue";

export const dynamic = "force-dynamic";

export const POST = route(reviewEndpoints.retry, async (ctx) => {
  const out = await retryAnalysis(rawDb(prisma), ctx.viewer!, ctx.params.ref, ctx);
  if (out.status === 204) return new Response(null, { status: 204 });
  return respondWith(out.body, { status: 202 });
});
