// BIL-1 · POST /api/checkout (phase-04 plan 7.5.1): opens a Dodo hosted checkout for the Coaching plan, with the 7-day
// trial when this person never had one. The logic is lib/billing/checkout.ts `startCheckout`; this route adds the
// required Idempotency-Key: a replay (double click, the bfcache Back button) answers the stored response with
// `Idempotent-Replayed: true`, and a 4xx is stored too (the same request fails the same way). Rate limit `checkout`
// 6 / 60 s per user (registry entry).
import { activationEndpoints } from "@repo/contracts/http/registry";
import type { CheckoutData } from "@repo/contracts/http/billing";
import { getRouteDeps } from "@/lib/api/context";
import { IDEMPOTENCY_REPLAYED_HEADER, readIdempotencyKey, requestHash, withIdempotency } from "@/lib/api/idempotency";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { defaultCheckoutDeps, startCheckout } from "@/lib/billing/checkout";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(activationEndpoints.checkout, async (ctx) => {
  // auth "user": route() answered 401 already when there is no viewer.
  const viewer = ctx.viewer!;
  const key = readIdempotencyKey(ctx.req.headers, { required: true })!;
  const routeDeps = getRouteDeps();
  const [{ prisma }, { rawDb }] = await Promise.all([import("@/lib/prisma"), import("@/lib/games/snapshot.server")]);
  const deps = await defaultCheckoutDeps({
    env: routeDeps.env,
    after: ctx.after,
    log: (level, message) => routeDeps.log(level, message, { requestId: ctx.requestId }),
  });
  const out = await withIdempotency<CheckoutData>(
    rawDb(prisma),
    { userId: viewer.id, key, route: activationEndpoints.checkout.id, hash: requestHash(ctx.body), now: ctx.now },
    async () => ({ status: 200, body: await startCheckout(viewer, ctx.body, ctx.now, deps) }),
  );
  return respondWith(out.body, out.replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {});
});
