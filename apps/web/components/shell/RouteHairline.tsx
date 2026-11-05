"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { HAIRLINE_DELAY_MS, HAIRLINE_SAFETY_MS, shouldStartHairline } from "@/lib/shell/hairline";

/**
 * Route hairline (V3Skeletons). Shows 200ms after `rc:navigation-start` for a
 * real route change, hides when the pathname or search changes, and after a 10s
 * safety timeout. A navigation that commits within 200ms never shows it.
 */
function Hairline() {
  const pathname = usePathname();
  const search = useSearchParams();
  const routeKey = `${pathname}?${search?.toString() ?? ""}`;
  // The route the hairline was started for; it shows only while that route is still current.
  const [startedFor, setStartedFor] = useState<string | null>(null);
  const routeRef = useRef(routeKey);

  useEffect(() => {
    routeRef.current = routeKey;
  }, [routeKey]);

  useEffect(() => {
    let delay = 0;
    let safety = 0;
    const onStart = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url || !shouldStartHairline(window.location.href, url)) return;
      const from = routeRef.current;
      window.clearTimeout(delay);
      window.clearTimeout(safety);
      delay = window.setTimeout(() => {
        setStartedFor(from);
        safety = window.setTimeout(() => setStartedFor(null), HAIRLINE_SAFETY_MS);
      }, HAIRLINE_DELAY_MS);
    };
    window.addEventListener("rc:navigation-start", onStart);
    return () => {
      window.removeEventListener("rc:navigation-start", onStart);
      window.clearTimeout(delay);
      window.clearTimeout(safety);
    };
  }, []);

  if (startedFor === null || startedFor !== routeKey) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="route-hairline"
      className="fixed top-[var(--safe-top)] right-0 left-[var(--rc-nav-w,0px)] z-50 h-0.5 animate-rc-hair bg-cb-accent tabbar:top-[calc(var(--safe-top)+var(--rc-top-bar))] motion-reduce:w-[70%] motion-reduce:animate-none"
    />
  );
}

export function RouteHairline() {
  return (
    <Suspense fallback={null}>
      <Hairline />
    </Suspense>
  );
}
