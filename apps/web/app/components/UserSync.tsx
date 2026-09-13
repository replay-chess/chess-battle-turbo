"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { logger } from "@/lib/logger";
import { trackApiResponseTime } from "@/lib/metrics";
import { useUserStore } from "@/lib/stores";
import { isPlanKey } from "@/lib/billing/plans";

/**
 * Pages a not-yet-onboarded user may keep reading. Marketing, legal and the
 * free "try" experience never bounce to onboarding; /pricing and /onboarding
 * are already part of the flow; /sign-in is Clerk's territory.
 */
const ONBOARDING_EXEMPT_PREFIXES: readonly string[] = [
  "/try",
  "/blog",
  "/learn",
  "/about",
  "/help",
  "/contact",
  "/terms",
  "/privacy",
  "/cookies",
  "/pricing",
  "/onboarding",
  "/sign-in",
];

function isOnboardingExemptPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return ONBOARDING_EXEMPT_PREFIXES.some(
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

/**
 * UserSync Component
 *
 * Automatically syncs the authenticated user's data from Clerk to our database.
 * Populates the Zustand user store with user data + subscription.
 * Redirects new users (onboarded === false) to the onboarding page, unless
 * they are on a page that should stay reachable without onboarding.
 * Runs once per session.
 */
export const UserSync = () => {
  const { isSignedIn, user, isLoaded } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const hasSynced = useRef(false);
  const prevSignedIn = useRef<boolean | undefined>(undefined);
  const prevUserId = useRef<string | undefined>(undefined);

  const setUser = useUserStore((s) => s.setUser);
  const clearStore = useUserStore((s) => s.clearStore);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);

  // Sign-out detection: clear store when user signs out
  useEffect(() => {
    if (!isLoaded) return;

    // Detect sign-out: was signed in, now not
    if (prevSignedIn.current === true && !isSignedIn) {
      clearStore();
      hasSynced.current = false;
    }

    // Detect user switch: different Clerk user ID
    if (
      user?.id &&
      prevUserId.current &&
      prevUserId.current !== user.id
    ) {
      clearStore();
      hasSynced.current = false;
    }

    prevSignedIn.current = isSignedIn;
    prevUserId.current = user?.id;
  }, [isLoaded, isSignedIn, user?.id, clearStore]);

  useEffect(() => {
    const syncUser = async () => {
      if (!isLoaded || !isSignedIn || !user || hasSynced.current) {
        return;
      }

      try {
        hasSynced.current = true;

        const start = Date.now();
        const response = await fetch("/api/user/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });
        trackApiResponseTime("user.sync", Date.now() - start);

        if (!response.ok) {
          const errorData = await response.json();
          logger.error("Failed to sync user:", errorData);
          hasSynced.current = false;
          return;
        }

        const data = await response.json();

        logger.debug("User synced successfully: " + data.message);

        // Populate Zustand store with synced user data
        if (data.user) {
          setUser({
            referenceId: data.user.referenceId,
            code: data.user.code,
            email: data.user.email,
            name: data.user.name,
            profilePictureUrl: data.user.profilePictureUrl,
            onboarded: data.user.onboarded ?? false,
            role: data.user.role ?? "USER",
            clerkUserId: data.user.clerkUserId ?? user.id,
            stats: data.user.stats ?? null,
            chessComProfile: data.user.chessComProfile ?? null,
          });

          // Fetch subscription data into store
          fetchSubscription();
        }

        // Redirect new users to onboarding if they haven't completed it
        if (
          data.user &&
          !data.user.onboarded &&
          !isOnboardingExemptPath(pathname)
        ) {
          router.push(onboardingHref());
        }
      } catch (error) {
        logger.error("Error syncing user:", error);
        hasSynced.current = false;
      }
    };

    syncUser();
  }, [isLoaded, isSignedIn, user, router, pathname, setUser, fetchSubscription]);

  return null;
};
