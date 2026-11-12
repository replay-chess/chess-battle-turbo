// Session guard (plan §4.9, §5.6, §8.6; CDL §4.4; V3SessionExpired).
//
// Non-React state and rules for the "You’ve Been Signed Out" modal:
// - `createSessionGuard()`: what a 401 from api() does. Single-flight per tab: reload the Clerk session once; when a
//   session is still there, refetch the queries that failed with 401 and call it recovered; a second 401 within
//   10 s of a recovery, or no session after the reload, opens the modal. 401s while the modal is open are ignored.
// - `sessionExpiredStore`: the modal's open state (useSyncExternalStore), shared by SessionWatcher and the modal.
// - `rc-auth` BroadcastChannel helpers: `session_expired`, `signed_out`, `signed_in` fan out to the other tabs.
// - Return-path helpers for system screens: `signInHref`, `safeReturnPath`.
// - `onBeforeSignIn()`: hosts save drafts to sessionStorage before the modal navigates to sign-in.
//
// SessionWatcher.tsx wires this to Clerk, the query client and `setApiErrorDeps({ sessionGuard })`.
import type { QueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import { trackSystem, routeTemplateOf } from "@/lib/analytics/system-events";

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

/** sessionStorage flag set by signOutEverywhere(): a local sign-out is not an expiry. */
export const SIGNOUT_INTENT_KEY = "rc.signout";
/** The cross-tab auth channel (plan §4.9 (c)). */
export const AUTH_CHANNEL = "rc-auth";
/** Clerk `isSignedIn` true → false debounce (plan §8.9). */
export const FLIP_DEBOUNCE_MS = 1500;
/** A 401 this soon after a recovery means the reload did not help: open the modal. */
export const RECOVERY_WINDOW_MS = 10_000;
/** "Use a Different Account" never returns to the old URL, which may belong to the other user. */
export const DIFFERENT_ACCOUNT_RETURN = "/play";
/** Overlay arbitration (IS §2.7): the session modal is priority 1; the palette and shortcuts close for it. */
export const OVERLAY_EVENT = "rc:overlay";

export type SessionExpiredSource = "api_401" | "clerk" | "visibility" | "broadcast";
export type SessionModalPhase = "modal" | "signing_in";

// ---------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------

/**
 * Public pages where the modal never shows (plan §4.9): marketing, /pricing, /legends*, /openings*, guest
 * /profile/*, /sign-in*, /sign-up*, and the system pages. Everything else (member, signed-in and dev routes) is
 * watched. 1B·J replaces this with `classify(pathname) === "public"` from lib/auth/route-classes (1B·F4c) through
 * `setPublicPathClassifier`.
 */
const PUBLIC_EXACT: ReadonlySet<string> = new Set([
  "/",
  "/pricing",
  "/about",
  "/blog",
  "/careers",
  "/community",
  "/contact",
  "/cookies",
  "/docs",
  "/help",
  "/learn",
  "/press",
  "/privacy",
  "/terms",
  "/too-many-requests",
]);
const PUBLIC_PREFIXES = [
  "/pricing/",
  "/legends",
  "/openings",
  "/profile/",
  "/sign-in",
  "/sign-up",
  "/blog/",
  "/docs/",
  "/learn/",
  "/help/",
];

export function defaultIsPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

let publicClassifier: (pathname: string) => boolean = defaultIsPublicPath;

/** 1B·J: `setPublicPathClassifier((p) => classify(p) === "public")`. Returns an undo. */
export function setPublicPathClassifier(fn: (pathname: string) => boolean): () => void {
  const previous = publicClassifier;
  publicClassifier = fn;
  return () => {
    if (publicClassifier === fn) publicClassifier = previous;
  };
}

export function isSessionPublicPath(pathname: string): boolean {
  return publicClassifier(pathname);
}

/** `/sign-in?redirect_url=<path+query>` (Clerk returns there after sign-in). */
export function signInHref(returnPath: string): string {
  return `/sign-in?redirect_url=${encodeURIComponent(safeReturnPath(returnPath, "/play"))}`;
}

/**
 * An app-relative path that is safe to navigate to, else `fallback`. Rejects absolute and protocol-relative URLs,
 * backslash tricks, control characters, and the 429 page itself (no loop).
 */
export function safeReturnPath(from: string | null | undefined, fallback = "/"): string {
  if (typeof from !== "string") return fallback;
  const p = from.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return fallback;
  if (p.includes("\\") || [...p].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(p, "https://replay.invalid");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "https://replay.invalid") return fallback;
  if (parsed.pathname === "/too-many-requests") return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** The current path and query, for "Returns to …" and the sign-in return. */
export function currentPathWithQuery(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Modal state (one per tab)
// ---------------------------------------------------------------------------------------------------------------

export type SessionExpiredState = {
  open: boolean;
  phase: SessionModalPhase;
  /** Why it opened; "demo" for `/dev/ui/data?state=session_expired` (not tracked). */
  source: SessionExpiredSource | "demo" | null;
  /** Path + query captured when it opened ("Returns to …"). */
  returnPath: string;
};

const CLOSED: SessionExpiredState = { open: false, phase: "modal", source: null, returnPath: "/" };

function createStore() {
  let state: SessionExpiredState = CLOSED;
  const listeners = new Set<() => void>();
  const set = (next: SessionExpiredState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    get: (): SessionExpiredState => state,
    getServer: (): SessionExpiredState => CLOSED,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open(source: SessionExpiredState["source"], returnPath: string): boolean {
      if (state.open) return false;
      set({ open: true, phase: "modal", source, returnPath });
      return true;
    },
    setPhase(phase: SessionModalPhase): void {
      if (state.open) set({ ...state, phase });
    },
    close(): void {
      if (state.open) set(CLOSED);
    },
  };
}

export const sessionExpiredStore = createStore();

// ---------------------------------------------------------------------------------------------------------------
// Deferral during a live game (phase-02 plan 4.7 "Socket token 401", 5.5.1 "401 unauthorized": "In a live game the
// modal is deferred until game:ended"). The game screen holds the modal while the viewer plays a live game: its
// in-game chip (V3SessionExpired `in_game_refresh` / `in_game_ok`) stands in for it, the board stays usable, and a
// sign-in in another tab recovers the socket. The first request to open is kept and shown once the last hold goes
// (the game ended or the screen closed), unless a sign-in cancelled it or the page is public by then.
// ---------------------------------------------------------------------------------------------------------------

let modalHolds = 0;
let deferredSource: SessionExpiredSource | null = null;

/** Holds the modal back until the returned release runs (idempotent). Holds nest. */
export function holdSessionExpired(): () => void {
  modalHolds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    modalHolds--;
    if (modalHolds > 0 || deferredSource === null) return;
    const source = deferredSource;
    deferredSource = null;
    const path = typeof window === "undefined" ? "/" : window.location.pathname;
    if (!hasSignOutIntent() && !isSessionPublicPath(path)) openSessionExpired(source);
  };
}

/** The open request a hold is keeping back, if any. */
export function deferredSessionExpired(): SessionExpiredSource | null {
  return deferredSource;
}

/** A sign-in (here or in another tab) makes a held-back modal moot. */
export function cancelDeferredSessionExpired(): void {
  deferredSource = null;
}

/**
 * Opens the modal (once), records `session_expired_shown`, tells the other tabs, and asks other overlays to close.
 * Returns false when it was already open, or when a live game holds it back (it opens when the game ends).
 */
export function openSessionExpired(source: SessionExpiredSource | "demo"): boolean {
  if (source !== "demo" && modalHolds > 0) {
    deferredSource ??= source;
    return false;
  }
  const returnPath = currentPathWithQuery();
  if (!sessionExpiredStore.open(source, returnPath)) return false;
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: "session_expired", priority: 1 } }));
    } catch {
      // CustomEvent is everywhere we run; never let arbitration break the modal.
    }
  }
  if (source !== "demo") {
    trackSystem("session_expired_shown", {
      source,
      route_template: routeTemplateOf(typeof window === "undefined" ? "/" : window.location.pathname),
    });
    if (source !== "broadcast") postAuthMessage("session_expired");
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-tab messages
// ---------------------------------------------------------------------------------------------------------------

export type AuthMessage = { type: "session_expired" | "signed_out" | "signed_in" };

/**
 * This tab's sender id. A BroadcastChannel delivers to every other channel object with the same name, including the
 * ones in the sending tab, so without it a tab would hear its own `signed_out` and run the other-tab path
 * (`location.assign("/")`) in the middle of its own sign-out, aborting Clerk's sign-out (found by 1B·J).
 */
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function postAuthMessage(type: AuthMessage["type"], from: string = TAB_ID): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    ch.postMessage({ type, from });
    ch.close();
  } catch {
    // Safari < 15.4 has no BroadcastChannel; each tab then detects expiry on its own.
  }
}

