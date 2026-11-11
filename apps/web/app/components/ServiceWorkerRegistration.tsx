"use client";

// Registers /sw.js once per page load (lib/pwa/registerServiceWorker.ts): the guarded replacement for next-pwa's
// auto-registration. Renders nothing.
import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { startServiceWorker } from "@/lib/pwa/registerServiceWorker";

export function ServiceWorkerRegistration() {
  useEffect(
    () =>
      startServiceWorker((error) => {
        console.error("[pwa] service worker registration failed", error);
        logger.error("service worker registration failed", error);
      }),
    [],
  );
  return null;
}
