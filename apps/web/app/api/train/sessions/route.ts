// POST /api/train/sessions (phase-05 plan §7.2 W2, §7.3): creates a training session (201) or returns the ACTIVE one of
// the same spec (< 2 h, not fully graded; 200). `Idempotency-Key` (UUID v4) is required: a replay answers the stored
// response with `Idempotent-Replayed: true`, the same key with another body is 422 `idempotency_key_reused`. The
// hourly session limit (30) and the daily puzzle fair use (400) are counted by the service from their source rows
// (429 `rate_limited` with `details.reason` and `Retry-After`); a puzzle shard that is down is 502.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { IDEMPOTENCY_REPLAYED_HEADER, readIdempotencyKey, requestHash, withIdempotency } from "@/lib/api/idempotency";
import { getRouteDeps } from "@/lib/api/context";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { trainDeps } from "@/lib/train/db.server";
import { openSession } from "@/lib/train/sessions.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.sessionCreate, async (ctx) => {
  const viewer = ctx.viewer!;
  const key = readIdempotencyKey(ctx.req.headers, { required: true })!;
  const deps = trainDeps();
  const out = await withIdempotency(
    deps.db,
    { userId: viewer.id, key, route: trainEndpoints.sessionCreate.id, hash: requestHash(ctx.body), now: ctx.now },
    async () => {
      const started = performance.now();
      // Sentry child span `session.build` (plan §10.2): compose, shard reads and the insert of one session.
      const opened = await getRouteDeps().telemetry.startSpan("session.build", { kind: ctx.body.kind }, () => openSession(viewer, ctx.body, ctx.now, deps));
      // Sentry metric (plan §10.2): the build time per kind (a cold puzzle shard shows here).
      getRouteDeps().telemetry.distribution("train.session.build_ms", performance.now() - started, { kind: ctx.body.kind });
      return { status: opened.created ? 201 : 200, body: opened.payload };
    },
  );
  return respondWith(out.body, {
    status: out.status === 201 ? 201 : 200,
    ...(out.status === 201 ? { location: `/api/train/sessions/${out.body.ref}` } : {}),
    ...(out.replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {}),
  });
});
