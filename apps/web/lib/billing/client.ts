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
 * How often and how many times entitlement is re-checked after a checkout
 * returns. Dodo redirects before its webhook (and sometimes before its own
 * subscription list) reflects the new plan, so a single read is not enough.
 */
export const ACTIVATION_POLL_MS = 2000;
export const ACTIVATION_POLL_ATTEMPTS = 6;

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
 * land on `gatedPath`. Every return goes through /pricing, which polls for
 * activation and then forwards to `redirect_url`, so a gated page never has to
 * cope with a plan that is still activating. `reason=required` is deliberately
 * absent: the return must not show the paywall banner.
 */
export function checkoutReturnPath(gatedPath: string): string {
  return `/pricing?redirect_url=${encodeURIComponent(gatedPath)}`;
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

/**
 * Refreshes entitlement right away and then keeps re-checking on the
 * activation schedule until `isEntitled()` is true, the attempts run out, or
 * `isCancelled()` reports that nobody is waiting any more. Resolves to the
 * final entitlement answer (false when cancelled).
 */
export async function waitForEntitlement(options: {
  refresh: () => Promise<unknown>;
  isEntitled: () => boolean;
  isCancelled?: () => boolean;
  attempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const {
    refresh,
    isEntitled,
    isCancelled = () => false,
    attempts = ACTIVATION_POLL_ATTEMPTS,
    intervalMs = ACTIVATION_POLL_MS,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  await refresh();
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isCancelled()) return false;
    if (isEntitled()) return true;
    await wait(intervalMs);
    if (isCancelled()) return false;
    await refresh();
  }
  return !isCancelled() && isEntitled();
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

/**
 * True when the subscription exists but a renewal charge is failing, so the
 * fix is to update the payment method rather than buy a second plan.
 */
export function needsPaymentUpdate(subscription: StoreSubscription | null | undefined): boolean {
  if (!subscription || isEntitledClient(subscription)) return false;
  const status = subscription.subscription?.status ?? subscription.status ?? null;
  return status === "on_hold" || status === "past_due";
}
