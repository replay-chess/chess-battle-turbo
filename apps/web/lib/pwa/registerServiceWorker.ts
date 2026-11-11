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

export const SW_URL = "/sw.js";
export const SW_SCOPE = "/";
/** Waits before each retry; the registration is tried `SW_RETRY_DELAYS_MS.length + 1` times in all. */
export const SW_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000];

export type SwOutcome = "registered" | "failed" | "left";

export interface SwEnv {
  register(url: string, options: RegistrationOptions): Promise<unknown>;
  wait(ms: number): Promise<void>;
  /** True once the page started unloading (`pagehide`). */
  leaving(): boolean;
  /** A real failure: every attempt failed while the page stayed. */
  report(error: unknown): void;
}

export async function registerServiceWorker(env: SwEnv, delays: readonly number[] = SW_RETRY_DELAYS_MS): Promise<SwOutcome> {
  for (let attempt = 0; ; attempt++) {
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

/** The browser wiring: after `load` (as Workbox did), never in development (no sw.js is built there). */
export function startServiceWorker(report: (error: unknown) => void): () => void {
  if (process.env.NODE_ENV !== "production" || typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }
  let left = false;
  let stopped = false;
  const onPageHide = () => {
    left = true;
  };
  window.addEventListener("pagehide", onPageHide);
  const run = () => {
    if (stopped) return;
    void registerServiceWorker({
      register: (url, options) => navigator.serviceWorker.register(url, options),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      leaving: () => left || stopped,
      report,
    });
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    stopped = true;
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("load", run);
  };
}
