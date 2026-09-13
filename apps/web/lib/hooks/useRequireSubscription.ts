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
  /** True once the subscription summary has been loaded into the store. */
  isSubscriptionLoaded: boolean;
  /** Client-side view of entitlement. The API remains the authority. */
  isEntitled: boolean;
}

/**
 * Like `useRequireAuth`, but also requires an active Player plan.
 *
 * Signed-out visitors are sent to sign-in by `useRequireAuth`. Signed-in
 * visitors without a plan are sent to `/pricing?reason=required` with the
 * current URL as `redirect_url`. `isReady` stays false until the gate has
 * resolved in the visitor's favour, so a page's existing loading screen keeps
 * showing and gated content never flashes.
 *
 * The store's subscription is persisted in localStorage and can be stale, so
 * a negative answer is re-checked against the server once per mount before
 * anyone is redirected. A positive answer is trusted immediately; the API
 * still enforces the paywall on every game-starting request.
 *
 * The refresh is driven by `useRequireAuth` readiness rather than the
 * persisted store user: GET /api/subscription authenticates with the Clerk
 * cookie, and the auth hook has its own fallback when UserSync never filled
 * the store, so the gate must not wait on the store either.
 *
 * When the page is a checkout return (`?checkout=success`) the plan may still
 * be activating, so the re-check polls on the activation schedule before a
 * negative answer is treated as final.
 */
export function useRequireSubscription(): UseRequireSubscriptionReturn {
  const auth = useRequireAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const user = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);

  // "verified" means the negative case has been re-checked with the server.
  const [verified, setVerified] = useState(false);
  const refreshRequestedRef = useRef(false);
  const redirectedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const entitledFromStore = isEntitledClient(subscription, user?.role);
  const isSubscriptionLoaded = subscription !== null;
  const isEntitled = isSubscriptionLoaded && entitledFromStore;
  const checkoutSuccess = searchParams.get("checkout") === "success";

  // Refresh the subscription once per mount when the store has nothing, or
  // when what it has would deny access (it may be stale).
  useEffect(() => {
    if (!auth.isReady) return;
    if (refreshRequestedRef.current) return;
    if (entitledFromStore && subscription !== null) return;

    refreshRequestedRef.current = true;
    const entitledNow = () => {
      const state = useUserStore.getState();
      return isEntitledClient(state.subscription, state.user?.role);
    };
    const check = checkoutSuccess
      ? waitForEntitlement({
          refresh: fetchSubscription,
          isEntitled: entitledNow,
          isCancelled: () => !mountedRef.current,
        })
      : fetchSubscription();
    check
      .finally(() => {
        if (mountedRef.current) setVerified(true);
      })
      .catch(() => {
        // The store already recorded a negative answer; nothing else to do.
      });
  }, [auth.isReady, checkoutSuccess, subscription, entitledFromStore, fetchSubscription]);

  // Redirect to pricing once auth is ready and the (verified) answer is no.
  useEffect(() => {
    if (!auth.isReady || !isSubscriptionLoaded || isEntitled) return;
    if (!verified || redirectedRef.current) return;

    redirectedRef.current = true;
    const search = searchParams.toString();
    // Checkout-return parameters must not ride along into the paywall's
    // redirect_url, or /pricing would show its activation state for a
    // return that already failed to activate.
    const returnPath = stripCheckoutParams(`${pathname}${search ? `?${search}` : ""}`);
    router.replace(paywallUrl(returnPath));
  }, [auth.isReady, isSubscriptionLoaded, isEntitled, verified, router, pathname, searchParams]);

  return {
    ...auth,
    isReady: auth.isReady && isSubscriptionLoaded && isEntitled,
    isSubscriptionLoaded,
    isEntitled,
  };
}
