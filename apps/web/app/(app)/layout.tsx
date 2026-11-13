import { HydrationBoundary } from "@tanstack/react-query";
import { AppShellView } from "@/components/shell/AppShellView";
import { ChromeProvider } from "@/components/shell/chrome-context";
import { PendingBotCompletes } from "@/features/game/local/pendingCompletes";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { getViewer } from "@/lib/auth/viewer";
import { meDataOf } from "@/lib/auth/viewer-dto";
import { ledgerAwareViewer } from "@/lib/billing/ledger-viewer";
import { getFlags } from "@/lib/flags";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { chromeModeFor, getShellSession } from "@/lib/shell/get-shell-session";

// Picks the chrome once per render (SPEC D2): members get the app shell while `shell-v3` is on, everyone else
// gets the page's own marketing Navbar and Footer. Never redirects: the public catalogue pages (legends, openings,
// profile) live here too.
//
// It also seeds the viewer query, qk.me() (plan §5.3, 1B·J), so UserSync and useMe() make no GET /api/me on a hard
// load. getViewer() and getShellSession() share one cached getViewerRecord(): one DB statement per render.
//
// Signed-in viewers also mount <PendingBotCompletes /> (P2 plan 5.3.3): bot results that failed to save are re-sent
// on the next app load and on `online`. It renders nothing and reads only localStorage until a journal exists.
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const [viewer, session] = await Promise.all([getViewer(), getShellSession()]);
  const flags = await getFlags(viewer);
  const mode = chromeModeFor(session, flags);

  const qc = getServerQueryClient();
  // trial.eligible asks the trial ledger too (FIX-2: the store mirrors this seed; lib/billing/ledger-viewer.ts).
  if (viewer) qc.setQueryData(qk.me(), meDataOf(await ledgerAwareViewer(viewer), flags, serverBuildId()));

  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <ChromeProvider mode={mode}>
        {viewer ? <PendingBotCompletes /> : null}
        {mode === "shell" && session ? <AppShellView user={session.user}>{children}</AppShellView> : children}
      </ChromeProvider>
    </HydrationBoundary>
  );
}
