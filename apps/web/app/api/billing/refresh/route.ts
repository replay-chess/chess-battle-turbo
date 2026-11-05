// POST /api/billing/refresh (plan §7.4 A19, CA AP-31): re-reads the viewer's membership from Dodo and applies it with
// the compare-and-set (lib/billing/refresh.ts). The only request path that reads Dodo for the viewer: GET
// /api/subscription and GET /api/me are DB-only. Rate limit `billing-refresh` 10 / 60 s per user fits the activation
// poll (1 + 6 calls in about 12 s). Dodo unreachable → the stored state with `refreshed: false`; no API key → 503
// not_configured. When the users row changed, the Clerk claims are synced after the response.
import { billingEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { route } from "@/lib/api/route";
import { entitlementOf, isPaywallEnabled } from "@/lib/auth/membership";
import { toLegacySubscription } from "@/lib/auth/viewer-dto";
import { defaultRefreshDeps, getBillingProvider, refreshMembership } from "@/lib/billing/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const POST = route(billingEndpoints.refresh, async (ctx) => {
  // auth "user": route() answered 401 already when there is no viewer.
  const viewer = ctx.viewer!;
  const provider = await getBillingProvider();
  if (!provider) throw new ApiError("not_configured", { message: "Billing is not configured.", details: { provider: "dodo" } });

  const result = await refreshMembership(
    {
      userId: viewer.id,
      email: viewer.billing.email,
      dodoCustomerId: viewer.billing.dodoCustomerId,
      subscriptionProductId: viewer.billing.subscriptionProductId,
      stored: viewer.billing.summary,
    },
    await defaultRefreshDeps(provider, ctx.now),
  );
  if (result.changed) {
    ctx.after(async () => {
      const { syncClerkClaims } = await import("@/lib/auth/claims");
      await syncClerkClaims(viewer.id);
    });
  }

  const paywall = isPaywallEnabled();
  return {
    entitlement: entitlementOf(result.summary, {
      role: viewer.role === "admin" ? "ADMIN" : "USER",
      dodoCustomerId: result.customerId,
      now: ctx.now,
      paywallEnabled: paywall,
    }),
    refreshed: result.refreshed,
    legacy: toLegacySubscription(result.summary, { customerId: result.customerId, productId: result.productId, paywall }),
  };
});
