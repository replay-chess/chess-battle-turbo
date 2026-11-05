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

/** Longest the activation flow waits for Clerk to re-mint the session token. */
export const SESSION_RELOAD_CAP_MS = 5000;

type ClerkGlobal = { Clerk?: { session?: { reload?: () => Promise<unknown> } | null } };

/**
 * Re-mints the Clerk session token so its claims (`md.entitled`, read by the
 * middleware member gate) reflect a plan that was just activated. A no-op
 * without a browser or a loaded Clerk; never throws.
 */
export async function reloadClerkSession(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await (window as unknown as ClerkGlobal).Clerk?.session?.reload?.();
  } catch {
    // A stale token only delays the claim gate; the API reads the database.
  }
}

/**
 * Refreshes entitlement right away and then keeps re-checking on the
 * activation schedule until `isEntitled()` is true, the attempts run out, or
 * `isCancelled()` reports that nobody is waiting any more. Resolves to the
 * final entitlement answer (false when cancelled).
 *
 * On success the Clerk session is reloaded (at most `SESSION_RELOAD_CAP_MS`)
 * before resolving, so a caller that navigates next reaches the middleware
 * with fresh claims (plan §3.2, 1B·F4d).
 */
export async function waitForEntitlement(options: {
  refresh: () => Promise<unknown>;
  isEntitled: () => boolean;
  isCancelled?: () => boolean;
  attempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
  /** Defaults to `reloadClerkSession`. */
  reloadSession?: () => Promise<unknown>;
}): Promise<boolean> {
  const {
    refresh,
    isEntitled,
    isCancelled = () => false,
    attempts = ACTIVATION_POLL_ATTEMPTS,
    intervalMs = ACTIVATION_POLL_MS,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    reloadSession = reloadClerkSession,
  } = options;

  const succeed = async (): Promise<true> => {
    await Promise.race([reloadSession().catch(() => undefined), wait(SESSION_RELOAD_CAP_MS)]);
    return true;
  };

  await refresh();
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isCancelled()) return false;
    if (isEntitled()) return succeed();
    await wait(intervalMs);
    if (isCancelled()) return false;
    await refresh();
  }
  if (isCancelled() || !isEntitled()) return false;
  return succeed();
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
