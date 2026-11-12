// PATCH /api/review/[ref]/progress (phase-03 plan §7.2 A5): walkthrough progress, JSON or text/plain JSON (keepalive
// fetch / beacon), ≤ 8 KB, ≤ 50 events. Monotonic merge through review_progress_merge(); 204.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { recordProgress } from "@/lib/services/analysis/walkthrough";

export const dynamic = "force-dynamic";

export const PATCH = route(reviewEndpoints.progress, async (ctx) => {
  await recordProgress(rawDb(prisma), ctx.viewer!, ctx.params.ref, ctx.body);
  return undefined;
});
