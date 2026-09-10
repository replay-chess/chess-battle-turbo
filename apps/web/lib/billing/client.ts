/**
 * Client-safe billing helpers. No server imports, no React, so these can be
 * used from hooks, components and unit tests alike.
 *
 * The server gate (`requireSubscribedUser`) is authoritative. Everything here
 * only shapes the UX around it: deciding when to send someone to /pricing and
 * recognising the 402 the API returns when they try to play without a plan.
 */
import type { StoreSubscription } from "@/lib/stores/useUserStore";

/** Machine-readable code carried by the 402 JSON body. */
export const SUBSCRIPTION_REQUIRED_CODE = "subscription_required";

/** HTTP status used by the API when an active plan is required. */
export const SUBSCRIPTION_REQUIRED_STATUS = 402;

/**
 * Builds the pricing URL a gated visitor should land on. `returnPath` is the
 * app path (with query string) to send them back to after they subscribe.
 */
export function paywallUrl(returnPath: string): string {
  return `/pricing?reason=required&redirect_url=${encodeURIComponent(returnPath)}`;
}

/**
 * The current app path including its query string, suitable for
 * `paywallUrl`. Falls back to "/" when there is no window (SSR).
 */
export function currentAppPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * True when a fetch response is the API's "subscription required" answer:
 * either a 402 status or a JSON body carrying the subscription_required code.
 * The body is read from a clone so callers can still consume the original.
 */
export async function isSubscriptionRequiredResponse(res: Response): Promise<boolean> {
  if (res.status === SUBSCRIPTION_REQUIRED_STATUS) return true;
  if (res.ok) return false;
  try {
    const body: unknown = await res.clone().json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { code?: unknown }).code === SUBSCRIPTION_REQUIRED_CODE
    );
  } catch {
    return false;
  }
}

/**
 * Client-side mirror of the server entitlement decision. Used only to avoid
 * rendering gated screens for someone who will be bounced anyway; the API
 * still enforces the paywall on every game-starting request.
 */
export function isEntitledClient(
  subscription: StoreSubscription | null | undefined,
  role?: string | null,
): boolean {
  if (role === "ADMIN") return true;
  if (!subscription) return false;
  if (subscription.paywall === false) return true;
  return subscription.entitled === true;
}
