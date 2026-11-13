// BIL-2 · GET /api/billing/activation (phase-04 plan 7.5.2, 8.5; D4-29, AP-06, AP-31): whether the viewer's checkout
// has activated their membership. Polled by both activating pages (2 s × 6, 5 s × 12, then 15 s). The answer comes
// from lib/data/billing.ts `resolveActivation(viewer, query, {dodo: true})`: the database first; Dodo only after 6 s,
// at most once per 5 s per user (or on `force=1`, Check Again), and every write goes through P1's compare-and-set
// (the registered GET side effect `billing_snapshot`). On `active` this route — never the DAL or a server component —
// sets the 120 s `rc_act` bridge cookie (WP-F's lib/onboarding/claim-cookie.ts) so middleware lets the member through
// before Clerk's session token carries `md.entitled`.
import { activationEndpoints } from "@repo/contracts/http/registry";
import { getRouteDeps } from "@/lib/api/context";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { resolveActivation } from "@/lib/data/billing";
import { claimCookieSecret, claimSetCookie, cookieSecureFor, signClaimCookie } from "@/lib/onboarding/claim-cookie";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const GET = route(activationEndpoints.activation, async (ctx) => {
  // auth "user": route() answered 401 already when there is no viewer.
  const viewer = ctx.viewer!;
  const deps = getRouteDeps();
  const result = await resolveActivation(viewer, ctx.query, { dodo: true, now: ctx.now });
  deps.telemetry.setTag("dodo", result.dodoCalled ? "yes" : "no");
  if (result.via === "self_heal") deps.telemetry.distribution("activation.waited_ms", result.data.waitedMs, { via: "self_heal" });
  if (result.data.state !== "active") return result.data;

  // The same refresh path as POST /api/billing/refresh (plan 7.5.2): an active answer syncs the Clerk claims after
  // the response (a no-op when they already match). The webhook syncs only when its own CAS changes the row, so a
  // late or lost webhook after this self-heal would otherwise leave `md.entitled=false` once rc_act expires, and the
  // member gate would send a paying member to /pricing (FIX-1).
  ctx.after(() => deps.syncClaims(viewer.id));

  const secret = claimCookieSecret(deps.env);
  if (!secret) {
    deps.log("warn", "billing.activation_cookie_skipped", { reason: "SIGNED_COOKIE_SECRET unset", requestId: ctx.requestId });
    return result.data;
  }
  const value = await signClaimCookie("act", viewer.clerkUserId, ctx.now.getTime(), secret);
  return respondWith(result.data, {
    headers: { "Set-Cookie": claimSetCookie("act", value, { secure: cookieSecureFor(ctx.req.url, deps.env) }) },
  });
});
