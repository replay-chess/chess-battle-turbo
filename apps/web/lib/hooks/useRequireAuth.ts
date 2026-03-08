"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { CompleteUserObject } from "../types/user";
import { useUserStore } from "@/lib/stores";
import { trackApiResponseTime } from "@/lib/metrics";
import { logger } from "@/lib/logger";

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

  // Read from Zustand store (used when already populated by UserSync)
  const storeUser = useUserStore((s) => s.user);
  const isSyncing = useUserStore((s) => s.isSyncing);

  // Local state as direct fallback — ensures this hook is self-sufficient
  const [localUser, setLocalUser] = useState<CompleteUserObject | null>(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const fetchedEmailRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  const isLoaded = authLoaded && userLoaded;

  // Build CompleteUserObject from store data
  const storeUserObject: CompleteUserObject | null = storeUser
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

  // Prefer store data, fall back to locally fetched data
  const userObject = storeUserObject ?? localUser;

  const isReady = isLoaded && userObject !== null;

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

    // If store already has user data, nothing to do
    if (storeUser) return;

    // Already fetched for this email
    if (fetchedEmailRef.current === email) return;

    // Already fetching
    if (isFetchingRef.current) return;

    // Direct fetch as fallback — doesn't depend on Zustand hydration
    isFetchingRef.current = true;
    setIsLoadingLocal(true);

    const start = Date.now();
    fetch(`/api/user/email/${encodeURIComponent(email)}`)
      .then((response) => {
        trackApiResponseTime("user.fetchByEmail", Date.now() - start);
        if (!response.ok) {
          router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (data?.success && data?.data) {
          setLocalUser(data.data);
          fetchedEmailRef.current = email;
        } else if (data !== null) {
          router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
        }
      })
      .catch((error) => {
        logger.error("Error fetching user data:", error);
        router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
      })
      .finally(() => {
        isFetchingRef.current = false;
        setIsLoadingLocal(false);
      });
  }, [isLoaded, isSignedIn, userId, email, router, pathname, storeUser]);

  return {
    isLoaded,
    isReady,
    isSignedIn,
    clerkUser: user,
    userId,
    userObject,
    isLoadingUserData: isSyncing || isLoadingLocal,
    refetchUserData,
  };
}
