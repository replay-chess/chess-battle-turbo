"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth, UseRequireAuthReturn } from "./useRequireAuth";
import { useUserStore } from "@/lib/stores";
import { isEntitledClient, paywallUrl } from "@/lib/billing/client";

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

  // Refresh the subscription once per mount when the store has nothing, or
  // when what it has would deny access (it may be stale).
  useEffect(() => {
    if (!user) return;
    if (refreshRequestedRef.current) return;
    if (entitledFromStore && subscription !== null) return;

    refreshRequestedRef.current = true;
    fetchSubscription().finally(() => {
      if (mountedRef.current) setVerified(true);
    });
  }, [user, subscription, entitledFromStore, fetchSubscription]);

  // Redirect to pricing once auth is ready and the (verified) answer is no.
  useEffect(() => {
    if (!auth.isReady || !isSubscriptionLoaded || isEntitled) return;
    if (!verified || redirectedRef.current) return;

    redirectedRef.current = true;
    const search = searchParams.toString();
    router.replace(paywallUrl(`${pathname}${search ? `?${search}` : ""}`));
  }, [auth.isReady, isSubscriptionLoaded, isEntitled, verified, router, pathname, searchParams]);

  return {
    ...auth,
    isReady: auth.isReady && isSubscriptionLoaded && isEntitled,
    isSubscriptionLoaded,
    isEntitled,
  };
}
