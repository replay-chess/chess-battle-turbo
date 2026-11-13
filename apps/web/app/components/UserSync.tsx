"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { hashKey } from "@tanstack/react-query";
import type { MeData } from "@repo/contracts/http/me";
import { meQuery } from "@/lib/api/queries/me";
import { getQueryClient } from "@/lib/api/query-client";
import { logger } from "@/lib/logger";
import { trackApiResponseTime } from "@/lib/metrics";
import { useUserStore } from "@/lib/stores";
import { isPlanKey } from "@/lib/billing/plans";
import { isOnboardingExemptPathname } from "@/lib/onboarding/exempt-paths";

/**
 * Pages a not-yet-onboarded user may keep reading. Marketing, legal and the
 * free "try" experience never bounce to onboarding; /pricing is already part
 * of the flow; /sign-in is Clerk's territory. Plus the onboarding rule's own
 * list (phase-04 §8.1: /onboarding, the checkout return, the settings pages).
 */
const LEGACY_EXEMPT_PREFIXES: readonly string[] = [
  "/blog",
  "/learn",
  "/about",
  "/help",
  "/contact",
  "/terms",
  "/privacy",
  "/cookies",
  "/pricing",
  "/sign-in",
];

function isOnboardingExemptPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (isOnboardingExemptPathname(pathname)) return true;
  return LEGACY_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Where to send a new user. A `plan` query param on the current URL (for
 * example a marketing link to /?plan=yearly) is carried over so onboarding
 * preselects that billing interval.
 */
function onboardingHref(): string {
  if (typeof window === "undefined") return "/onboarding";
  const plan = new URLSearchParams(window.location.search).get("plan");
  return isPlanKey(plan) ? `/onboarding?plan=${plan}` : "/onboarding";
}

const ME_HASH = hashKey(meQuery.queryKey);

/**
 * UserSync (plan §5.2, 1B·F4d)
 *
 * Fills the legacy Zustand store (user + subscription mirror) from the viewer,
 * `qk.me()`:
 * - when the cache is seeded (the (app) layout after 1B·J), it makes no request;
 * - otherwise exactly one GET /api/me per page load (it also provisions a
 *   first-time user).
 * Later changes to `qk.me()` (focus refetch, a billing refresh, a re-seed) are
 * mirrored into the store. A failed read keeps whatever the store had and is
 * retried on the next focus, reconnect or navigation; it never redirects.
 * New users (onboarded === false) are sent to onboarding unless the page is
 * exempt.
 */
export const UserSync = () => {
  const { isSignedIn, user, isLoaded } = useUser();
  const router = useRouter();
  // A navigation re-runs the sync effect, which retries a failed read (a synced viewer returns early).
  const pathname = usePathname();
  const clerkUserId = user?.id;
  const syncedFor = useRef<string | null>(null);
  const inFlight = useRef(false);
  const prevSignedIn = useRef<boolean | undefined>(undefined);
  const prevUserId = useRef<string | undefined>(undefined);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const clearStore = useUserStore((s) => s.clearStore);
  const loadViewer = useUserStore((s) => s.loadViewer);
  const applyMe = useUserStore((s) => s.applyMe);

  // Sign-out and account-switch detection: drop the old viewer from the store and the query cache.
  useEffect(() => {
    if (!isLoaded) return;

    const signedOut = prevSignedIn.current === true && !isSignedIn;
    const switched = Boolean(clerkUserId && prevUserId.current && prevUserId.current !== clerkUserId);
    // A persisted user from another Clerk account (signed out in another tab, then someone else signed in).
    const stored = useUserStore.getState().user;
    const foreign = Boolean(clerkUserId && stored && stored.clerkUserId !== clerkUserId);

    if (signedOut || switched || foreign) {
      clearStore();
      getQueryClient().removeQueries({ queryKey: meQuery.queryKey, exact: true });
      syncedFor.current = null;
    }

    prevSignedIn.current = isSignedIn;
    prevUserId.current = clerkUserId;
  }, [isLoaded, isSignedIn, clerkUserId, clearStore]);

  // Mirror later qk.me() updates (focus refetch, setMeEntitlement, HydrationBoundary re-seed) into the store.
  useEffect(() => {
    if (!isSignedIn || !clerkUserId) return;
    return getQueryClient()
      .getQueryCache()
      .subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "success") return;
        if (event.query.queryHash !== ME_HASH) return;
        const me = event.query.state.data as MeData | undefined;
        if (me) applyMe(me, clerkUserId);
      });
  }, [isSignedIn, clerkUserId, applyMe]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clerkUserId) return;
    if (syncedFor.current === clerkUserId || inFlight.current) return;

    inFlight.current = true;
    const start = Date.now();
    void loadViewer(clerkUserId).then((me) => {
      inFlight.current = false;
      trackApiResponseTime("me.get", Date.now() - start);
      if (!me) {
        logger.warn("Viewer read failed; keeping the stored user");
        setFailedAt(Date.now());
        return;
      }
      syncedFor.current = clerkUserId;
      setFailedAt(null);

      // Redirect new users to onboarding if they haven't completed it.
      const current = typeof window === "undefined" ? null : window.location.pathname;
      if (!me.user.onboarded && !isOnboardingExemptPath(current)) {
        router.push(onboardingHref());
      }
    });
  }, [isLoaded, isSignedIn, clerkUserId, loadViewer, router, pathname, retryTick]);

  // After a failure, try again when the tab regains focus or the network comes back.
  useEffect(() => {
    if (failedAt === null) return;
    const retry = () => setRetryTick((n) => n + 1);
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
    };
  }, [failedAt]);

  return null;
};
