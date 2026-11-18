// GET /api/train/weakness (phase-06 plan §7.1.1 TR-5): the viewer's weakness profile. Member only; the `weakness` flag
// off answers 404. `private-etag`: a strong version tag (`wk1:…`), so focus refetches and the fallback poll revalidate
// with If-None-Match and get a 304 when nothing moved. Never enqueues (AP-09): its one write is the registered
// `kick_cas` side effect, run after the response, re-kicking a QUEUED recompute that is 30 s overdue (≤ 1 per 30 s).
import { trainEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { assertWeaknessEnabled, readWeakness, weaknessKick } from "@/lib/train/weakness.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(trainEndpoints.weaknessGet, async (ctx) => {
  const viewer = ctx.viewer!;
  await assertWeaknessEnabled(viewer);
  const read = await readWeakness(viewer, ctx.now);
  if (read.kickDue) ctx.after(() => weaknessKick(viewer.id, ctx.now));
  return respondWith(read.payload, { etag: read.etag });
});
