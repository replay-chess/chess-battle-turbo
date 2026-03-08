"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { logger } from "@/lib/logger";
import { trackApiResponseTime } from "@/lib/metrics";
import { useUserStore } from "@/lib/stores";

/**
 * UserSync Component
 *
 * Automatically syncs the authenticated user's data from Clerk to our database.
 * Populates the Zustand user store with user data + subscription.
 * Redirects new users (onboarded === false) to the onboarding page.
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
          pathname !== "/onboarding"
        ) {
          router.push("/onboarding");
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