/** Messages from other tabs only (`self` is this tab's id; tests pass their own). */
export function subscribeAuthMessages(onMessage: (msg: AuthMessage) => void, self: string = TAB_ID): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let ch: BroadcastChannel;
  try {
    ch = new BroadcastChannel(AUTH_CHANNEL);
  } catch {
    return () => {};
  }
  ch.onmessage = (e: MessageEvent) => {
    const data = e.data as (Partial<AuthMessage> & { from?: unknown }) | null;
    if (data?.from === self) return;
    const t = data?.type;
    if (t === "session_expired" || t === "signed_out" || t === "signed_in") onMessage({ type: t });
  };
  return () => ch.close();
}

// ---------------------------------------------------------------------------------------------------------------
// Sign-out intent (sessionStorage; every access can throw in private mode)
// ---------------------------------------------------------------------------------------------------------------

export function hasSignOutIntent(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(SIGNOUT_INTENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSignOutIntent(on: boolean): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (on) sessionStorage.setItem(SIGNOUT_INTENT_KEY, "1");
    else sessionStorage.removeItem(SIGNOUT_INTENT_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Drafts before sign-in
// ---------------------------------------------------------------------------------------------------------------

const beforeSignIn = new Set<() => void>();

/** Register a callback that saves a draft (sessionStorage["rc.draft.<route>"]) before sign-in. Returns an undo. */
export function onBeforeSignIn(cb: () => void): () => void {
  beforeSignIn.add(cb);
  return () => beforeSignIn.delete(cb);
}

export function runBeforeSignIn(): void {
  beforeSignIn.forEach((cb) => {
    try {
      cb();
    } catch {
      // A failed draft save never blocks sign-in.
    }
  });
}

/** sessionStorage key of a route's draft (CDL §4.4 step 3). */
export function draftKey(route: string): string {
  return `rc.draft.${route}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The 401 guard
// ---------------------------------------------------------------------------------------------------------------

/** The parts of the Clerk instance the guard needs. */
export type ClerkSessionLike = { session?: { reload: () => Promise<unknown> } | null | undefined };

export type SessionGuardDeps = {
  getClerk: () => ClerkSessionLike | null | undefined;
  open: (source: "api_401") => void;
  isOpen: () => boolean;
  now?: () => number;
};

export type UnauthorizedOutcome = "recovered" | "expired" | "ignored";

export type UnauthorizedContext = { source: "api_401"; queryClient?: QueryClient; error: ApiError };

function isUnauthorized(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === "unauthorized"
  );
}

/** Refetches active queries whose last error was a 401 (after a successful session reload). */
export function refetchUnauthorizedQueries(queryClient: QueryClient | undefined): void {
  void queryClient?.invalidateQueries({
    predicate: (q) => q.state.status === "error" && isUnauthorized(q.state.error),
    refetchType: "active",
  });
}

export function createSessionGuard(deps: SessionGuardDeps) {
  const now = deps.now ?? (() => Date.now());
  let inFlight: Promise<UnauthorizedOutcome> | null = null;
  let recoveredAt = Number.NEGATIVE_INFINITY;

  const expire = (): UnauthorizedOutcome => {
    deps.open("api_401");
    return "expired";
  };

  async function reloadAndDecide(ctx: UnauthorizedContext): Promise<UnauthorizedOutcome> {
    const clerk = deps.getClerk();
    try {
      await clerk?.session?.reload();
    } catch {
      // A failed reload (revoked session, network) leaves `session` as Clerk decided; check it below.
    }
    if (deps.getClerk()?.session) {
      recoveredAt = now();
      refetchUnauthorizedQueries(ctx.queryClient);
      return "recovered";
    }
    return expire();
  }

  return {
    onUnauthorized(ctx: UnauthorizedContext): Promise<UnauthorizedOutcome> {
      if (deps.isOpen()) return Promise.resolve("ignored");
      if (now() - recoveredAt < RECOVERY_WINDOW_MS) {
        // Reloaded and retried a moment ago, and still 401: the session is gone for the server.
        recoveredAt = Number.NEGATIVE_INFINITY;
        return Promise.resolve(expire());
      }
      if (inFlight) return inFlight;
      inFlight = reloadAndDecide(ctx).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    /** Forget the last recovery (after a real sign-in). */
    reset(): void {
      recoveredAt = Number.NEGATIVE_INFINITY;
    },
  };
}

export type SessionGuard = ReturnType<typeof createSessionGuard>;
