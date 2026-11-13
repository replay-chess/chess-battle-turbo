"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth, UseRequireAuthReturn } from "./useRequireAuth";
import { useUserStore } from "@/lib/stores";
import {
  CHECKOUT_RETURN_PARAMS,
  isEntitledClient,
  paywallUrl,
  stripCheckoutParams,
} from "@/lib/billing/client";

export interface UseRequireSubscriptionReturn extends UseRequireAuthReturn {
  /** True once the server has answered with the viewer's entitlement. */
  isSubscriptionLoaded: boolean;
  /** Client-side view of entitlement. The API remains the authority. */
  isEntitled: boolean;
}

/**
 * Like `useRequireAuth`, but also requires an active Player plan (plan §3.2,
 * 1B·F4d; AC #4).
 *
 * Signed-out visitors are sent to sign-in by `useRequireAuth`. Signed-in
 * visitors without a plan are sent to `/pricing?reason=required` with the
 * current URL as `redirect_url`, but only on a successful negative answer: the
 * store's subscription is never persisted (store version 2) and a failed read
 * never writes one, so a non-null value is always something the server said in
 * this tab (GET /api/me through UserSync, or a billing refresh). While nothing
 * has been answered, or GET /api/me keeps failing, `isReady` stays false and the
 * page keeps its loading state; nobody is redirected on an error.
 *
 * When the page is a checkout return (`?checkout=success`) the plan may still be
 * activating: a negative answer hands the visitor to `/checkout/activating`
 * (phase-04 plan 4.9), which confirms the activation (socket + poll + Dodo
 * self-heal) and then comes back here. This hook no longer polls.
 */

/** `/checkout/activating` for a gated page's checkout return: the Dodo parameters kept, the page as redirect_url. */
export function activationHandOff(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of CHECKOUT_RETURN_PARAMS) {
    const value = params.get(key);
    if (value !== null) out.set(key, value);
  }
  out.set("redirect_url", stripCheckoutParams(`${pathname}${search ? `?${search}` : ""}`));
  return `/checkout/activating?${out.toString()}`;
}
export function useRequireSubscription(): UseRequireSubscriptionReturn {
  const auth = useRequireAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const user = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const redirectedRef = useRef(false);

  const isSubscriptionLoaded = subscription !== null;
  const isEntitled = isSubscriptionLoaded && isEntitledClient(subscription, user?.role);
  const checkoutSuccess = searchParams.get("checkout") === "success";

  // Not entitled: a checkout return goes to the activation page (it confirms and comes back); anything else to pricing.
  useEffect(() => {
    if (!auth.isReady || !isSubscriptionLoaded || isEntitled) return;
    if (redirectedRef.current) return;

    redirectedRef.current = true;
    const search = searchParams.toString();
    if (checkoutSuccess) {
      router.replace(activationHandOff(pathname, search));
      return;
    }
    // Checkout-return parameters must not ride along into the paywall's
    // redirect_url, or /pricing would show its activation state for a
    // return that already failed to activate.
    const returnPath = stripCheckoutParams(`${pathname}${search ? `?${search}` : ""}`);
    router.replace(paywallUrl(returnPath));
  }, [auth.isReady, isSubscriptionLoaded, isEntitled, checkoutSuccess, router, pathname, searchParams]);

  return {
    ...auth,
    isReady: auth.isReady && isEntitled,
    isSubscriptionLoaded,
    isEntitled,
  };
}
