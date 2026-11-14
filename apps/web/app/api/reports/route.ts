// POST /api/reports (phase-05 plan §7.2 W7, §7.3; api SYS-6): reports a wrong Mistake Bank position or puzzle. 201 new,
// 200 `duplicate: true` for the same target within 24 h, 404 for a target the viewer cannot see, 429 after 20 reports
// in 24 h (durable, `details.reason: "report_limit"`) or 5 a minute (`report-burst`). `Idempotency-Key` required.
import { reportsEndpoints } from "@repo/contracts/http/registry";
import { IDEMPOTENCY_REPLAYED_HEADER, readIdempotencyKey, requestHash, withIdempotency } from "@/lib/api/idempotency";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { createReport } from "@/lib/reports/reports.server";
import { trainDeps } from "@/lib/train/db.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(reportsEndpoints.create, async (ctx) => {
  const viewer = ctx.viewer!;
  const key = readIdempotencyKey(ctx.req.headers, { required: true })!;
  const deps = trainDeps();
  const out = await withIdempotency(
    deps.db,
    { userId: viewer.id, key, route: reportsEndpoints.create.id, hash: requestHash(ctx.body), now: ctx.now },
    () => createReport(viewer, ctx.body, ctx.now, deps),
  );
  return respondWith(out.body, {
    status: out.status === 201 ? 201 : 200,
    ...(out.replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {}),
  });
});
