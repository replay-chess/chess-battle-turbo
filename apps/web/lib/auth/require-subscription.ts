import { NextRequest, NextResponse } from "next/server";
import { isEntitled } from "@/lib/billing/entitlement-rules";
import { isInternalServiceRequest, resolveUser } from "@/lib/auth/resolve-user";

/** HTTP status returned when a signed-in user has no active plan. */
export const SUBSCRIPTION_REQUIRED_STATUS = 402;
export const SUBSCRIPTION_REQUIRED_CODE = "subscription_required";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

export type RequireSubscriptionResult =
  | { user: ResolvedUser; response?: undefined }
  | { user?: undefined; response: NextResponse };

/**
 * Kill switch for the paywall. Set BILLING_PAYWALL=off to let every signed-in
 * user play, for example while the Dodo products are being configured.
 */
export function isPaywallEnabled(): boolean {
  return process.env.BILLING_PAYWALL?.toLowerCase() !== "off";
}

/**
 * Resolves the caller like `resolveUser`, then requires an active Player plan.
 *
 * Bypassed for: internal service calls (the socket server persisting moves),
 * the perf-test auth bypass, admins, and when the paywall is switched off.
 * Everyone else gets a 402 with a machine-readable code the client can act on.
 */
export async function requireSubscribedUser(
  request: NextRequest,
): Promise<RequireSubscriptionResult> {
  const user = await resolveUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const bypass =
    !isPaywallEnabled() ||
    isInternalServiceRequest(request) ||
    process.env.PERF_AUTH_BYPASS === "true" ||
    user.role === "ADMIN";

  if (bypass || isEntitled(user)) {
    return { user };
  }

  return {
    response: NextResponse.json(
      {
        error: "An active ReplayChess Player plan is required to play",
        code: SUBSCRIPTION_REQUIRED_CODE,
        upgradeUrl: "/pricing?reason=required",
      },
      { status: SUBSCRIPTION_REQUIRED_STATUS },
    ),
  };
}
