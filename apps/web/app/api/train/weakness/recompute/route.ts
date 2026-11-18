// POST /api/train/weakness/recompute (phase-06 plan §7.1.2 TR-12): 202 `{status: "computing", queuedAt, scopeChanged}`.
// Retry, "Include bullet games" and the orphaned page's auto-build. The burst bucket (5 / 60 s) runs in route(); the
// durable 1 per 600 s is read from the member's own job row inside the enqueue statement (429 + Retry-After). The kick
// runs after the response. Member only; the `weakness` flag off answers 404.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { assertWeaknessEnabled } from "@/lib/train/weakness.server";
import { requestRecompute } from "@/lib/train/weakness-write.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.weaknessRecompute, async (ctx) => {
  const viewer = ctx.viewer!;
  await assertWeaknessEnabled(viewer);
  const out = await requestRecompute(viewer, ctx.body, ctx.now);
  ctx.after(out.kick);
  return respondWith(out.response, { status: 202 });
});
