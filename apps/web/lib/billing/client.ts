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
 * Query parameters that only describe a checkout return: the `checkout` flag
 * we append and the fields Dodo adds to the return URL. They must never be
 * carried into a paywall `redirect_url`, otherwise a later bounce would send a
 * buyer back into the "activating" state on a page that was never a return.
 */
export const CHECKOUT_RETURN_PARAMS: readonly string[] = [
  "checkout",
  "status",
  "subscription_id",
  "session_id",
  "email",
];

/**
 * Builds the pricing URL a gated visitor should land on. `returnPath` is the
 * app path (with query string) to send them back to after they subscribe.
 */
export function paywallUrl(returnPath: string): string {
  return `/pricing?reason=required&redirect_url=${encodeURIComponent(returnPath)}`;
}

/**
 * The path a checkout should return to when the buyer ultimately wants to
 * land on `gatedPath`. Every return goes through `/checkout/activating`
 * (phase-04 plan 4.9), which confirms the activation (socket + poll) and then
 * forwards to `redirect_url`, so a gated page never has to cope with a plan
 * that is still activating. The server unwraps this value when it builds the
 * Dodo return URL (`buildActivationReturnUrl`), so it is never nested.
 */
export function checkoutReturnPath(gatedPath: string): string {
  return `/checkout/activating?redirect_url=${encodeURIComponent(gatedPath)}`;
}

/**
 * The return path of a checkout started on /pricing (plan §1 step 25, §4.9): back to the page's `redirect_url` when it
 * has one, else to the pricing page itself (`here`, the page's path and query without the checkout-return fields), so
 * Dodo returns to `/checkout/activating?redirect_url=/pricing…` and the activation page can name and reach the
 * destination. regression: D15 — a checkout from a bare /pricing returned with no `redirect_url` at all.
 */
export function pricingCheckoutReturnPath(redirectUrl: string | null | undefined, here: string): string {
  if (redirectUrl) return checkoutReturnPath(redirectUrl);
  const own = stripCheckoutParams(here);
  const q = own.indexOf("?");
  const params = new URLSearchParams(q === -1 ? "" : own.slice(q + 1));
  params.delete("redirect_url"); // an unsafe one (redirectUrl is null): never carried along
  const search = params.toString();
  const path = q === -1 ? own : own.slice(0, q);
  return checkoutReturnPath(search ? `${path}?${search}` : path);
}

/**
 * Removes checkout-return parameters (`checkout`, `status`, ...) from an app
 * path so it can be reused as a clean paywall `redirect_url`.
 */
export function stripCheckoutParams(appPath: string): string {
  const queryIndex = appPath.indexOf("?");
  if (queryIndex === -1) return appPath;
  const pathname = appPath.slice(0, queryIndex);
  const params = new URLSearchParams(appPath.slice(queryIndex + 1));
  for (const key of CHECKOUT_RETURN_PARAMS) params.delete(key);
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/**
 * The current app path including its query string, suitable for
 * `paywallUrl`. Falls back to "/" when there is no window (SSR).
 */
export function currentAppPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/** Longest the activation pages wait for Clerk to re-mint the session token (lib/billing/useActivation.ts). */
export const SESSION_RELOAD_CAP_MS = 5000;

type ClerkGlobal = { Clerk?: { session?: { reload?: () => Promise<unknown> } | null } };

/**
 * Re-mints the Clerk session token so its claims (`md.entitled`, read by the
 * middleware member gate) reflect a plan that was just activated. A no-op
 * without a browser or a loaded Clerk; never throws.
 */
/**
 * Leaves an activation screen with a document navigation. On success the screen reloads the Clerk session, and Clerk's
 * App Router integration answers that with a refresh of the current route, which can cancel a client-side push started
 * at the same moment: "Continue" then left the member on Activating (INTEGRATE-2). A document navigation cannot be
 * cancelled that way, and the next page's middleware reads the new session cookie.
 */
export function leaveActivation(path: string, target: { location: Pick<Location, "assign"> } | undefined = typeof window === "undefined" ? undefined : window): void {
  target?.location.assign(path);
}

export async function reloadClerkSession(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await (window as unknown as ClerkGlobal).Clerk?.session?.reload?.();
  } catch {
    // A stale token only delays the claim gate; the API reads the database.
  }
}

/**
 * True when a JSON error body carries the subscription_required code, either
 * at the top level (Phase 0 bodies, and the `LEGACY_402_MIRROR` copy) or in the
 * envelope's `error.code` (route() responses, plan §7.1).
 */
export function isSubscriptionRequiredBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { code?: unknown; error?: unknown };
  if (b.code === SUBSCRIPTION_REQUIRED_CODE) return true;
  const error = b.error;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === SUBSCRIPTION_REQUIRED_CODE
  );
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
    return isSubscriptionRequiredBody(await res.clone().json());
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

/**
 * True when the subscription exists but a renewal charge is failing, so the
 * fix is to update the payment method rather than buy a second plan.
 */
export function needsPaymentUpdate(subscription: StoreSubscription | null | undefined): boolean {
  if (!subscription || isEntitledClient(subscription)) return false;
  const status = subscription.subscription?.status ?? subscription.status ?? null;
  return status === "on_hold" || status === "past_due";
}
