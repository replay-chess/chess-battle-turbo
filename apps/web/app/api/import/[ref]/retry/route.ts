// ACC-8 `POST /api/import/{ref}/retry` (phase-04 plan §7.4). Member only. One retry per user and run per 30 s (the
// handler applies IMPORT_RETRY_LIMIT with a per-run subject). FAILED → QUEUED with trigger RETRY and the job upsert at
// IMPORT_SYNC_MANUAL, in one transaction. Another member's ref is a 404 (never 403); a run that is not FAILED is 409
// `not_failed`; an account with another active run (or a RUNNING job) is 409 `sync_running`. 202 with the run; the
// worker is kicked (`import_retry`) after the response.
import { IMPORT_RETRY_LIMIT, scopedRateSubject } from "@repo/contracts/http/accounts";
import { importEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { getRouteDeps } from "@/lib/api/context";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { runLinkEffects } from "@/lib/accounts/effects";
import { requireImportFlag } from "@/lib/accounts/flag";
import { retryRun } from "@/lib/accounts/link-service";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(importEndpoints.retry, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  const decision = await getRouteDeps().checkRateLimit([IMPORT_RETRY_LIMIT], {
    clerkUserId: scopedRateSubject(ctx.clerkUserId!, ctx.params.ref),
    ip: null,
  });
  if (!decision.allowed) {
    throw new ApiError("rate_limited", { retryAfterSec: Math.max(1, decision.retryAfterSec), details: { source: "replay" } });
  }
  const out = await retryRun({ viewer, ref: ctx.params.ref, now: ctx.now });
  ctx.after(() => runLinkEffects(out.effects, { viewer, requestId: ctx.requestId, now: ctx.now }));
  return respondWith({ run: out.run }, { status: 202 });
});
