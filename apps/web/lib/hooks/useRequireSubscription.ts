"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth, UseRequireAuthReturn } from "./useRequireAuth";
import { useUserStore } from "@/lib/stores";
import {
  isEntitledClient,
  paywallUrl,
  stripCheckoutParams,
  waitForEntitlement,
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
 * activating, so a negative answer first polls POST /api/billing/refresh on the
 * activation schedule before it is treated as final.
 */
export function useRequireSubscription(): UseRequireSubscriptionReturn {
  const auth = useRequireAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const user = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);

  const [activationDone, setActivationDone] = useState(false);
  const activationStartedRef = useRef(false);
  const redirectedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isSubscriptionLoaded = subscription !== null;
  const isEntitled = isSubscriptionLoaded && isEntitledClient(subscription, user?.role);
  const checkoutSuccess = searchParams.get("checkout") === "success";

  // Checkout return: poll the billing refresh until the plan shows up or the attempts run out.
  useEffect(() => {
    if (!checkoutSuccess || !auth.isReady || !isSubscriptionLoaded || isEntitled) return;
    if (activationStartedRef.current) return;
    activationStartedRef.current = true;
    const entitledNow = () => {
      const state = useUserStore.getState();
      return isEntitledClient(state.subscription, state.user?.role);
    };
    waitForEntitlement({
      refresh: fetchSubscription,
      isEntitled: entitledNow,
      isCancelled: () => !mountedRef.current,
    })
      .catch(() => false)
      .finally(() => {
        if (mountedRef.current) setActivationDone(true);
      });
  }, [checkoutSuccess, auth.isReady, isSubscriptionLoaded, isEntitled, fetchSubscription]);

  // Redirect to pricing once the server has said no (after the activation poll on a checkout return).
  useEffect(() => {
    if (!auth.isReady || !isSubscriptionLoaded || isEntitled) return;
    if (checkoutSuccess && !activationDone) return;
    if (redirectedRef.current) return;

    redirectedRef.current = true;
    const search = searchParams.toString();
    // Checkout-return parameters must not ride along into the paywall's
    // redirect_url, or /pricing would show its activation state for a
    // return that already failed to activate.
    const returnPath = stripCheckoutParams(`${pathname}${search ? `?${search}` : ""}`);
    router.replace(paywallUrl(returnPath));
  }, [auth.isReady, isSubscriptionLoaded, isEntitled, checkoutSuccess, activationDone, router, pathname, searchParams]);

  return {
    ...auth,
    isReady: auth.isReady && isEntitled,
    isSubscriptionLoaded,
    isEntitled,
  };
}
