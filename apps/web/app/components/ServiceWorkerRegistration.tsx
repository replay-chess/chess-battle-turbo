"use client";

// Registers /sw.js once per page load (lib/pwa/registerServiceWorker.ts): the guarded replacement for next-pwa's
// auto-registration. Renders nothing. The registration code and the logger load as a lazy chunk after mount: the
// registration waits for `load` anyway, and in the root layout they would count against every route's First Load JS
// (/game/[ref] is held to 600 kB gz by check-bundle-budgets.mjs).
import { useEffect } from "react";
import { bootServiceWorker } from "./service-worker-boot";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return; // no sw.js is built for `next dev`
    return bootServiceWorker(async () => {
      const [pwa, { logger }] = await Promise.all([import("@/lib/pwa/registerServiceWorker"), import("@/lib/logger")]);
      return { start: pwa.startServiceWorker, logger };
    });
  }, []);
  return null;
}
