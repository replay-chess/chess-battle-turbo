"use client";

// SessionWatcher (plan §4.9, §8.6): mounted once per tab inside <Providers> (the `sessionWatcher` slot,
// app/providers.tsx). It opens the "You’ve Been Signed Out" modal on:
//   (a) a 401 from api() that a Clerk session reload + one retry does not fix (registers `sessionGuard` with
//       reactToApiError through setApiErrorDeps);
//   (b) Clerk `isSignedIn` true → false on a non-public route without the local sign-out intent, debounced 1.5 s;
//   (c) the tab becoming visible on a non-public route while signed out (after having been signed in);
//   (d) an `rc-auth` `session_expired` message from another tab.
// It closes the modal when Clerk signs in again (here or in another tab: `signed_in`), and runs the local
// sign-out steps then goes to "/" when another tab broadcasts `signed_out`.
import { useEffect, useRef } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { setApiErrorDeps } from "@/lib/api/errors";
import { clearLocalSession } from "@/lib/auth/sign-out";
import { SessionExpiredModal } from "./SessionExpiredModal";
import { isPublicByRouteClass } from "./public-paths";
import {
  FLIP_DEBOUNCE_MS,
  createSessionGuard,
  hasSignOutIntent,
  isSessionPublicPath,
  openSessionExpired,
  postAuthMessage,
  sessionExpiredStore,
  setPublicPathClassifier,
  setSignOutIntent,
  subscribeAuthMessages,
  type ClerkSessionLike,
} from "./session-guard";

const onPublicPath = () => typeof window !== "undefined" && isSessionPublicPath(window.location.pathname);

export function SessionWatcher() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const queryClient = useQueryClient();

  const clerkRef = useRef<ClerkSessionLike | null>(null);
  const signedInRef = useRef<boolean | undefined>(undefined);
  const wasSignedIn = useRef(false);
  const guardRef = useRef<ReturnType<typeof createSessionGuard> | null>(null);

  useEffect(() => {
    clerkRef.current = clerk as unknown as ClerkSessionLike;
  }, [clerk]);

  // Public pages come from the middleware's route classes (1B·J), not the interim list in session-guard.ts.
  useEffect(() => setPublicPathClassifier(isPublicByRouteClass), []);

  // (a) The 401 guard for reactToApiError.
  useEffect(() => {
    const guard = createSessionGuard({
      getClerk: () => clerkRef.current,
      isOpen: () => sessionExpiredStore.get().open,
      open: (source) => {
        if (!onPublicPath()) openSessionExpired(source);
      },
    });
    guardRef.current = guard;
    const undo = setApiErrorDeps({
      sessionGuard: {
        onUnauthorized: (ctx) => guard.onUnauthorized({ ...ctx, queryClient: ctx.queryClient ?? queryClient }),
      },
    });
    return () => {
      undo();
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, [queryClient]);

  // (b) Clerk flips, and sign-in closing the modal.
  useEffect(() => {
    if (!isLoaded) return;
    const before = signedInRef.current;
    signedInRef.current = Boolean(isSignedIn);

    if (isSignedIn) {
      wasSignedIn.current = true;
      setSignOutIntent(false);
      guardRef.current?.reset();
      if (before === false) {
        sessionExpiredStore.close();
        postAuthMessage("signed_in");
      }
      return;
    }
    if (before !== true || hasSignOutIntent()) return;
    const timer = setTimeout(() => {
      if (hasSignOutIntent() || onPublicPath()) return;
      openSessionExpired("clerk");
    }, FLIP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn]);

  // (c) Back to a visible tab while signed out.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!wasSignedIn.current || signedInRef.current !== false) return;
      if (hasSignOutIntent() || onPublicPath()) return;
      openSessionExpired("visibility");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // (d) Other tabs.
  useEffect(
    () =>
      subscribeAuthMessages((msg) => {
        if (msg.type === "session_expired") {
          if (!hasSignOutIntent() && !onPublicPath()) openSessionExpired("broadcast");
        } else if (msg.type === "signed_in") {
          sessionExpiredStore.close();
        } else {
          setSignOutIntent(true);
          void clearLocalSession(queryClient).finally(() => window.location.assign("/"));
        }
      }),
    [queryClient],
  );

  return <SessionExpiredModal clerk={clerk} queryClient={queryClient} />;
}

export default SessionWatcher;
