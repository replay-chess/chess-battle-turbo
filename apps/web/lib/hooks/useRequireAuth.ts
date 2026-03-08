"use client";

import { useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { CompleteUserObject } from "../types/user";
import { useUserStore } from "@/lib/stores";

export interface UseRequireAuthReturn {
  isLoaded: boolean;
  isReady: boolean;
  isSignedIn: boolean | undefined;
  clerkUser: ReturnType<typeof useUser>["user"];
  userId: string | null | undefined;
  userObject: CompleteUserObject | null;
  isLoadingUserData: boolean;
  refetchUserData: () => Promise<void>;
}

export function useRequireAuth(): UseRequireAuthReturn {
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: userLoaded, isSignedIn, user } = useUser();
  const email = user?.emailAddresses[0]?.emailAddress;
  const router = useRouter();
  const pathname = usePathname();

  // Read from Zustand store
  const storeUser = useUserStore((s) => s.user);
  const isHydrated = useUserStore((s) => s.isHydrated);
  const isSyncing = useUserStore((s) => s.isSyncing);

  const fallbackTriggered = useRef(false);

  const isLoaded = authLoaded && userLoaded;

  // Build CompleteUserObject from store data
  const userObject: CompleteUserObject | null = storeUser
    ? {
        user: {
          referenceId: storeUser.referenceId,
          code: storeUser.code,
          name: storeUser.name,
          email: storeUser.email,
          profilePictureUrl: storeUser.profilePictureUrl,
          dateOfBirth: null,
          isActive: true,
          createdAt: "",
        },
        stats: storeUser.stats
          ? {
              referenceId: storeUser.stats.referenceId,
              totalGamesPlayed: storeUser.stats.totalGamesPlayed,
              gamesWon: storeUser.stats.gamesWon,
              gamesLost: storeUser.stats.gamesLost,
              gamesDrawn: storeUser.stats.gamesDrawn,
              winRate: storeUser.stats.totalGamesPlayed > 0
                ? ((storeUser.stats.gamesWon / storeUser.stats.totalGamesPlayed) * 100).toFixed(1)
                : "0.0",
              currentWinStreak: storeUser.stats.currentWinStreak,
              longestWinStreak: storeUser.stats.longestWinStreak,
              averageGameDuration: storeUser.stats.averageGameDuration,
              lastPlayedAt: storeUser.stats.lastPlayedAt,
            }
          : null,
      }
    : null;

  const isReady = isLoaded && isHydrated && userObject !== null;

  // Refetch: update the store by fetching user by email
  const refetchUserData = async (): Promise<void> => {
    if (!email) return;
    await useUserStore.getState().fetchUserByEmail(email);
  };

  useEffect(() => {
    if (!isLoaded) return;

    // Redirect if not signed in
    if (!isSignedIn || !userId || !email) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }

    // Fallback: if store is empty after hydration and UserSync hasn't populated it yet,
    // trigger a fetch. This covers the edge case where the user navigates directly to
    // a protected page before UserSync completes.
    if (isHydrated && !storeUser && !isSyncing && !fallbackTriggered.current) {
      fallbackTriggered.current = true;
      useUserStore.getState().fetchUserByEmail(email);
    }
  }, [isLoaded, isSignedIn, userId, email, router, pathname, isHydrated, storeUser, isSyncing]);

  return {
    isLoaded,
    isReady,
    isSignedIn,
    clerkUser: user,
    userId,
    userObject,
    isLoadingUserData: isSyncing,
    refetchUserData,
  };
}
