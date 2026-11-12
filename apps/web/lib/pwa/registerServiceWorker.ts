// Explicit, guarded service-worker registration. It replaces @ducanh2912/next-pwa's auto-registration
// (`register: false` in next.config.js), whose `window.workbox.register()` promise had no rejection handler: when a
// page navigates away while /sw.js is still loading, WebKit cancels the load and rejects the registration with
// "SecurityError: Script …/sw.js load failed", an unhandled rejection on the page being left (e2e paywall-game on
// webkit-iphone: the /game → /pricing redirect right after the sign-in page loaded).
//
// A failed attempt is retried after a delay. A page that is being left never gets there (`pagehide` marks it, and a
// navigated-away document runs no more timers), so a cancelled load is never reported. An attempt that fails on
// every try while the page stays is a real failure (a missing or broken sw.js): it goes to the console and to
// Sentry, so the e2e console guard still sees it.
//
// No attempt starts once the page is being left. Between the start of a navigation (`beforeunload`) and the commit
// of the next document (`pagehide`) the old document still runs its timers and its `load` handlers, but WebKit
// refuses any load it starts: a `register()` called then fails at once, and WebKit itself logs "Cannot load …/sw.js
// due to access control checks." as a JavaScript error, whether or not the promise is handled (CachedResourceLoader
// turns the refused load into an access-control error; ThreadableLoader::logError logs it with MessageSource::JS,
// which Playwright reports as a page error). That failed bot-game on webkit-iphone (CI run 43200912012: a retry, or
// the first attempt, started while `page.goto("/play")` waited for the server). So `beforeunload` marks the page as
// left too. If a beforeunload prompt is cancelled the page stays unregistered until the next document registers.

export const SW_URL = "/sw.js";
export const SW_SCOPE = "/";
/** Waits before each retry; the registration is tried `SW_RETRY_DELAYS_MS.length + 1` times in all. */
export const SW_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000];

export type SwOutcome = "registered" | "failed" | "left";

export interface SwEnv {
  register(url: string, options: RegistrationOptions): Promise<unknown>;
  wait(ms: number): Promise<void>;
  /** True once a navigation away started (`beforeunload`) or the page was hidden for it (`pagehide`). */
  leaving(): boolean;
  /** A real failure: every attempt failed while the page stayed. */
  report(error: unknown): void;
}

export async function registerServiceWorker(env: SwEnv, delays: readonly number[] = SW_RETRY_DELAYS_MS): Promise<SwOutcome> {
  for (let attempt = 0; ; attempt++) {
    if (env.leaving()) return "left"; // never start a load on a page that is being left
    try {
      await env.register(SW_URL, { scope: SW_SCOPE });
      return "registered";
    } catch (error) {
      if (env.leaving()) return "left";
      const delay = delays[attempt];
      if (delay === undefined) {
        env.report(error);
        return "failed";
      }
      await env.wait(delay);
      if (env.leaving()) return "left";
    }
  }
}

/**
 * Workbox's precache cache (`workbox-precache-v2-<scope>`). Until 2026-11 every install failed half-way through the
 * precache (deleted source maps in the list, next.config.js), and each failed install left this cache behind with the
 * chunks it had fetched; the worker precaches nothing now (next.config.js PRECACHE_KEEP), so any such cache is a
 * leftover. When P11 fills PRECACHE_KEEP, this cleanup must go (it would delete the real precache).
 */
export const LEFTOVER_PRECACHE = /^workbox-precache-/;

/** Deletes leftover precache caches; returns how many. Never throws (no Cache Storage in private mode, …). */
export async function dropLeftoverPrecache(store: Pick<CacheStorage, "keys" | "delete"> | undefined): Promise<number> {
  try {
    if (!store) return 0;
    const stale = (await store.keys()).filter((k) => LEFTOVER_PRECACHE.test(k));
    await Promise.all(stale.map((k) => store.delete(k)));
    return stale.length;
  } catch {
    return 0;
  }
}

/**
 * The browser wiring: after `load` (as Workbox did), never in development (no sw.js is built there). A page that was
 * left mid-registration and comes back from the back/forward cache (`pageshow` with `persisted`) registers again. The
 * returned cleanup stops it, retry timers included.
 */
export function startServiceWorker(report: (error: unknown) => void, delays: readonly number[] = SW_RETRY_DELAYS_MS): () => void {
  if (process.env.NODE_ENV !== "production" || typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }
  let left = false;
  let stopped = false;
  let running = false;
  let settled = false; // registered, or reported as failed: nothing more to do
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });
  const run = () => {
    if (stopped || running || settled) return;
    running = true;
    void registerServiceWorker(
      {
        register: (url, options) => navigator.serviceWorker.register(url, options),
        wait,
        leaving: () => left || stopped,
        report,
      },
      delays,
    ).then((outcome) => {
      running = false;
      if (outcome !== "left") settled = true;
      if (outcome === "registered") void dropLeftoverPrecache(typeof caches === "undefined" ? undefined : caches);
    });
  };
  // `beforeunload` comes at the start of a navigation, `pagehide` once the next document commits.
  const onLeave = () => {
    left = true;
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    left = false;
    run();
  };
  window.addEventListener("beforeunload", onLeave);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("pageshow", onPageShow);
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    window.removeEventListener("beforeunload", onLeave);
    window.removeEventListener("pagehide", onLeave);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("load", run);
  };
}
