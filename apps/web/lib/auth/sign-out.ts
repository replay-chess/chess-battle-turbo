// signOutEverywhere() (plan §8.6, CDL §6.6, CA AP-04): the one sign-out for shared devices.
//
// Order (the P1 subset of CDL §6.6; the outbox flush lands before step 5 in P5):
//   1. sessionStorage["rc.signout"] = "1"  (SessionWatcher must not call this an expiry)
//   2. queryClient.cancelQueries(); queryClient.clear()
//   3. useUserStore.getState().clearStore()
//   4. purgeRuntimeCaches()  (service-worker runtime caches)
//   5. POST /api/session/clear, keepalive, 1.5 s budget, errors ignored → 204 + Clear-Site-Data: "cache"
//      (never "storage": it would wipe the P5 outbox)
//   6. posthog.reset(); Sentry.setUser(null)
//   7. BroadcastChannel("rc-auth") { type: "signed_out" }  (other tabs run clearLocalSession and go to "/")
//   8. await clerk.signOut(() => location.assign(redirectUrl), { redirectUrl })  (a full load, T22)
//
// Every step is guarded: a failure in one never stops the next, and Clerk's sign-out always runs.
// Dependencies are injectable (sign-out.test.ts); the defaults load PostHog, Sentry and the store lazily.
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { purgeRuntimeCaches } from "@/lib/shell/pwa";
import { postAuthMessage, setSignOutIntent } from "@/components/system/session-guard";

/** `/api/session/clear` budget (plan §8.9). */
export const SESSION_CLEAR_TIMEOUT_MS = 1500;

/** Clerk's `signOut(callback, options)` form: the callback replaces Clerk's own (client-router) navigation. */
export type SignOutClerk = {
  signOut: (callback: () => void, options: { redirectUrl: string }) => Promise<unknown>;
};

export type SignOutDeps = {
  setIntent: () => void;
  clearUserStore: () => Promise<void> | void;
  purgeCaches: () => Promise<void>;
  clearServerCache: () => Promise<void>;
  resetAnalytics: () => Promise<void> | void;
  resetSentryUser: () => Promise<void> | void;
  broadcast: () => void;
  /** The navigation after Clerk's sign-out: a full document load (see signOutEverywhere). */
  navigate: (url: string) => void;
};

const defaultDeps: SignOutDeps = {
  setIntent: () => setSignOutIntent(true),
  clearUserStore: async () => {
    const { useUserStore } = await import("@/lib/stores/useUserStore");
    useUserStore.getState().clearStore();
  },
  purgeCaches: purgeRuntimeCaches,
  clearServerCache: async () => {
    await api(endpoints.sessionClear, { method: "POST", keepalive: true, timeoutMs: SESSION_CLEAR_TIMEOUT_MS });
  },
  resetAnalytics: async () => {
    const { default: posthog } = await import("posthog-js");
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) posthog.reset();
  },
  resetSentryUser: async () => {
    const Sentry = await import("@sentry/nextjs");
    Sentry.setUser(null);
  },
  broadcast: () => postAuthMessage("signed_out"),
  navigate: (url) => window.location.assign(url),
};

async function attempt(step: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await step();
  } catch {
    // Each step is best effort; sign-out goes on.
  }
}

function clearQueries(queryClient: QueryClient | undefined): void {
  if (!queryClient) return;
  void queryClient.cancelQueries();
  queryClient.clear();
}

/**
 * The local half of sign-out: what another tab runs when it hears `signed_out`, before `location.assign("/")`.
 * Steps 2, 3, 4 and 6; no intent flag, no server call, no broadcast.
 */
export async function clearLocalSession(
  queryClient: QueryClient | undefined,
  deps: Partial<SignOutDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  await attempt(() => clearQueries(queryClient));
  await attempt(d.clearUserStore);
  await attempt(d.purgeCaches);
  await attempt(d.resetAnalytics);
  await attempt(d.resetSentryUser);
}

/**
 * A sign-out that did not go through signOutEverywhere() (Clerk's own UserButton "Sign out" in the marketing
 * Navbar, a session revoked elsewhere that ended on a public page): the local steps plus POST /api/session/clear,
 * so the browser HTTP cache is emptied too. No intent flag, no broadcast (Clerk syncs its other tabs itself), and no
 * Clerk call: the session is already gone.
 */
export async function clearAfterExternalSignOut(
  queryClient: QueryClient | undefined,
  deps: Partial<SignOutDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  await clearLocalSession(queryClient, deps);
  await attempt(d.clearServerCache);
}

export type SignOutOptions = {
  queryClient?: QueryClient;
  /** Where Clerk sends the browser afterwards. Default "/". */
  redirectUrl?: string;
  deps?: Partial<SignOutDeps>;
};

/** The one sign-out (account menu, "Use a Different Account", account deletion later). */
export async function signOutEverywhere(clerk: SignOutClerk, options: SignOutOptions = {}): Promise<void> {
  const d = { ...defaultDeps, ...options.deps };
  await attempt(d.setIntent);
  await attempt(() => clearQueries(options.queryClient));
  await attempt(d.clearUserStore);
  await attempt(d.purgeCaches);
  await attempt(d.clearServerCache);
  await attempt(d.resetAnalytics);
  await attempt(d.resetSentryUser);
  await attempt(d.broadcast);
  // A full document load, not Clerk's client-router push: it drops the Next router's in-memory tree, so Back to a
  // member URL loads that document again (private, no-store, never from bfcache) and the middleware sends it to
  // sign-in (T22, sign-off D7). With a soft push, Back re-rendered the member URL from the router's memory.
  const redirectUrl = options.redirectUrl ?? "/";
  await clerk.signOut(() => d.navigate(redirectUrl), { redirectUrl });
}
