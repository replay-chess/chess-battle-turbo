"use client";

// Client providers (plan §5.4, CDL §3.2): the tab's QueryClient, the router bridge for non-React code, the
// session-watcher slot and the dev-only Query devtools.
//
// Mounted once, in the root layout (app/layout.tsx), around every page with UserSync inside and
// `<SessionWatcher />` in the session-watcher slot (1B·J). Pages never add their own QueryClientProvider.
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { getQueryClient } from "@/lib/api/query-client";
import { NavigationBridge } from "@/lib/navigation/bridge";

// Dev only: `process.env.NODE_ENV` is a literal at build time, so production bundles never reference the package.
// Hidden with NEXT_PUBLIC_DEV_WIDGETS=0, like the other dev widgets (screenshots, axe and e2e runs set it).
const QueryDevtools =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_WIDGETS !== "0"
    ? dynamic(() => import("@tanstack/react-query-devtools").then((m) => m.ReactQueryDevtools), { ssr: false })
    : null;

export type ProvidersProps = {
  children: React.ReactNode;
  /**
   * SESSION WATCHER MOUNT SLOT (1B·F8). Pass `<SessionWatcher />` here from the root layout (1B·J):
   * `<Providers sessionWatcher={<SessionWatcher />}>`. It renders inside the QueryClientProvider, after the
   * NavigationBridge, so it can register its session guard with `setApiErrorDeps({ sessionGuard })` and read the
   * query client. Kept as a prop so this file does not change when F8 lands.
   */
  sessionWatcher?: React.ReactNode;
};

export function Providers({ children, sessionWatcher }: ProvidersProps) {
  // One client per tab (a module singleton), so a re-render or a Suspense remount never drops the cache.
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationBridge />
      {/* ── SessionWatcher mount point (1B·F8) ── */}
      {sessionWatcher ?? null}
      {children}
      {QueryDevtools ? <QueryDevtools initialIsOpen={false} buttonPosition="bottom-left" /> : null}
    </QueryClientProvider>
  );
}

export default Providers;
