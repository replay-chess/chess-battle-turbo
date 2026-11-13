// ACC-4 `POST /api/accounts/{provider}/sync` (phase-04 plan §7.3.6, §8.10, §8.11). Member only (402 renders inline,
// "Importing starts when your trial begins."). One manual sync per user and provider per 30 s (the handler applies
// ACCOUNT_SYNC_LIMIT with a per-provider subject; `details.source: "replay"`), and never before the provider back-off
// `nextAllowedSyncAt` (429 `details.source: <provider>`). One transaction: a MANUAL run (409 `sync_running` when the
// account already has an active run, the import_runs_one_active index) and the job upsert at IMPORT_SYNC_MANUAL (409
// when the job is RUNNING). 202 with the queued run; the worker is kicked after the response.
import { ACCOUNT_SYNC_LIMIT, scopedRateSubject } from "@repo/contracts/http/accounts";
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { getRouteDeps } from "@/lib/api/context";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { runLinkEffects } from "@/lib/accounts/effects";
import { requireImportFlag } from "@/lib/accounts/flag";
import { syncAccount } from "@/lib/accounts/link-service";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(accountsEndpoints.sync, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  const decision = await getRouteDeps().checkRateLimit([ACCOUNT_SYNC_LIMIT], {
    clerkUserId: scopedRateSubject(ctx.clerkUserId!, ctx.params.provider),
    ip: null,
  });
  if (!decision.allowed) {
    throw new ApiError("rate_limited", { retryAfterSec: Math.max(1, decision.retryAfterSec), details: { source: "replay" } });
  }
  const out = await syncAccount({ viewer, provider: ctx.params.provider, now: ctx.now });
  ctx.after(() => runLinkEffects(out.effects, { viewer, requestId: ctx.requestId, now: ctx.now }));
  return respondWith({ run: out.run }, { status: 202 });
});
