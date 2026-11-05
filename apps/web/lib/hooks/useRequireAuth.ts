"use client";

import { useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { CompleteUserObject } from "../types/user";
import { useUserStore } from "@/lib/stores";
import { hasSignOutIntent } from "@/components/system/session-guard";

export interface UseRequireAuthReturn {
  isLoaded: boolean;
  isReady: boolean;
  isSignedIn: boolean | undefined;
  clerkUser: ReturnType<typeof useUser>["user"];
  userId: string | null | undefined;
  userObject: CompleteUserObject | null;
  isLoadingUserData: boolean;
  /** Re-reads the viewer from the server (GET /api/me) into the store. */
  refetchUserData: () => Promise<void>;
}

/**
 * Requires a signed-in user (plan §3.2, 1B·F4d; AC #5).
 *
 * The only redirect is to /sign-in, and only when Clerk itself says the visitor
 * is signed out. The user record comes from the store, which UserSync fills from
 * the viewer (`qk.me()`); the hook makes no request of its own. While the store
 * has no user for this Clerk account (first load, or GET /api/me failing),
 * `isReady` stays false and the page keeps its loading state.
 */
export function useRequireAuth(): UseRequireAuthReturn {
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: userLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const redirectedRef = useRef(false);
  const wasSignedInRef = useRef(false);

  const storeUser = useUserStore((s) => s.user);
  const isSyncing = useUserStore((s) => s.isSyncing);

  const isLoaded = authLoaded && userLoaded;

  // A persisted user that belongs to another Clerk account is not this visitor.
  const ownUser = storeUser && userId && storeUser.clerkUserId === userId ? storeUser : null;

  const userObject: CompleteUserObject | null = ownUser
    ? {
        user: {
          referenceId: ownUser.referenceId,
          code: ownUser.code,
          name: ownUser.name,
          email: ownUser.email,
          profilePictureUrl: ownUser.profilePictureUrl,
          dateOfBirth: null,
          isActive: true,
          createdAt: "",
        },
        stats: ownUser.stats
          ? {
              referenceId: ownUser.stats.referenceId,
              totalGamesPlayed: ownUser.stats.totalGamesPlayed,
              gamesWon: ownUser.stats.gamesWon,
              gamesLost: ownUser.stats.gamesLost,
              gamesDrawn: ownUser.stats.gamesDrawn,
              winRate: ownUser.stats.totalGamesPlayed > 0
                ? ((ownUser.stats.gamesWon / ownUser.stats.totalGamesPlayed) * 100).toFixed(1)
                : "0.0",
              currentWinStreak: ownUser.stats.currentWinStreak,
              longestWinStreak: ownUser.stats.longestWinStreak,
              averageGameDuration: ownUser.stats.averageGameDuration,
              lastPlayedAt: ownUser.stats.lastPlayedAt,
            }
          : null,
      }
    : null;

  const signedIn = isLoaded && Boolean(isSignedIn && userId);
  const isReady = signedIn && userObject !== null;

  const refetchUserData = async (): Promise<void> => {
    if (!userId) return;
    await useUserStore.getState().loadViewer(userId, { force: true });
  };

  useEffect(() => {
    if (!isLoaded) return;
    // Only Clerk's own "signed out" sends the visitor to sign-in; a failed data read never does.
    if (isSignedIn && userId) {
      wasSignedInRef.current = true;
      return;
    }
    // Signed in on this page, then the session ended without our sign-out (revoked, expired): SessionWatcher shows
    // "You’ve Been Signed Out" over the page and its "Sign In Again" returns here (plan §4.9, sign-off D8).
    if (wasSignedInRef.current && !hasSignOutIntent()) return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
  }, [isLoaded, isSignedIn, userId, router, pathname]);

  return {
    isLoaded,
    isReady,
    isSignedIn,
    clerkUser: user,
    userId,
    userObject,
    isLoadingUserData: isSyncing || (signedIn && userObject === null),
    refetchUserData,
  };
}
