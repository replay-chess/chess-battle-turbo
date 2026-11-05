"use client";

// NavigationBridge (CDL §4.1): exposes the App Router to non-React code. Mounted once in app/providers.tsx.
// `navigation` works before the bridge mounts (and outside the App Router) by falling back to `location`.
// On mount the bridge also hands it to reactToApiError (402 → paywall redirect without a full reload).
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setApiErrorDeps } from "@/lib/api/errors";

type Router = ReturnType<typeof useRouter>;

let router: Router | null = null;

export const navigation = {
  push(href: string): void {
    if (router) router.push(href);
    else if (typeof window !== "undefined") window.location.assign(href);
  },
  replace(href: string): void {
    if (router) router.replace(href);
    else if (typeof window !== "undefined") window.location.replace(href);
  },
  /** Re-renders the server components of the current route (re-seeds HydrationBoundary data). */
  refresh(): void {
    if (router) router.refresh();
    else if (typeof window !== "undefined") window.location.reload();
  },
  back(): void {
    if (router) router.back();
    else if (typeof window !== "undefined") window.history.back();
  },
  /** True once a NavigationBridge is mounted. */
  get ready(): boolean {
    return router !== null;
  },
};

export function NavigationBridge(): null {
  const r = useRouter();
  useEffect(() => {
    router = r;
    const undo = setApiErrorDeps({ navigation });
    return () => {
      if (router === r) router = null;
      undo();
    };
  }, [r]);
  return null;
}
