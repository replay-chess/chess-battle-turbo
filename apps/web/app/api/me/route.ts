// GET /api/me (plan §7.4 A3, §5.2): the signed-in viewer as MeData. One getViewer() (route() loads it: one statement)
// plus getFlags() (PostHog local evaluation, no network when warm). Declared side effect `provision_user`: a first
// request that beats the Clerk user.created webhook creates the users row (lib/auth/provision-user.ts); a Clerk user
// without a verified email gets 502 upstream_unavailable { provider: "clerk", kind } from the viewer loader.
// Cache tier private-etag: `private, no-cache` + a strong ETag, so a focus refetch with no change is a 304.
// P4 (FIX-1): `entitlement.trial.eligible` also asks the trial ledger (lib/billing/trial-eligibility.ts) while the row
// says eligible, so /pricing never offers a trial the checkout would refuse.
import { meEndpoints } from "@repo/contracts/http/registry";
import { getRouteDeps, serverBuildId } from "@/lib/api/context";
import { route } from "@/lib/api/route";
import { meDataOf } from "@/lib/auth/viewer-dto";
import { withLedgerEligibility } from "@/lib/billing/trial-eligibility";
import { getFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";

export const maxDuration = 10;

export const GET = route(meEndpoints.get, async (ctx) => {
  // auth "user": route() answered 401 already when there is no viewer.
  const deps = getRouteDeps();
  // trial.eligible asks the trial ledger (plan 7.2, 8.4.3; FIX-1): one more statement, only while the row says
  // eligible (a never-subscribed non-member); everyone else stays at one statement.
  const viewer = await withLedgerEligibility(ctx.viewer!, deps.trialLedgerProbe, (err) =>
    deps.log("warn", "me.trial_ledger_probe_failed", { requestId: ctx.requestId, error: err instanceof Error ? err.name : "unknown" }),
  );
  const flags = await getFlags(viewer);
  ctx.timing.mark("flags");
  return meDataOf(viewer, flags, serverBuildId());
});
