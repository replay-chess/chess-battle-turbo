"use client";

// Registers /sw.js once per page load (lib/pwa/registerServiceWorker.ts): the guarded replacement for next-pwa's
// auto-registration. Renders nothing. The registration code and the logger load as a lazy chunk after mount: the
// registration waits for `load` anyway, and in the root layout they would count against every route's First Load JS
// (/game/[ref] is held to 600 kB gz by check-bundle-budgets.mjs).
import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return; // no sw.js is built for `next dev`
    let stop: (() => void) | null = null;
    let unmounted = false;
    void Promise.all([import("@/lib/pwa/registerServiceWorker"), import("@/lib/logger")]).then(([pwa, { logger }]) => {
      if (unmounted) return;
      stop = pwa.startServiceWorker((error) => {
        console.error("[pwa] service worker registration failed", error);
        logger.error("service worker registration failed", error);
      });
    });
    return () => {
      unmounted = true;
      stop?.();
    };
  }, []);
  return null;
}
