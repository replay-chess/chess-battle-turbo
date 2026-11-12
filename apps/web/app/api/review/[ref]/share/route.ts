// POST /api/review/[ref]/share (phase-03 plan §7.2 A10, §5.4, §11.3): a public 30-day link to the review of one of
// the viewer's games. Member + player; flag `review-share` (404 while off). 201 with a new link, 200 when an identical
// live link (same game, toggle and moment) is reused; 409 analysis_not_done; 429 for the burst (5 / 60 s) or the
// durable daily cap (20, counted from `shares`). `Idempotency-Key` is optional (the share page sends its
// sessionStorage key): a replay answers the stored response with `Idempotent-Replayed: true`. A non-player admin is a
// 204 no-op. The server event `share_link_created` goes out after a create (not a reuse).
import { shareEndpoints } from "@repo/contracts/http/registry";
import { IDEMPOTENCY_REPLAYED_HEADER, readIdempotencyKey, requestHash, withIdempotency } from "@/lib/api/idempotency";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { DataError } from "@/lib/data/errors";
import { rawDb, rawTransaction } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { createOrReuseShare, shareCreateIdentity } from "@/lib/services/analysis/share";
import { shareEnabledFor } from "@/lib/services/analysis/share-flag";
import { captureReviewServerEvent } from "@/lib/services/analysis/telemetry";
import type { ShareDTO } from "@repo/contracts/http/share";

export const dynamic = "force-dynamic";

export const POST = route(shareEndpoints.create, async (ctx) => {
  const viewer = ctx.viewer!;
  if (!(await shareEnabledFor(viewer))) throw new DataError("not_found");
  const db = rawDb(prisma);
  const key = readIdempotencyKey(ctx.req.headers, { required: false });
  const run = async (): Promise<{ status: number; body: ShareDTO | null }> => {
    const out = await createOrReuseShare(db, viewer, ctx.params.ref, ctx.body, {
      nowMs: ctx.now.getTime(),
      transaction: rawTransaction(prisma),
    });
    if (out === "admin_noop") return { status: 204, body: null };
    if (out.status === 201) {
      ctx.after(() =>
        captureReviewServerEvent("share_link_created", { from: ctx.body.from, show_username: out.dto.showUsername }, viewer.ref),
      );
    }
    return { status: out.status, body: out.dto };
  };
  const out = key
    ? await withIdempotency(
        db,
        { userId: viewer.id, key, route: shareEndpoints.create.id, hash: requestHash(shareCreateIdentity(ctx.body)), now: ctx.now },
        run,
      )
    : { ...(await run()), replayed: false };
  if (out.status === 204 || !out.body) return new Response(null, { status: 204 });
  return respondWith(out.body, {
    status: out.status === 201 ? 201 : 200,
    ...(out.status === 201 ? { location: `/api/share/${out.body.code}` } : {}),
    ...(out.replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {}),
  });
});
