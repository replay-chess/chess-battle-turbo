// The paywall for legacy route handlers (not route() yet: create-game, join, matchmaking, tournament, analysis).
// route({ auth: "member" }) is the same gate for new routes (lib/api/route.ts); both answer 402 with
// `details.reason` (plan §8.3) and the one-release top-level mirror `code` + `upgradeUrl` (plan §7.1) while
// LEGACY_402_MIRROR is not "off".
import { NextRequest, NextResponse } from "next/server";
import type { SubscriptionReason } from "@repo/contracts/http/codes";
import { DEFAULT_ERROR_MESSAGES } from "@/lib/api/api-error";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/api/request-id";
import { NO_STORE } from "@/lib/api/cache";
import type { resolveUser } from "@/lib/auth/resolve-user";
import { isPerfBypassRequest } from "@/lib/auth/secrets";
import type { ProductCatalog } from "@/lib/billing/plans";
import { getProductCatalog } from "@/lib/billing/products";
import { isPaywallEnabled, membershipOf, reasonFor, upgradeUrlFor, type MembershipRecord } from "./membership";

export { isPaywallEnabled, reasonFor, upgradeUrlFor };

/** HTTP status returned when a signed-in user has no active plan. */
export const SUBSCRIPTION_REQUIRED_STATUS = 402;
export const SUBSCRIPTION_REQUIRED_CODE = "subscription_required";

type Env = Readonly<Record<string, string | undefined>>;

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

export type RequireSubscriptionResult =
  | { user: ResolvedUser; response?: undefined }
  | { user?: undefined; response: NextResponse };

/** The 402 reason for a users row (plan §8.3), from the same rules as the viewer. */
export function reasonForRecord(
  record: MembershipRecord,
  now: Date,
  catalog: ProductCatalog = getProductCatalog(),
): SubscriptionReason {
  return reasonFor(membershipOf(record, { now, paywallEnabled: true, catalog }));
}

/** True while 402 bodies carry the top-level `code` + `upgradeUrl` for old clients (plan §7.1; removed in P2). */
export function legacy402MirrorOn(env: Env = process.env): boolean {
  return env.LEGACY_402_MIRROR?.toLowerCase() !== "off";
}

/**
 * The 402 body: the `{ error }` envelope with `details.reason` and `upgradeUrl`, plus the top-level mirror while
 * LEGACY_402_MIRROR is on. Same shape as route()'s member denial.
 */
export function subscriptionRequiredBody(
  reason: SubscriptionReason,
  requestId: string,
  env: Env = process.env,
): Record<string, unknown> {
  const upgradeUrl = upgradeUrlFor(reason);
  const error = {
    code: SUBSCRIPTION_REQUIRED_CODE,
    message: DEFAULT_ERROR_MESSAGES.subscription_required,
    details: { reason, upgradeUrl },
    requestId,
  };
  return legacy402MirrorOn(env) ? { code: SUBSCRIPTION_REQUIRED_CODE, upgradeUrl, error } : { error };
}

/**
 * Resolves the caller like `resolveUser`, then requires an active Coaching membership (or trial).
 *
 * Bypassed for: internal service calls (the socket server persisting moves),
 * the fenced perf-test bypass (test hooks on + `x-perf-token`, AA F-11), admins, and when the paywall is switched off.
 * Everyone else gets a 402 whose `details.reason` says why (trial_available, trial_used, expired, payment_failed).
 */
export async function requireSubscribedUser(request: NextRequest): Promise<RequireSubscriptionResult> {
  // Loaded on use: resolve-user pulls in Clerk's server SDK, which plain-Node unit tests of this module can't load.
  const { isInternalServiceRequest, resolveUser } = await import("@/lib/auth/resolve-user");
  const user = await resolveUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const bypass =
    !isPaywallEnabled() ||
    isInternalServiceRequest(request) ||
    isPerfBypassRequest(request) ||
    user.role === "ADMIN";
  if (bypass) return { user };

  const now = new Date();
  const membership = membershipOf(user, { now, paywallEnabled: true, catalog: getProductCatalog() });
  if (membership.entitlement.entitled) return { user };

  const requestId = requestIdFrom(request.headers);
  return {
    response: NextResponse.json(subscriptionRequiredBody(reasonFor(membership), requestId), {
      status: SUBSCRIPTION_REQUIRED_STATUS,
      headers: { "Cache-Control": NO_STORE, [REQUEST_ID_HEADER]: requestId },
    }),
  };
}
