"use client";

// SessionWatcher (plan §4.9, §8.6): mounted once per tab inside <Providers> (the `sessionWatcher` slot,
// app/providers.tsx). It opens the "You’ve Been Signed Out" modal on:
//   (a) a 401 from api() that a Clerk session reload + one retry does not fix (registers `sessionGuard` with
//       reactToApiError through setApiErrorDeps);
//   (b) Clerk `isSignedIn` true → false on a non-public route without the local sign-out intent, debounced 1.5 s;
//   (c) the tab becoming visible on a non-public route while signed out (after having been signed in);
//   (d) an `rc-auth` `session_expired` message from another tab.
// A live game the viewer plays holds the modal back until it ends (session-guard `holdSessionExpired`, phase-02 plan
// 4.7); the in-game auth chip stands in for it meanwhile.
// It closes the modal when Clerk signs in again (here or in another tab: `signed_in`), and runs the local
// sign-out steps then goes to "/" when another tab broadcasts `signed_out`.
//
// Two more duties (FIX-B):
//   (e) When the session ends on its own on a non-public route (revoked, expired), Clerk's Next provider calls
//       router.refresh() from `window.__unstable__onAfterSetActive`. That RSC request hits the middleware, which
//       answers a member page with no session by redirecting to sign-in before (b)'s 1.5 s debounce, so the dialog
//       never showed (sign-off D8, T15). The watcher wraps that hook and skips the refresh in exactly that case: the
//       page stays, and (b) opens the dialog over it (plan §4.9: overlay, URL unchanged). Any other set-active
//       (sign-in, our own sign-out, a public page) still refreshes. If Clerk renames the hook, nothing breaks: the
//       old redirect behaviour comes back.
//   (f) A sign-out that skipped signOutEverywhere() (Clerk's UserButton in the marketing Navbar) that ends on a
//       public page runs clearAfterExternalSignOut(): query cache, user store, SW runtime caches, analytics reset
//       and POST /api/session/clear (Clear-Site-Data: "cache").
import { useEffect, useRef } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { setApiErrorDeps } from "@/lib/api/errors";
import { clearAfterExternalSignOut, clearLocalSession } from "@/lib/auth/sign-out";
import { SessionExpiredModal } from "./SessionExpiredModal";
import { isPublicByRouteClass } from "./public-paths";
import {
  FLIP_DEBOUNCE_MS,
  cancelDeferredSessionExpired,
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

/**
 * `useAuth()` throws "@clerk/nextjs: Invalid state" for a render in which Clerk's context holds a session id but
 * not yet the matching user (a sign-in or sign-out mid-transition; seen 2 in 5 Simulate 401 runs, handback 1Q·2
 * §5.1). The watcher sits in the root layout, so that throw became a page error. Every hook inside useAuth runs
 * before the throw, so catching it keeps the hook order; the render counts as "not loaded" and the effects below
 * wait for the next, consistent one.
 */
function useAuthState(): { isLoaded: boolean; isSignedIn: boolean | undefined } {
  try {
    // Unconditional: the try block always runs it, in the same place, every render (see above).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { isLoaded, isSignedIn } = useAuth();
    return { isLoaded, isSignedIn };
  } catch {
    return { isLoaded: false, isSignedIn: undefined };
  }
}

export function SessionWatcher() {
  const { isLoaded, isSignedIn } = useAuthState();
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
        cancelDeferredSessionExpired();
        sessionExpiredStore.close();
        postAuthMessage("signed_in");
      }
      return;
    }
    if (before !== true || hasSignOutIntent()) return;
    // (f) Signed out by something other than signOutEverywhere() while on a public page: clean up now.
    if (onPublicPath()) {
      void clearAfterExternalSignOut(queryClient);
      return;
    }
    const timer = setTimeout(() => {
      if (hasSignOutIntent()) return;
      if (onPublicPath()) {
        void clearAfterExternalSignOut(queryClient);
        return;
      }
      openSessionExpired("clerk");
    }, FLIP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn, queryClient]);

  // (e) No route refresh when the session ends on its own on a non-public route (see the header).
  useEffect(() => {
    type Hook = (...args: unknown[]) => unknown;
    const w = window as unknown as { __unstable__onAfterSetActive?: Hook };
    const original = w.__unstable__onAfterSetActive;
    if (typeof original !== "function") return;
    const wrapped: Hook = (...args) => {
      const ended = !(clerkRef.current?.session ?? null);
      if (ended && wasSignedIn.current && !hasSignOutIntent() && !onPublicPath()) return undefined;
      return original(...args);
    };
    w.__unstable__onAfterSetActive = wrapped;
    return () => {
      if (w.__unstable__onAfterSetActive === wrapped) w.__unstable__onAfterSetActive = original;
    };
  }, []);

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
          cancelDeferredSessionExpired();
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
